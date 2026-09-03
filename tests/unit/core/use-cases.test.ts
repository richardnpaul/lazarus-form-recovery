import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveFormDraftUseCase } from '../../../src/core/use-cases/save-form-draft.use-case';
import { SubmitFormUseCase } from '../../../src/core/use-cases/submit-form.use-case';
import { RestoreFormUseCase } from '../../../src/core/use-cases/restore-form.use-case';
import { HistoryQueryUseCase } from '../../../src/core/use-cases/history-query.use-case';
import { VaultSecurityUseCase } from '../../../src/core/use-cases/vault-security.use-case';
import { DomainPolicyUseCase } from '../../../src/core/use-cases/domain-policy.use-case';
import { RetentionCleanupUseCase } from '../../../src/core/use-cases/retention-cleanup.use-case';

import { IFormRepositoryPort, StoredFormRecord, StoredFieldRecord } from '../../../src/core/ports/outbound/form-repository.port';
import { IVaultCryptoPort, EncryptionResult } from '../../../src/core/ports/outbound/vault-crypto.port';
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
      saveFormRecord: vi.fn(async (form) => { formsDb.set(form.id, form); }),
      saveFieldRecords: vi.fn(async (fields) => {
        if (fields.length > 0) fieldsDb.set(fields[0].formId, fields);
      }),
      getFormById: vi.fn(async (id) => formsDb.get(id)),
      getFieldsByFormId: vi.fn(async (id) => fieldsDb.get(id) || []),
      getRevisionsByFormInstance: vi.fn(async (domainId, formInstanceId) => {
        return Array.from(formsDb.values()).filter(
          f => f.domainId === domainId && f.formInstanceId === formInstanceId && f.status === 0
        );
      }),
      getLatestRevisionsForDomain: vi.fn(async (domainId, limit = 5) => {
        return Array.from(formsDb.values())
          .filter(f => f.domainId === domainId && f.status === 0)
          .slice(0, limit);
      }),
      getAllHistory: vi.fn(async () => []),
      getDomainHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
      getRecoverableText: vi.fn(async () => [
        { id: 'f1', formId: 'frm1', domainId: 'ex.com', revisionId: 'r1', name: 'user', type: 'text', value: 'alice', encryption: 'plaintext', lastModified: 1000, status: 0 },
        { id: 'f2', formId: 'frm1', domainId: 'ex.com', revisionId: 'r1', name: 'user', type: 'text', value: 'alice', encryption: 'plaintext', lastModified: 900, status: 0 },
      ]),
      softDeleteForm: vi.fn(async (id) => {
        const f = formsDb.get(id);
        if (f) f.status = 1;
      }),
      softDeleteRevision: vi.fn(async (id) => {
        const f = formsDb.get(id);
        if (f) f.status = 1;
      }),
      clearAllHistory: vi.fn(async () => { formsDb.clear(); fieldsDb.clear(); }),
      purgeExpiredForms: vi.fn(async () => 4),
      isDomainEnabled: vi.fn(async (domain) => domain !== 'blocked.com'),
      setDomainEnabled: vi.fn(async () => {}),
      getDisabledDomains: vi.fn(async () => ['blocked.com']),
      getSetting: vi.fn(async (_k, def) => def),
      setSetting: vi.fn(async () => {}),
    };

    mockVault = {
      encrypt: vi.fn(async (text: string): Promise<EncryptionResult> => ({ ciphertext: `enc_${text}`, mode: 'hybrid-aes-gcm' })),
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
    it('rejects saving when domain is disabled', async () => {
      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'blocked.com',
        url: 'https://blocked.com/login',
        formInstanceId: 'f1',
        fields: [],
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe('domain_disabled');
      expect(mockRepo.saveFormRecord).not.toHaveBeenCalled();
    });

    it('saves a form draft, sanitizes PII cards, encrypts, and broadcasts event', async () => {
      const useCase = new SaveFormDraftUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'example.com',
        url: 'https://example.com/checkout',
        formInstanceId: 'checkout_form',
        fields: [
          { name: 'card', type: 'text', value: '4532015112830366' }, // valid Luhn
          { name: 'notes', type: 'textarea', value: 'urgent delivery' },
        ],
      }, 101);

      expect(res.success).toBe(true);
      expect(res.revisionNumber).toBe(1);
      expect(mockSession.saveEphemeralDraft).toHaveBeenCalledWith(101, expect.any(Object));
      expect(mockRepo.saveFormRecord).toHaveBeenCalled();
      expect(mockRepo.saveFieldRecords).toHaveBeenCalled();
      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalledWith(expect.objectContaining({
        domain: 'example.com',
        formInstanceId: 'checkout_form',
        revisionNumber: 1,
      }));

      // Verify that the field with valid Luhn card was sanitized before encryption
      expect(mockVault.encrypt).toHaveBeenCalledWith('[REDACTED CREDIT CARD]');
      expect(mockVault.encrypt).toHaveBeenCalledWith('urgent delivery');
    });

    it('prunes revisions when total exceeds 10', async () => {
      // Prepopulate 11 revisions
      for (let i = 0; i < 11; i++) {
        formsDb.set(`f_${i}`, {
          id: `f_${i}`,
          domainId: 'example.com',
          formInstanceId: 'form_cap',
          revisionId: `rev_${i}`,
          revisionNumber: i + 1,
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
      const res = await useCase.execute({
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'form_cap',
        fields: [],
      }, undefined, true); // force new revision

      expect(res.success).toBe(true);
      expect(mockRepo.softDeleteRevision).toHaveBeenCalled();
    });
  });

  describe('SubmitFormUseCase', () => {
    it('creates a submitted milestone and clears tab drafts', async () => {
      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'example.com',
        url: 'https://example.com/form',
        formInstanceId: 'form_submit',
        fields: [{ name: 'email', type: 'email', value: 'user@example.com' }],
      }, 42);

      expect(res.success).toBe(true);
      expect(res.reason).toBe('final_submit');
      expect(mockSession.clearTabDrafts).toHaveBeenCalledWith(42);
      expect(mockBroadcaster.broadcastFormSaved).toHaveBeenCalled();
    });

    it('returns error if domain is blocked', async () => {
      const useCase = new SubmitFormUseCase(mockRepo, mockVault, mockSession, mockBroadcaster);
      const res = await useCase.execute({
        domain: 'blocked.com',
        url: 'https://blocked.com/form',
        formInstanceId: 'form_submit',
        fields: [],
      });
      expect(res.success).toBe(false);
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
        { id: 'fld1', formId: 'form_xyz', domainId: 'example.com', revisionId: 'r1', name: 'bio', type: 'text', value: 'enc_Hello world', encryption: 'hybrid-aes-gcm', lastModified: 1000, status: 0 },
      ]);

      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      const res = await useCase.getRecoverableForm('form_xyz');

      expect(res).toBeDefined();
      expect(res?.form.url).toBe('https://example.com/page');
      expect(res?.fields[0].value).toBe('Hello world');
    });

    it('retrieves and deduplicates recoverable text snippets', async () => {
      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      const snippets = await useCase.getRecoverableText('ex.com', 'user', 'text');

      // mockRepo returned 2 items with 'alice', should be deduplicated to 1
      expect(snippets.length).toBe(1);
      expect(snippets[0].value).toBe('alice');
    });

    it('returns undefined for non-existent form', async () => {
      const useCase = new RestoreFormUseCase(mockRepo, mockVault);
      expect(await useCase.getRecoverableForm('missing')).toBeUndefined();
    });
  });

  describe('HistoryQueryUseCase', () => {
    it('delegates timeline queries and broadcasts on deletions', async () => {
      const useCase = new HistoryQueryUseCase(mockRepo, mockBroadcaster);

      await useCase.getAllHistory(20);
      expect(mockRepo.getAllHistory).toHaveBeenCalledWith(20);

      await useCase.getDomainHistory('example.com', 10);
      expect(mockRepo.getDomainHistory).toHaveBeenCalledWith('example.com', 10);

      await useCase.searchHistory('test', 15);
      expect(mockRepo.searchHistory).toHaveBeenCalledWith('test', 15);

      await useCase.getLatestFormRevisions('example.com', 5);
      expect(mockRepo.getLatestRevisionsForDomain).toHaveBeenCalledWith('example.com', 5);

      await useCase.getFormRevisions('example.com', 'form_inst');
      expect(mockRepo.getRevisionsByFormInstance).toHaveBeenCalledWith('example.com', 'form_inst');

      await useCase.deleteForm('form_123');
      expect(mockRepo.softDeleteForm).toHaveBeenCalledWith('form_123');
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalled();

      await useCase.clearAll();
      expect(mockRepo.clearAllHistory).toHaveBeenCalled();
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('VaultSecurityUseCase', () => {
    it('checks vault status and handles setup validation', async () => {
      const useCase = new VaultSecurityUseCase(mockVault, mockBroadcaster);
      const status = await useCase.getStatus();

      expect(status.hasMasterPassword).toBe(true);
      expect(status.isUnlocked).toBe(true);
      expect(status.securityMode).toBe('encrypted');

      const shortRes = await useCase.setupMasterPassword('12345');
      expect(shortRes.success).toBe(false);
      expect(shortRes.error).toContain('at least 6 characters');

      const okRes = await useCase.setupMasterPassword('ValidPassword123');
      expect(okRes.success).toBe(true);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalled();
    });

    it('handles unlock, lock, and removal', async () => {
      const useCase = new VaultSecurityUseCase(mockVault, mockBroadcaster);

      const failUnlock = await useCase.unlock('wrong');
      expect(failUnlock.success).toBe(false);

      const okUnlock = await useCase.unlock('correct_pass');
      expect(okUnlock.success).toBe(true);

      useCase.lock();
      expect(mockVault.lock).toHaveBeenCalled();

      const removeRes = await useCase.removeMasterPassword();
      expect(removeRes.success).toBe(true);
      expect(mockVault.removeMasterPassword).toHaveBeenCalled();
    });
  });

  describe('DomainPolicyUseCase & RetentionCleanupUseCase', () => {
    it('checks domain enablement and toggles state', async () => {
      const useCase = new DomainPolicyUseCase(mockRepo, mockBroadcaster);

      expect(await useCase.isDomainEnabled('example.com')).toBe(true);
      expect(await useCase.isDomainEnabled('blocked.com')).toBe(false);

      await useCase.setDomainEnabled('test.com', false, true);
      expect(mockRepo.setDomainEnabled).toHaveBeenCalledWith('test.com', false);
      expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalled();

      expect(await useCase.getDisabledDomains()).toEqual(['blocked.com']);
    });

    it('executes retention cleanup based on configured days', async () => {
      const cleanupUseCase = new RetentionCleanupUseCase(mockRepo);
      const res = await cleanupUseCase.execute();

      expect(res.cleanedCount).toBe(4);
      expect(mockRepo.purgeExpiredForms).toHaveBeenCalledWith(7);
    });
  });
});
