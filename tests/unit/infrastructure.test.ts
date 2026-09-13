import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/common/db/lazarus-db';
import { repository } from '../../src/common/db/repository';
import {
  WebCryptoVaultAdapter,
  defaultVaultAdapter,
} from '../../src/infrastructure/crypto/web-crypto-vault.adapter';
import {
  RuntimeBroadcasterAdapter,
  defaultBroadcaster,
} from '../../src/infrastructure/messaging/runtime-broadcaster.adapter';
import {
  ChromeAlarmsAdapter,
  defaultScheduler,
} from '../../src/infrastructure/scheduler/chrome-alarms.adapter';
import {
  ChromeSessionStorageAdapter,
  defaultSessionStorage,
} from '../../src/infrastructure/storage/chrome-session-storage.adapter';
import {
  DexieFormRepositoryAdapter,
  defaultRepositoryAdapter,
} from '../../src/infrastructure/db/dexie-form-repository.adapter';
import { FormSnapshotData } from '../../src/core/domain/form-revision';

describe('Infrastructure Adapters', () => {
  const originalChrome = (globalThis as any).chrome;

  beforeEach(async () => {
    (globalThis as any).chrome = originalChrome;
    await db.domains.clear();
    await db.forms.clear();
    await db.fields.clear();
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  describe('WebCryptoVaultAdapter', () => {
    it('delegates all vault operations to the injected vaultManager', async () => {
      const mockVaultManager: any = {
        encrypt: vi.fn().mockResolvedValue({ ciphertext: 'c1', mode: 'm1' }),
        decrypt: vi.fn().mockResolvedValue('decrypted_text'),
        hasMasterPassword: vi.fn().mockResolvedValue(true),
        setMasterPassword: vi.fn().mockResolvedValue(undefined),
        removeMasterPassword: vi.fn().mockResolvedValue(undefined),
        unlock: vi.fn().mockResolvedValue(true),
        lock: vi.fn(),
        isUnlocked: vi.fn().mockReturnValue(true),
        setAutoLockMinutes: vi.fn(),
      };

      const adapter = new WebCryptoVaultAdapter(mockVaultManager);

      const enc = await adapter.encrypt('secret');
      expect(enc).toEqual({ ciphertext: 'c1', mode: 'm1' });
      expect(mockVaultManager.encrypt).toHaveBeenCalledWith('secret');

      const dec = await adapter.decrypt('c1', 'm1');
      expect(dec).toBe('decrypted_text');
      expect(mockVaultManager.decrypt).toHaveBeenCalledWith('c1', 'm1');

      const hasPass = await adapter.hasMasterPassword();
      expect(hasPass).toBe(true);
      expect(mockVaultManager.hasMasterPassword).toHaveBeenCalled();

      await adapter.setMasterPassword('pass123');
      expect(mockVaultManager.setMasterPassword).toHaveBeenCalledWith('pass123');

      await adapter.removeMasterPassword();
      expect(mockVaultManager.removeMasterPassword).toHaveBeenCalled();

      const unlockRes = await adapter.unlock('pass123');
      expect(unlockRes).toBe(true);
      expect(mockVaultManager.unlock).toHaveBeenCalledWith('pass123');

      adapter.lock();
      expect(mockVaultManager.lock).toHaveBeenCalled();

      expect(adapter.isUnlocked()).toBe(true);
      expect(mockVaultManager.isUnlocked).toHaveBeenCalled();

      expect(adapter.hasKey()).toBe(true);

      adapter.setAutoLockTimeout(15);
      expect(mockVaultManager.setAutoLockMinutes).toHaveBeenCalledWith(15);
    });

    it('exposes defaultVaultAdapter with default vault instance', async () => {
      expect(defaultVaultAdapter).toBeInstanceOf(WebCryptoVaultAdapter);
      const isUnlocked = defaultVaultAdapter.isUnlocked();
      expect(typeof isUnlocked).toBe('boolean');
      expect(defaultVaultAdapter.hasKey()).toBe(isUnlocked);
    });
  });

  describe('RuntimeBroadcasterAdapter', () => {
    it('broadcastFormSaved sends runtime message and handles async rejection safely', () => {
      const adapter = new RuntimeBroadcasterAdapter();
      let catchHandler: any;
      const mockSendMessage = vi.fn().mockReturnValue({
        catch: vi.fn((fn) => {
          catchHandler = fn;
          return { catch: vi.fn() };
        }),
      });
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: mockSendMessage,
        },
      };

      const payload = {
        domain: 'example.com',
        formInstanceId: 'f1',
        revisionNumber: 2,
        formId: 'form_123',
      };
      adapter.broadcastFormSaved(payload);

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'FORM_SAVED',
        payload,
      });

      // Verify the .catch callback runs safely
      expect(typeof catchHandler).toBe('function');
      expect(() => catchHandler(new Error('fail'))).not.toThrow();
    });

    it('broadcastFormSaved handles synchronous throw safely', () => {
      const adapter = new RuntimeBroadcasterAdapter();
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: vi.fn().mockImplementation(() => {
            throw new Error('Sync send error');
          }),
        },
      };

      expect(() =>
        adapter.broadcastFormSaved({
          domain: 'example.com',
          formInstanceId: 'f1',
          revisionNumber: 1,
          formId: 'id',
        })
      ).not.toThrow();
    });

    it('broadcastFormSaved handles undefined chrome or runtime safely', () => {
      const adapter = new RuntimeBroadcasterAdapter();
      (globalThis as any).chrome = {};
      expect(() =>
        adapter.broadcastFormSaved({
          domain: 'example.com',
          formInstanceId: 'f1',
          revisionNumber: 1,
          formId: 'id',
        })
      ).not.toThrow();

      (globalThis as any).chrome = undefined;
      expect(() =>
        adapter.broadcastFormSaved({
          domain: 'example.com',
          formInstanceId: 'f1',
          revisionNumber: 1,
          formId: 'id',
        })
      ).not.toThrow();
    });

    it('broadcastRefresh sends runtime message and handles async rejection safely', () => {
      const adapter = new RuntimeBroadcasterAdapter();
      let catchHandler: any;
      const mockSendMessage = vi.fn().mockReturnValue({
        catch: vi.fn((fn) => {
          catchHandler = fn;
          return { catch: vi.fn() };
        }),
      });
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: mockSendMessage,
        },
      };

      adapter.broadcastRefresh();
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'REFRESH_HISTORY',
      });

      expect(typeof catchHandler).toBe('function');
      expect(() => catchHandler(new Error('fail'))).not.toThrow();
    });

    it('broadcastRefresh handles synchronous throw and missing chrome safely', () => {
      const adapter = new RuntimeBroadcasterAdapter();
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: vi.fn().mockImplementation(() => {
            throw new Error('Sync send error');
          }),
        },
      };
      expect(() => adapter.broadcastRefresh()).not.toThrow();

      (globalThis as any).chrome = {};
      expect(() => adapter.broadcastRefresh()).not.toThrow();

      (globalThis as any).chrome = undefined;
      expect(() => adapter.broadcastRefresh()).not.toThrow();
    });

    it('exposes defaultBroadcaster instance', () => {
      expect(defaultBroadcaster).toBeInstanceOf(RuntimeBroadcasterAdapter);
    });
  });

  describe('ChromeAlarmsAdapter', () => {
    it('registerAlarm creates alarm if chrome.alarms exists', () => {
      const adapter = new ChromeAlarmsAdapter();
      const mockCreate = vi.fn();
      (globalThis as any).chrome = {
        alarms: {
          create: mockCreate,
        },
      };

      adapter.registerAlarm({ name: 'cleanup', periodInMinutes: 60 });
      expect(mockCreate).toHaveBeenCalledWith('cleanup', { periodInMinutes: 60 });
    });

    it('registerAlarm returns early if chrome.alarms is undefined', () => {
      const adapter = new ChromeAlarmsAdapter();
      (globalThis as any).chrome = {};
      expect(() => adapter.registerAlarm({ name: 'cleanup', periodInMinutes: 60 })).not.toThrow();
    });

    it('onAlarm registers listener and invokes handler with error logging', async () => {
      const adapter = new ChromeAlarmsAdapter();
      let registeredListener: ((alarm: { name: string }) => void) | undefined;
      (globalThis as any).chrome = {
        alarms: {
          onAlarm: {
            addListener: vi.fn((listener) => {
              registeredListener = listener;
            }),
          },
        },
      };

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockHandler = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Alarm failed'));

      adapter.onAlarm(mockHandler);
      expect(typeof registeredListener).toBe('function');

      // 1. Success execution
      registeredListener!({ name: 'cleanup_job' });
      expect(mockHandler).toHaveBeenCalledWith('cleanup_job');

      // 2. Failure execution
      registeredListener!({ name: 'failing_job' });
      // Allow microtask to run for handler promise catch
      await new Promise((r) => setTimeout(r, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Lazarus Alarm] Error running alarm job failing_job:',
        expect.any(Error)
      );
    });

    it('onAlarm returns early if chrome.alarms is undefined', () => {
      const adapter = new ChromeAlarmsAdapter();
      (globalThis as any).chrome = {};
      expect(() => adapter.onAlarm(vi.fn())).not.toThrow();
    });

    it('exposes defaultScheduler instance', () => {
      expect(defaultScheduler).toBeInstanceOf(ChromeAlarmsAdapter);
    });
  });

  describe('ChromeSessionStorageAdapter', () => {
    it('saveEphemeralDraft saves draft with tabId or fallback to global', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const mockSet = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).chrome = {
        storage: {
          session: {
            set: mockSet,
          },
        },
      };

      const form: FormSnapshotData = {
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'f1',
        fields: [{ name: 'u', type: 'text', value: 'admin' }],
      };

      // 1. With tabId
      await adapter.saveEphemeralDraft(101, form);
      expect(mockSet).toHaveBeenCalledWith({
        autosave_tab_101_f1: expect.objectContaining({
          domain: 'example.com',
          formInstanceId: 'f1',
          timestamp: expect.any(Number),
        }),
      });

      // 2. Without tabId
      await adapter.saveEphemeralDraft(undefined, form);
      expect(mockSet).toHaveBeenCalledWith({
        autosave_tab_global_f1: expect.objectContaining({
          domain: 'example.com',
          formInstanceId: 'f1',
          timestamp: expect.any(Number),
        }),
      });
    });

    it('saveEphemeralDraft logs warning on set error', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (globalThis as any).chrome = {
        storage: {
          session: {
            set: vi.fn().mockRejectedValue(new Error('Storage quota')),
          },
        },
      };

      const form: FormSnapshotData = {
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'f1',
        fields: [],
      };

      await adapter.saveEphemeralDraft(101, form);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to save ephemeral draft to chrome.storage.session:',
        expect.any(Error)
      );
    });

    it('saveEphemeralDraft returns early when chrome.storage.session is missing', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn');
      const form: FormSnapshotData = {
        domain: 'example.com',
        url: 'https://example.com',
        formInstanceId: 'f1',
        fields: [],
      };

      (globalThis as any).chrome = { storage: {} };
      await expect(adapter.saveEphemeralDraft(101, form)).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();

      (globalThis as any).chrome = {};
      await expect(adapter.saveEphemeralDraft(101, form)).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('getTabDrafts retrieves and filters matching drafts by prefix', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const mockData = {
        autosave_tab_101_f1: { domain: 'example.com', formInstanceId: 'f1', fields: [] },
        autosave_tab_101_f2: { domain: 'example.com', formInstanceId: 'f2', fields: [] },
        autosave_tab_101_f3_null: null, // falsy value skipped
        autosave_tab_202_f1: { domain: 'other.com', formInstanceId: 'f1', fields: [] },
        other_key: { foo: 'bar' },
      };
      (globalThis as any).chrome = {
        storage: {
          session: {
            get: vi.fn().mockResolvedValue(mockData),
          },
        },
      };

      const drafts = await adapter.getTabDrafts(101);
      expect(drafts.length).toBe(2);
      expect(drafts.map((d) => d.formInstanceId)).toEqual(['f1', 'f2']);

      // Test with undefined tabId (prefix autosave_tab_global_)
      const mockGlobalData = {
        autosave_tab_global_g1: { domain: 'g.com', formInstanceId: 'g1', fields: [] },
      };
      (globalThis as any).chrome.storage.session.get = vi.fn().mockResolvedValue(mockGlobalData);
      const globalDrafts = await adapter.getTabDrafts(undefined);
      expect(globalDrafts.length).toBe(1);
      expect(globalDrafts[0].formInstanceId).toBe('g1');
    });

    it('getTabDrafts catches error and returns empty array', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (globalThis as any).chrome = {
        storage: {
          session: {
            get: vi.fn().mockRejectedValue(new Error('Read failed')),
          },
        },
      };

      const drafts = await adapter.getTabDrafts(101);
      expect(drafts).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to get tab drafts from chrome.storage.session:',
        expect.any(Error)
      );
    });

    it('getTabDrafts returns empty array when chrome.storage.session is missing', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn');

      (globalThis as any).chrome = { storage: {} };
      expect(await adapter.getTabDrafts(101)).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();

      (globalThis as any).chrome = {};
      expect(await adapter.getTabDrafts(101)).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('clearTabDrafts removes matching keys when present and skips remove when empty', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockGet = vi.fn().mockResolvedValue({
        autosave_tab_101_f1: {},
        autosave_tab_101_f2: {},
        autosave_tab_202_f1: {},
      });
      (globalThis as any).chrome = {
        storage: {
          session: {
            get: mockGet,
            remove: mockRemove,
          },
        },
      };

      // 1. Keys to remove > 0
      await adapter.clearTabDrafts(101);
      expect(mockRemove).toHaveBeenCalledWith(['autosave_tab_101_f1', 'autosave_tab_101_f2']);

      // 2. Keys to remove === 0
      mockRemove.mockClear();
      mockGet.mockResolvedValueOnce({
        autosave_tab_202_f1: {},
      });
      await adapter.clearTabDrafts(999);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('clearTabDrafts catches errors and logs warning', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (globalThis as any).chrome = {
        storage: {
          session: {
            get: vi.fn().mockRejectedValue(new Error('Remove failed')),
          },
        },
      };

      await adapter.clearTabDrafts(101);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to clear tab autosaves from chrome.storage.session:',
        expect.any(Error)
      );
    });

    it('clearTabDrafts returns early when chrome.storage.session is missing', async () => {
      const adapter = new ChromeSessionStorageAdapter();
      const warnSpy = vi.spyOn(console, 'warn');

      (globalThis as any).chrome = { storage: {} };
      await expect(adapter.clearTabDrafts(101)).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();

      (globalThis as any).chrome = {};
      await expect(adapter.clearTabDrafts(101)).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('exposes defaultSessionStorage instance', () => {
      expect(defaultSessionStorage).toBeInstanceOf(ChromeSessionStorageAdapter);
    });
  });

  describe('DexieFormRepositoryAdapter', () => {
    it('saves and retrieves forms and fields', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      const formRecord = {
        id: 'form_rec_1',
        domainId: 'example.com',
        formInstanceId: 'inst_1',
        revisionId: 'rev_1',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: 'https://example.com/checkout',
        title: 'Checkout',
        encryption: 'none',
        editingTime: 10,
        lastModified: 1000,
        status: 0,
      };

      await adapter.saveFormRecord(formRecord);

      const retrievedForm = await adapter.getFormById('form_rec_1');
      expect(retrievedForm).toBeDefined();
      expect(retrievedForm?.id).toBe('form_rec_1');

      const fieldRecords = [
        {
          id: 'field_1',
          formId: 'form_rec_1',
          domainId: 'example.com',
          revisionId: 'rev_1',
          name: 'username',
          type: 'text',
          value: 'alice',
          encryption: 'none',
          lastModified: 1000,
          status: 0,
        },
        {
          id: 'field_deleted',
          formId: 'form_rec_1',
          domainId: 'example.com',
          revisionId: 'rev_1',
          name: 'old',
          type: 'text',
          value: 'oldval',
          encryption: 'none',
          lastModified: 1000,
          status: 1, // soft deleted
        },
      ];

      await adapter.saveFieldRecords(fieldRecords);

      const activeFields = await adapter.getFieldsByFormId('form_rec_1');
      expect(activeFields.length).toBe(1);
      expect(activeFields[0].id).toBe('field_1');
    });

    it('queries revisions by form instance reverse sorted by lastModified', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      await db.forms.bulkPut([
        {
          id: 'z_rev',
          domainId: 'example.com',
          formInstanceId: 'inst_target',
          revisionId: 'r1',
          revisionNumber: 1,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: 100,
          status: 0,
        },
        {
          id: 'a_rev',
          domainId: 'example.com',
          formInstanceId: 'inst_target',
          revisionId: 'r2',
          revisionNumber: 2,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: 200,
          status: 0,
        },
        {
          id: 'f_rev_other_inst',
          domainId: 'example.com',
          formInstanceId: 'other_instance',
          revisionId: 'ro',
          revisionNumber: 1,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: 300,
          status: 0,
        },
        {
          id: 'f_rev_deleted',
          domainId: 'example.com',
          formInstanceId: 'inst_target',
          revisionId: 'rd',
          revisionNumber: 3,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: 400,
          status: 1,
        },
      ]);

      const revs = await adapter.getRevisionsByFormInstance('example.com', 'inst_target');
      expect(revs.length).toBe(2);
      expect(revs.map((r) => r.id)).toEqual(['a_rev', 'z_rev']);
    });

    it('queries latest revisions for domain with default limit and custom limit', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      // IDs in reverse alphabetical order compared to timestamps to strictly kill .sortBy('')
      const items = [
        { id: 'f_z_100', ts: 100 },
        { id: 'f_y_200', ts: 200 },
        { id: 'f_x_300', ts: 300 },
        { id: 'f_w_400', ts: 400 },
        { id: 'f_v_500', ts: 500 },
        { id: 'f_u_600', ts: 600 },
        { id: 'f_t_700', ts: 700 },
        { id: 'f_s_800', ts: 800 },
      ];

      for (let i = 0; i < items.length; i++) {
        await db.forms.put({
          id: items[i].id,
          domainId: 'example.com',
          formInstanceId: `inst_${i}`,
          revisionId: `r_${i}`,
          revisionNumber: 1,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: items[i].ts,
          status: 0,
        });
      }

      // Also insert a deleted form with higher timestamp
      await db.forms.put({
        id: 'f_limit_deleted',
        domainId: 'example.com',
        formInstanceId: 'inst_del',
        revisionId: 'r_del',
        revisionNumber: 1,
        isFinalSubmit: false,
        url: '',
        title: '',
        encryption: 'none',
        editingTime: 0,
        lastModified: 999,
        status: 1, // soft deleted: must be filtered out
      });

      // Default limit = 5
      const defaultRevs = await adapter.getLatestRevisionsForDomain('example.com');
      expect(defaultRevs.length).toBe(5);
      expect(defaultRevs.map((r) => r.id)).toEqual([
        'f_s_800',
        'f_t_700',
        'f_u_600',
        'f_v_500',
        'f_w_400',
      ]);

      // Custom limit = 3
      const customRevs = await adapter.getLatestRevisionsForDomain('example.com', 3);
      expect(customRevs.length).toBe(3);
      expect(customRevs.map((r) => r.id)).toEqual(['f_s_800', 'f_t_700', 'f_u_600']);
    });

    it('queries recoverable text filtering by domain, name, type, and non-empty value', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      await db.fields.bulkPut([
        {
          id: 'fld_val_old',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r1',
          name: 'notes',
          type: 'textarea',
          value: 'first version',
          encryption: 'none',
          lastModified: 100,
          status: 0,
        },
        {
          id: 'fld_val_new',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r2',
          name: 'notes',
          type: 'textarea',
          value: 'second version',
          encryption: 'none',
          lastModified: 200,
          status: 0,
        },
        {
          id: 'fld_empty_val',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r3',
          name: 'notes',
          type: 'textarea',
          value: '   ', // whitespace only: skipped
          encryption: 'none',
          lastModified: 300,
          status: 0,
        },
        {
          id: 'fld_diff_name',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r4',
          name: 'different_name', // different name: skipped
          type: 'textarea',
          value: 'different name note',
          encryption: 'none',
          lastModified: 400,
          status: 0,
        },
        {
          id: 'fld_diff_type',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r5',
          name: 'notes',
          type: 'text', // different type: skipped
          value: 'text note',
          encryption: 'none',
          lastModified: 500,
          status: 0,
        },
        {
          id: 'fld_deleted',
          formId: 'f1',
          domainId: 'example.com',
          revisionId: 'r6',
          name: 'notes',
          type: 'textarea',
          value: 'deleted note',
          encryption: 'none',
          lastModified: 600,
          status: 1, // soft deleted: skipped
        },
      ]);

      const texts = await adapter.getRecoverableText('EXAMPLE.COM', 'notes', 'textarea');
      expect(texts.length).toBe(2);
      expect(texts.map((t) => t.id)).toEqual(['fld_val_new', 'fld_val_old']);
    });

    it('delegates history and deletion queries to repository', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      const getAllSpy = vi.spyOn(repository, 'getAllHistory').mockResolvedValueOnce([]);
      await adapter.getAllHistory(40);
      expect(getAllSpy).toHaveBeenCalledWith(40);

      // Default limit 50
      await adapter.getAllHistory();
      expect(getAllSpy).toHaveBeenCalledWith(50);

      const getDomainSpy = vi.spyOn(repository, 'getDomainHistory').mockResolvedValueOnce([]);
      await adapter.getDomainHistory('example.com', 10);
      expect(getDomainSpy).toHaveBeenCalledWith('example.com', 10);

      // Default limit 20
      await adapter.getDomainHistory('example.com');
      expect(getDomainSpy).toHaveBeenCalledWith('example.com', 20);

      const searchSpy = vi.spyOn(repository, 'searchHistory').mockResolvedValueOnce([]);
      await adapter.searchHistory('term', 15);
      expect(searchSpy).toHaveBeenCalledWith('term', 15);

      // Default limit 30
      await adapter.searchHistory('term');
      expect(searchSpy).toHaveBeenCalledWith('term', 30);

      const deleteFormSpy = vi.spyOn(repository, 'deleteForm').mockResolvedValue();
      await adapter.softDeleteForm('form_del_1');
      expect(deleteFormSpy).toHaveBeenCalledWith('form_del_1');

      await adapter.softDeleteRevision('form_del_2');
      expect(deleteFormSpy).toHaveBeenCalledWith('form_del_2');

      const clearAllSpy = vi.spyOn(repository, 'clearAllHistory').mockResolvedValue();
      await adapter.clearAllHistory();
      expect(clearAllSpy).toHaveBeenCalled();
    });

    it('purges expired forms older than retentionDays and returns deleted count', async () => {
      const adapter = new DexieFormRepositoryAdapter();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      await db.forms.bulkPut([
        {
          id: 'f_expired_1',
          domainId: 'example.com',
          formInstanceId: 'inst',
          revisionId: 'r1',
          revisionNumber: 1,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: now - 15 * dayMs,
          status: 0,
        },
        {
          id: 'f_expired_2',
          domainId: 'example.com',
          formInstanceId: 'inst',
          revisionId: 'r2',
          revisionNumber: 2,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: now - 12 * dayMs,
          status: 0,
        },
        {
          id: 'f_fresh',
          domainId: 'example.com',
          formInstanceId: 'inst',
          revisionId: 'r3',
          revisionNumber: 3,
          isFinalSubmit: false,
          url: '',
          title: '',
          encryption: 'none',
          editingTime: 0,
          lastModified: now - 2 * dayMs,
          status: 0,
        },
      ]);

      const deleteSpy = vi.spyOn(repository, 'deleteForm').mockResolvedValue();

      const purgedCount = await adapter.purgeExpiredForms(10);
      expect(purgedCount).toBe(2);
      expect(deleteSpy).toHaveBeenCalledWith('f_expired_1');
      expect(deleteSpy).toHaveBeenCalledWith('f_expired_2');
      expect(deleteSpy).not.toHaveBeenCalledWith('f_fresh');
    });

    it('handles domain enablement and queries disabled domains', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      const isEnabledSpy = vi.spyOn(repository, 'isDomainEnabled').mockResolvedValueOnce(true);
      const isEnabled = await adapter.isDomainEnabled('example.com');
      expect(isEnabled).toBe(true);
      expect(isEnabledSpy).toHaveBeenCalledWith('example.com');

      const enableSpy = vi.spyOn(repository, 'enableDomain').mockResolvedValueOnce();
      await adapter.setDomainEnabled('example.com', true);
      expect(enableSpy).toHaveBeenCalledWith('example.com');

      const disableSpy = vi.spyOn(repository, 'disableDomain').mockResolvedValueOnce();
      await adapter.setDomainEnabled('example.com', false);
      expect(disableSpy).toHaveBeenCalledWith('example.com');

      // Disabled domains
      await db.domains.bulkPut([
        { id: 'd1', domain: 'blocked1.com', totalEditingTime: 0, lastModified: 100, status: 1 },
        { id: 'd2', domain: 'blocked2.com', totalEditingTime: 0, lastModified: 200, status: 1 },
        { id: 'd3', domain: 'active.com', totalEditingTime: 0, lastModified: 300, status: 0 },
      ]);

      const disabled = await adapter.getDisabledDomains();
      expect(disabled).toEqual(['blocked1.com', 'blocked2.com']);
    });

    it('gets and sets settings with default value fallbacks', async () => {
      const adapter = new DexieFormRepositoryAdapter();

      // Setting does not exist yet -> returns defaultValue
      const missingSetting = await adapter.getSetting('retentionDays', 14);
      expect(missingSetting).toBe(14);

      // Save setting
      await adapter.setSetting('retentionDays', 30);
      const updatedSetting = await adapter.getSetting('retentionDays', 14);
      expect(updatedSetting).toBe(30);

      // Verify db.settings record
      const dbRecord = await db.settings.get('retentionDays');
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.value).toBe(30);
      expect(typeof dbRecord?.lastModified).toBe('number');
    });

    it('exposes defaultRepositoryAdapter instance', () => {
      expect(defaultRepositoryAdapter).toBeInstanceOf(DexieFormRepositoryAdapter);
    });
  });
});
