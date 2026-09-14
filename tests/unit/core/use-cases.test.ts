import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveFormDraftUseCase } from '../../../src/core/use-cases/save-form-draft.use-case';
import { SubmitFormUseCase } from '../../../src/core/use-cases/submit-form.use-case';
import { RestoreFormUseCase } from '../../../src/core/use-cases/restore-form.use-case';
import { HistoryQueryUseCase } from '../../../src/core/use-cases/history-query.use-case';
import { VaultSecurityUseCase } from '../../../src/core/use-cases/vault-security.use-case';
import { DomainPolicyUseCase } from '../../../src/core/use-cases/domain-policy.use-case';
import { RetentionCleanupUseCase } from '../../../src/core/use-cases/retention-cleanup.use-case';

import {
  IFormRepositoryPort,
  StoredFormRecord,
  StoredFieldRecord,
} from '../../../src/core/ports/outbound/form-repository.port';
import {
  IVaultCryptoPort,
  EncryptionResult,
} from '../../../src/core/ports/outbound/vault-crypto.port';
import { IEphemeralStoragePort } from '../../../src/core/ports/outbound/ephemeral-cache.port';
import { IEventBroadcasterPort } from '../../../src/core/ports/outbound/event-broadcaster.port';

describe('Hexagonal Use Cases (Core)', () => {
  let mockRepo: IFormRepositoryPort;
  let mockVault: IVaultCryptoPort;
  let mockSession: IEphemeralStoragePort;
  let mockBroadcaster: IEventBroadcasterPort;

  let formsDb: Map<string, StoredFormRecord>;
  let fieldsDb: Map<string, StoredFieldRecord[]>;

  beforeEach(() => {
    formsDb = new Map();
    fieldsDb = new Map();

    mockRepo = {
      saveFormRecord: vi.fn(async (form) => {
        formsDb.set(form.id, form);
      }),
      saveFieldRecords: vi.fn(async (fields) => {
        if (fields.length > 0) fieldsDb.set(fields[0].formId, fields);
      }),
      getFormById: vi.fn(async (id) => formsDb.get(id)),
      getFieldsByFormId: vi.fn(async (id) => fieldsDb.get(id) || []),
      getRevisionsByFormInstance: vi.fn(async (domainId, formInstanceId) => {
        return Array.from(formsDb.values()).filter(
          (f) => f.domainId === domainId && f.formInstanceId === formInstanceId && f.status === 0
        );
      }),
      getLatestRevisionsForDomain: vi.fn(async (domainId, limit = 5) => {
        return Array.from(formsDb.values())
          .filter((f) => f.domainId === domainId && f.status === 0)
          .slice(0, limit);
      }),
      getAllHistory: vi.fn(async () => []),
      getDomainHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
      getRecoverableText: vi.fn(async () => []),
      softDeleteForm: vi.fn(async (id) => {
        const f = formsDb.get(id);
        if (f) f.status = 1;
      }),
      softDeleteRevision: vi.fn(async (id) => {
        const f = formsDb.get(id);
        if (f) f.status = 1;
      }),
      clearAllHistory: vi.fn(async () => {
        formsDb.clear();
        fieldsDb.clear();
      }),
      purgeExpiredForms: vi.fn(async () => 4),
      isDomainEnabled: vi.fn(async (domain) => domain !== 'blocked.com'),
      setDomainEnabled: vi.fn(async () => {}),
      getDisabledDomains: vi.fn(async () => ['blocked.com']),
      getSetting: vi.fn(async (_k, def) => def),
      setSetting: vi.fn(async () => {}),
    };

    mockVault = {
      encrypt: vi.fn(async (text: string): Promise<EncryptionResult> => ({
        ciphertext: `enc_${text}`,
        mode: 'hybrid-aes-gcm',
      })),
      decrypt: vi.fn(async (cipher) => cipher.replace('enc_', '')),
      hasMasterPassword: vi.fn(async () => true),
      setMasterPassword: vi.fn(async () => {}),
      removeMasterPassword: vi.fn(async () => {}),
      unlock: vi.fn(async (p) => p === 'correct_pass'),
      lock: vi.fn(() => {}),
      isUnlocked: vi.fn(() => true),
      hasKey: vi.fn(() => true),
      setAutoLockTimeout: vi.fn(() => {}),
    };

    mockSession = {
      saveEphemeralDraft: vi.fn(async () => {}),
      getTabDrafts: vi.fn(async () => []),
      clearTabDrafts: vi.fn(async () => {}),
    };

    mockBroadcaster = {
      broadcastFormSaved: vi.fn(),
      broadcastRefresh: vi.fn(),
    };
  });

  describe('SaveFormDraftUseCase', () => {
    it('rejects saving when domain is disabled with exact response shape', async () => {
      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'blocked.com',
        url: 'https://blocked.com/login',
        formInstanceId: 'f1',
        fields: [],
      });

      expect(res).toEqual({
        success: false,
        formId: '',
        domainId: 'blocked.com',
        revisionId: '',
        revisionNumber: 0,
        reason: 'domain_disabled',
        error: 'Form recovery is disabled on blocked.com',
      });
      expect(mockRepo.saveFormRecord).not.toHaveBeenCalled();
    });

    it('saves a form draft, sanitizes PII cards, handles field fallbacks, encrypts, and broadcasts event', async () => {
      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute(
        {
          domain: 'example.com',
          url: 'https://example.com/checkout',
          formInstanceId: 'checkout_form',
          fields: [
            { name: 'card', type: 'text', value: '4532015112830366' }, // valid Luhn
            { name: 'notes', type: 'textarea', value: 'urgent delivery' },
            { name: '', type: 'text', value: '' }, // both empty: skipped
            { name: '', type: '', value: 'anonymous_val' }, // empty name and empty type fallback
            { name: 'empty_val', type: 'text', value: '' }, // empty value kept
          ],
        },
        101
      );

      expect(res.success).toBe(true);
      expect(res.revisionNumber).toBe(1);
      expect(mockSession.saveEphemeralDraft).toHaveBeenCalledWith(101, expect.any(Object));
      expect(mockRepo.saveFormRecord).toHaveBeenCalled();
      expect(mockRepo.saveFieldRecords).toHaveBeenCalled();

      // Field checks: 4 records saved (the completely empty one was skipped)
      const savedFields = (mockRepo.saveFieldRecords as any).mock.calls[0][0];
      expect(savedFields.length).toBe(4);
      expect(savedFields.some((f: any) => f.name === 'field_anonymous' && f.type === 'text')).toBe(
        true
      );
      expect(savedFields.find((f: any) => f.name === 'field_anonymous')?.value).toBe(
        'enc_anonymous_val'
      );
      expect(savedFields.some((f: any) => f.name === 'empty_val')).toBe(true);

      const savedFormRecord = (mockRepo.saveFormRecord as any).mock.calls[0][0];
      expect(savedFormRecord.isFinalSubmit).toBe(false);

      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'example.com',
          formInstanceId: 'checkout_form',
          revisionNumber: 1,
        })
      );

      // Verify that the field with valid Luhn card was sanitized before encryption
      expect(mockVault.encrypt).toHaveBeenCalledWith('[REDACTED CREDIT CARD]');
      expect(mockVault.encrypt).toHaveBeenCalledWith('urgent delivery');
      expect(mockVault.encrypt).toHaveBeenCalledWith('anonymous_val');
      expect(mockVault.encrypt).toHaveBeenCalledWith('');
    });

    it('handles empty domain and formInstanceId fallbacks in broadcast payload', async () => {
      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: '',
        url: 'https://example.com',
        formInstanceId: '',
        fields: undefined as any, // non-array fields
      });

      expect(res.success).toBe(true);
      expect(res.domainId).toBe('unknown');
      expect(mockRepo.saveFieldRecords).not.toHaveBeenCalled();
      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'unknown',
          formInstanceId: 'form_default',
        })
      );
    });

    it('updates active revision without pruning even when 11 revisions exist in DB', async () => {
      // Prepopulate 11 revisions with recent lastModified so decision is active_update
      for (let i = 0; i < 11; i++) {
        formsDb.set(`f_active_${i}`, {
          id: `f_active_${i}`,
          domainId: 'example.com',
          formInstanceId: 'active_form',
          revisionId: `rev_active_${i}`,
          revisionNumber: i + 1,
          isFinalSubmit: false,
          url: 'https://example.com',
          title: 'Title',
          encryption: 'none',
          editingTime: 10,
          lastModified: Date.now() - 1000 + i,
          status: 0,
        });
      }

      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'active_form',
        fields: [],
      });

      expect(res.success).toBe(true);
      expect(res.reason).toBe('active_update');
      expect(mockRepo.softDeleteRevision).not.toHaveBeenCalled();
    });

    it('prunes revisions when total exceeds 10 and computes max revisionNumber properly', async () => {
      // Prepopulate 11 revisions including one with revisionNumber = 0
      for (let i = 0; i < 11; i++) {
        formsDb.set(`f_${i}`, {
          id: `f_${i}`,
          domainId: 'example.com',
          formInstanceId: 'form_cap',
          revisionId: `rev_${i}`,
          revisionNumber: i === 0 ? 0 : i + 1,
          isFinalSubmit: false,
          url: 'https://example.com',
          title: 'Title',
          encryption: 'none',
          editingTime: 10,
          lastModified: 1000 + i * 100,
          status: 0,
        });
      }

      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute(
        {
          domain: 'example.com',
          url: 'https://example.com',
          formInstanceId: 'form_cap',
          fields: [],
        },
        undefined,
        true // force new revision
      );

      expect(res.success).toBe(true);
      // max revisionNumber among existing is 11, so next is 12
      expect(res.revisionNumber).toBe(12);
      expect(mockRepo.softDeleteRevision).toHaveBeenCalled();
    });
  });

  describe('SubmitFormUseCase', () => {
    it('creates a submitted milestone, clears tab drafts, and prunes old revisions beyond cap', async () => {
      // Prepopulate 11 revisions in formsDb including one with revisionNumber: 0
      for (let i = 0; i < 11; i++) {
        formsDb.set(`f_submit_old_${i}`, {
          id: `f_submit_old_${i}`,
          domainId: 'example.com',
          formInstanceId: 'form_submit',
          revisionId: `rev_old_${i}`,
          revisionNumber: i === 0 ? 0 : i + 1,
          isFinalSubmit: false,
          url: 'https://example.com',
          title: 'Title',
          encryption: 'none',
          editingTime: 10,
          lastModified: 1000 + i * 100,
          status: 0,
        });
      }

      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute(
        {
          domain: 'example.com',
          url: 'https://example.com/form',
          formInstanceId: 'form_submit',
          fields: [
            { name: 'email', type: 'email', value: 'user@example.com' },
            { name: '', type: '', value: '' }, // skipped
            { name: '', type: '', value: 'anon' }, // fallback name & type
            { name: 'field_empty_val', type: 'text', value: '' }, // value || '' branch
          ],
        },
        42
      );

      expect(res.success).toBe(true);
      expect(res.reason).toBe('final_submit');
      expect(res.revisionNumber).toBe(12);
      expect(mockSession.clearTabDrafts).toHaveBeenCalledWith(42);
      expect(mockRepo.softDeleteRevision).toHaveBeenCalled();
      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalled();

      const savedForm = (mockRepo.saveFormRecord as any).mock.calls[0][0];
      expect(savedForm.isFinalSubmit).toBe(true);

      const savedFields = (mockRepo.saveFieldRecords as any).mock.calls[0][0];
      expect(savedFields.length).toBe(3);
      expect(savedFields.some((f: any) => f.name === 'field_anonymous' && f.type === 'text')).toBe(
        true
      );
      expect(savedFields.find((f: any) => f.name === 'field_anonymous')?.value).toBe('enc_anon');
      expect(savedFields.some((f: any) => f.name === 'field_empty_val')).toBe(true);
      expect(mockVault.encrypt).toHaveBeenCalledWith('anon');
      expect(mockVault.encrypt).toHaveBeenCalledWith('');
    });

    it('executes submission without tabId, empty domain & formInstanceId, and non-array fields', async () => {
      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: '',
        url: 'https://example.com/form',
        formInstanceId: '',
        fields: null as any,
      });

      expect(res.success).toBe(true);
      expect(res.domainId).toBe('unknown');
      expect(mockSession.clearTabDrafts).not.toHaveBeenCalled();
      expect(mockRepo.saveFieldRecords).not.toHaveBeenCalled();
      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'unknown',
          formInstanceId: 'form_default',
        })
      );
    });

    it('enforces monotonic timestamps when existing revision has future timestamp', async () => {
      const now = Date.now();
      formsDb.set('f_future', {
        id: 'f_future',
        domainId: 'example.com',
        formInstanceId: 'future_form',
        revisionId: 'rev_fut',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'https://example.com',
        title: 'Title',
        encryption: 'none',
        editingTime: 10,
        lastModified: now + 5000,
        status: 0,
      });

      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'future_form',
        fields: [{ name: 'f', type: 'text', value: 'v' }],
      });

      expect(res.success).toBe(true);
      expect(res.revisionNumber).toBe(2);
      const saved = (mockRepo.saveFormRecord as any).mock.calls[0][0];
      expect(saved.revisionNumber).toBe(2);
      expect(saved.lastModified).toBe(now + 5001);
    });

    it('returns exact error object if domain is blocked', async () => {
      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'blocked.com',
        url: 'https://blocked.com/form',
        formInstanceId: 'form_submit',
        fields: [],
      });
      expect(res).toEqual({
        success: false,
        formId: '',
        domainId: 'blocked.com',
        revisionId: '',
        revisionNumber: 0,
        reason: 'domain_disabled',
        error: 'Form recovery is disabled on blocked.com',
      });
    });
  });

  describe('RestoreFormUseCase', () => {
    it('retrieves and decrypts a form by id', async () => {
      formsDb.set('form_xyz', {
        id: 'form_xyz',
        domainId: 'example.com',
        formInstanceId: 'fx',
        revisionId: 'r1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'enc_https://example.com/page',
        title: 'Title',
        encryption: 'hybrid-aes-gcm',
        editingTime: 12,
        lastModified: 1000,
        status: 0,
      });

      fieldsDb.set('form_xyz', [
        {
          id: 'fld1',
          formId: 'form_xyz',
          domainId: 'example.com',
          revisionId: 'r1',
          name: 'bio',
          type: 'text',
          value: 'enc_Hello world',
          encryption: 'hybrid-aes-gcm',
          lastModified: 1000,
          status: 0,
        },
        {
          id: 'fld_deleted',
          formId: 'form_xyz',
          domainId: 'example.com',
          revisionId: 'r1',
          name: 'old',
          type: 'text',
          value: 'enc_Old',
          encryption: 'hybrid-aes-gcm',
          lastModified: 900,
          status: 1, // soft deleted
        },
      ]);

      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      const res = await useCase.getRecoverableForm('form_xyz');

      expect(res).toBeDefined();
      expect(res?.form.url).toBe('https://example.com/page');
      expect(res?.fields.length).toBe(1);
      expect(res?.fields[0].value).toBe('Hello world');
    });

    it('handles decryption errors and non-encrypted forms in getRecoverableForm', async () => {
      // 1. Decryption failure on URL
      formsDb.set('form_err_url', {
        id: 'form_err_url',
        domainId: 'example.com',
        formInstanceId: 'fx',
        revisionId: 'r1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'bad_enc_url',
        title: 'Title',
        encryption: 'hybrid-aes-gcm',
        editingTime: 12,
        lastModified: 1000,
        status: 0,
      });

      (mockVault.decrypt as any).mockRejectedValueOnce(new Error('DecryptUrlFailed'));
      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      const res1 = await useCase.getRecoverableForm('form_err_url');
      expect(res1?.form.url).toBe('[Encrypted URL]');

      // 2. Decryption failure on Field
      formsDb.set('form_err_field', {
        id: 'form_err_field',
        domainId: 'example.com',
        formInstanceId: 'fx',
        revisionId: 'r1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'https://example.com/page',
        title: 'Title',
        encryption: 'plaintext',
        editingTime: 12,
        lastModified: 1000,
        status: 0,
      });
      fieldsDb.set('form_err_field', [
        {
          id: 'fld_locked',
          formId: 'form_err_field',
          domainId: 'example.com',
          revisionId: 'r1',
          name: 'locked_val',
          type: 'text',
          value: 'cipher',
          encryption: 'hybrid-aes-gcm',
          lastModified: 1000,
          status: 0,
        },
      ]);

      (mockVault.decrypt as any).mockRejectedValueOnce(new Error('DecryptFieldFailed'));
      const res2 = await useCase.getRecoverableForm('form_err_field');
      expect(res2?.form.url).toBe('https://example.com/page');
      expect(res2?.fields[0].value).toBe('[Locked Draft - Enter Master Password]');
    });

    it('returns undefined for non-existent or soft-deleted form', async () => {
      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      expect(await useCase.getRecoverableForm('missing')).toBeUndefined();

      formsDb.set('form_deleted', {
        id: 'form_deleted',
        domainId: 'example.com',
        formInstanceId: 'fx',
        revisionId: 'r1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'https://example.com',
        title: 'Title',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 1, // soft deleted
      });
      expect(await useCase.getRecoverableForm('form_deleted')).toBeUndefined();
    });

    it('retrieves, deduplicates, sorts, and caps recoverable text snippets with undefined timestamps', async () => {
      // 1. Test deduplication on a small list (<10 items) to kill !seen.has and seen.add mutants
      (mockRepo.getRecoverableText as any).mockResolvedValueOnce([
        {
          id: 'd1',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_dup',
          encryption: 'hybrid',
          lastModified: 200,
          status: 0,
        },
        {
          id: 'd2',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_dup',
          encryption: 'hybrid',
          lastModified: 100,
          status: 0,
        },
        {
          id: 'd3',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_other',
          encryption: 'hybrid',
          lastModified: 50,
          status: 0,
        },
      ]);

      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      const smallSnippets = await useCase.getRecoverableText('ex.com', 'user', 'text');
      expect(smallSnippets.length).toBe(2);
      expect(smallSnippets.map((s) => s.value)).toEqual(['dup', 'other']);

      // 2. Return 14 items with different values, duplicates, and undefined timestamps to test cap and sort tie
      (mockRepo.getRecoverableText as any).mockResolvedValueOnce([
        {
          id: '1',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val1',
          encryption: 'hybrid',
          lastModified: 100,
          status: 0,
        },
        {
          id: '2',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val2',
          encryption: 'hybrid',
          lastModified: 200,
          status: 0,
        },
        {
          id: '3',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val2',
          encryption: 'hybrid',
          lastModified: 150,
          status: 0,
        }, // duplicate
        {
          id: '4',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val3',
          encryption: 'hybrid',
          lastModified: 300,
          status: 0,
        },
        {
          id: '5',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val4',
          encryption: 'hybrid',
          lastModified: 400,
          status: 0,
        },
        {
          id: '6',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val5',
          encryption: 'hybrid',
          lastModified: 500,
          status: 0,
        },
        {
          id: '7',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val6',
          encryption: 'hybrid',
          lastModified: 600,
          status: 0,
        },
        {
          id: '8',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val7',
          encryption: 'hybrid',
          lastModified: 700,
          status: 0,
        },
        {
          id: '9',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val8',
          encryption: 'hybrid',
          lastModified: 800,
          status: 0,
        },
        {
          id: '10',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val9',
          encryption: 'hybrid',
          lastModified: 900,
          status: 0,
        },
        {
          id: '11',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val10',
          encryption: 'hybrid',
          lastModified: 1000,
          status: 0,
        },
        {
          id: '12',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val11',
          encryption: 'hybrid',
          lastModified: 1100,
          status: 0,
        },
        {
          id: '13',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val0',
          encryption: 'hybrid',
          lastModified: undefined as any,
          status: 0,
        },
        {
          id: '14',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'enc_val0b',
          encryption: 'hybrid',
          lastModified: undefined as any,
          status: 0,
        },
      ]);

      const snippets = await useCase.getRecoverableText('ex.com', 'user', 'text');

      // 13 unique items capped to 10
      expect(snippets.length).toBe(10);
      // Newest first
      expect(snippets[0].value).toBe('val11');

      // Test decryption failure fallback in getRecoverableText
      (mockRepo.getRecoverableText as any).mockResolvedValueOnce([
        {
          id: 'err',
          formId: 'f',
          domainId: 'd',
          revisionId: 'r',
          name: 'n',
          type: 't',
          value: 'corrupt',
          encryption: 'hybrid',
          lastModified: 50,
          status: 0,
        },
      ]);
      (mockVault.decrypt as any).mockRejectedValueOnce(new Error('SnippetDecryptFailed'));
      const errSnippets = await useCase.getRecoverableText('ex.com', 'user', 'text');
      expect(errSnippets[0].value).toBe('[Locked Draft - Enter Master Password]');
    });
  });

  describe('HistoryQueryUseCase', () => {
    it('delegates timeline queries with defaults and broadcasts on deletions', async () => {
      const useCase = new HistoryQueryUseCase(mockRepo, mockBroadcaster);

      await useCase.getAllHistory();
      expect(mockRepo.getAllHistory).toHaveBeenCalledWith(50);

      await useCase.getDomainHistory('example.com');
      expect(mockRepo.getDomainHistory).toHaveBeenCalledWith('example.com', 20);

      await useCase.searchHistory('test');
      expect(mockRepo.searchHistory).toHaveBeenCalledWith('test', 30);

      await useCase.getLatestFormRevisions('example.com');
      expect(mockRepo.getLatestRevisionsForDomain).toHaveBeenCalledWith('example.com', 5);

      await useCase.deleteForm('form_123');
      expect(mockRepo.softDeleteForm).toHaveBeenCalledWith('form_123');
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalled();

      await useCase.clearAll();
      expect(mockRepo.clearAllHistory).toHaveBeenCalled();
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(2);
    });

    it('sorts form revisions descending by revisionNumber then lastModified with comprehensive fallbacks', async () => {
      // Revisions testing all combinations:
      // Note: r3 (300) inserted BEFORE r2 (200) so that (b.form.lastModified && 0) fails and is killed!
      formsDb.set('r3', {
        id: 'r3',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r3',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 300,
        status: 0,
      });
      formsDb.set('r2', {
        id: 'r2',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r2',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 200,
        status: 0,
      });
      formsDb.set('r1', {
        id: 'r1',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 100,
        status: 0,
      });
      formsDb.set('r4', {
        id: 'r4',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r4',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: undefined as any,
        status: 0,
      });
      formsDb.set('r4b', {
        id: 'r4b',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r4b',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: undefined as any,
        status: 0,
      });
      formsDb.set('r5', {
        id: 'r5',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r5',
        revisionNumber: undefined as any,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 50,
        status: 0,
      });
      formsDb.set('r6', {
        id: 'r6',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r6',
        revisionNumber: undefined as any,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: undefined as any,
        status: 0,
      });
      formsDb.set('r6b', {
        id: 'r6b',
        domainId: 'ex.com',
        formInstanceId: 'inst',
        revisionId: 'r6b',
        revisionNumber: undefined as any,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: undefined as any,
        status: 0,
      });

      const useCase = new HistoryQueryUseCase(mockRepo, mockBroadcaster);
      const sorted = await useCase.getFormRevisions('ex.com', 'inst');

      expect(sorted.map((s) => s.form.id)).toEqual([
        'r3',
        'r2',
        'r4',
        'r4b',
        'r1',
        'r5',
        'r6',
        'r6b',
      ]);
    });

    it('strictly verifies comparator order when lower timestamp was inserted first', async () => {
      formsDb.clear();
      formsDb.set('rev_low', {
        id: 'rev_low',
        domainId: 'ex.com',
        formInstanceId: 'inst_tie',
        revisionId: 'rev_low',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 200,
        status: 0,
      });
      formsDb.set('rev_high', {
        id: 'rev_high',
        domainId: 'ex.com',
        formInstanceId: 'inst_tie',
        revisionId: 'rev_high',
        revisionNumber: 2,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: '',
        editingTime: 0,
        lastModified: 300,
        status: 0,
      });

      const useCase = new HistoryQueryUseCase(mockRepo, mockBroadcaster);
      const sorted = await useCase.getFormRevisions('ex.com', 'inst_tie');
      expect(sorted.map((s) => s.form.id)).toEqual(['rev_high', 'rev_low']);
    });
  });

  describe('VaultSecurityUseCase', () => {
    it('checks vault status and handles setup validation', async () => {
      const useCase = new VaultSecurityUseCase(mockVault, mockBroadcaster);
      const status = await useCase.getStatus();

      expect(status.hasMasterPassword).toBe(true);
      expect(status.isUnlocked).toBe(true);
      expect(status.securityMode).toBe('encrypted');

      // Status when hasMasterPassword is false
      (mockVault.hasMasterPassword as any).mockResolvedValueOnce(false);
      const standardStatus = await useCase.getStatus();
      expect(standardStatus.securityMode).toBe('standard');

      // Password length < 6 boundary checks
      const emptyRes = await useCase.setupMasterPassword('');
      expect(emptyRes).toEqual({
        success: false,
        error: 'Password must be at least 6 characters.',
      });

      const shortRes = await useCase.setupMasterPassword('12345');
      expect(shortRes).toEqual({
        success: false,
        error: 'Password must be at least 6 characters.',
      });

      // Exact 6 characters succeeds
      (mockBroadcaster.broadcastRefresh as any).mockClear();
      const boundaryRes = await useCase.setupMasterPassword('123456');
      expect(boundaryRes.success).toBe(true);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(1);

      // Error handling on setMasterPassword
      (mockVault.setMasterPassword as any).mockRejectedValueOnce(new Error('CustomSetupError'));
      const errRes1 = await useCase.setupMasterPassword('ValidPassword123');
      expect(errRes1).toEqual({ success: false, error: 'CustomSetupError' });

      (mockVault.setMasterPassword as any).mockRejectedValueOnce(null);
      const errRes2 = await useCase.setupMasterPassword('ValidPassword123');
      expect(errRes2).toEqual({ success: false, error: 'Failed to setup master password.' });
    });

    it('handles unlock, lock, and removal with error branches', async () => {
      const useCase = new VaultSecurityUseCase(mockVault, mockBroadcaster);

      // Unlock wrong password
      (mockBroadcaster.broadcastRefresh as any).mockClear();
      const failUnlock = await useCase.unlock('wrong');
      expect(failUnlock).toEqual({ success: false, error: 'Invalid master password.' });
      expect(mockBroadcaster.broadcastRefresh).not.toHaveBeenCalled();

      // Unlock correct password
      const okUnlock = await useCase.unlock('correct_pass');
      expect(okUnlock.success).toBe(true);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(1);

      // Unlock exception handling
      (mockVault.unlock as any).mockRejectedValueOnce(new Error('UnlockCrash'));
      const unlockErr1 = await useCase.unlock('pass');
      expect(unlockErr1).toEqual({ success: false, error: 'UnlockCrash' });

      (mockVault.unlock as any).mockRejectedValueOnce(null);
      const unlockErr2 = await useCase.unlock('pass');
      expect(unlockErr2).toEqual({ success: false, error: 'Failed to unlock vault.' });

      // Lock
      (mockBroadcaster.broadcastRefresh as any).mockClear();
      useCase.lock();
      expect(mockVault.lock).toHaveBeenCalledTimes(1);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(1);

      // Remove password
      (mockBroadcaster.broadcastRefresh as any).mockClear();
      const removeRes = await useCase.removeMasterPassword();
      expect(removeRes.success).toBe(true);
      expect(mockVault.removeMasterPassword).toHaveBeenCalledTimes(1);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(1);

      // Remove password exceptions
      (mockVault.removeMasterPassword as any).mockRejectedValueOnce(new Error('RemoveFail'));
      const removeErr1 = await useCase.removeMasterPassword();
      expect(removeErr1).toEqual({ success: false, error: 'RemoveFail' });

      (mockVault.removeMasterPassword as any).mockRejectedValueOnce(null);
      const removeErr2 = await useCase.removeMasterPassword();
      expect(removeErr2).toEqual({ success: false, error: 'Failed to remove master password.' });
    });
  });

  describe('DomainPolicyUseCase & RetentionCleanupUseCase', () => {
    it('checks domain enablement, toggles state, and wipes existing domain history when requested', async () => {
      const useCase = new DomainPolicyUseCase(mockRepo, mockBroadcaster);

      expect(await useCase.isDomainEnabled('example.com')).toBe(true);
      expect(await useCase.isDomainEnabled('blocked.com')).toBe(false);

      // Wiping existing domain history on disable
      (mockRepo.getDomainHistory as any).mockResolvedValueOnce([
        { form: { id: 'wiped_form_1' } },
        { form: { id: 'wiped_form_2' } },
      ]);

      await useCase.setDomainEnabled('test.com', false, true);
      expect(mockRepo.setDomainEnabled).toHaveBeenCalledWith('test.com', false);
      expect(mockRepo.getDomainHistory).toHaveBeenCalledWith('test.com', 1000);
      expect(mockRepo.softDeleteForm).toHaveBeenCalledWith('wiped_form_1');
      expect(mockRepo.softDeleteForm).toHaveBeenCalledWith('wiped_form_2');
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalled();

      // Default wipeExisting = false
      (mockRepo.getDomainHistory as any).mockClear();
      (mockRepo.softDeleteForm as any).mockClear();
      await useCase.setDomainEnabled('test.com', false);
      expect(mockRepo.getDomainHistory).not.toHaveBeenCalled();
      expect(mockRepo.softDeleteForm).not.toHaveBeenCalled();

      // Enabled = true with wipeExisting = true (should not wipe)
      await useCase.setDomainEnabled('test.com', true, true);
      expect(mockRepo.getDomainHistory).not.toHaveBeenCalled();
      expect(mockRepo.softDeleteForm).not.toHaveBeenCalled();

      expect(await useCase.getDisabledDomains()).toEqual(['blocked.com']);
    });

    it('executes retention cleanup based on configured days', async () => {
      const cleanupUseCase = new RetentionCleanupUseCase(mockRepo);
      const res = await cleanupUseCase.execute();

      expect(res.cleanedCount).toBe(4);
      expect(mockRepo.getSetting).toHaveBeenCalledWith('retentionDays', 7);
      expect(mockRepo.purgeExpiredForms).toHaveBeenCalledWith(7);
    });
  });
});
