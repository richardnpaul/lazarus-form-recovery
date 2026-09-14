import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sessionStorageManager } from '../../src/background/storage-manager';
import { FormSnapshot } from '../../src/common/types/messages';
import { repository } from '../../src/common/db/repository';

describe('SessionStorageManager (src/background/storage-manager.ts)', () => {
  const sampleSnapshot: FormSnapshot = {
    formInstanceId: 'f1',
    url: 'https://example.com/form',
    domain: 'example.com',
    title: 'Example Form',
    editingTime: 10,
    fields: [{ name: 'email', type: 'text', value: 'user@example.com' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves, retrieves, promotes, and clears ephemeral tab autosaves', async () => {
    // 1. Save ephemeral autosave
    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      'autosaves:101:f1': {
        snapshot: sampleSnapshot,
        timestamp: expect.any(Number),
      },
    });

    // 2. Save with undefined tabId (fallback to 'global')
    await sessionStorageManager.saveEphemeralAutosave(undefined, sampleSnapshot);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      'autosaves:global:f1': {
        snapshot: sampleSnapshot,
        timestamp: expect.any(Number),
      },
    });

    // 2b. Save with custom formInstanceId
    await sessionStorageManager.saveEphemeralAutosave(101, {
      ...sampleSnapshot,
      formInstanceId: 'custom_inst',
    });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      'autosaves:101:custom_inst': {
        snapshot: { ...sampleSnapshot, formInstanceId: 'custom_inst' },
        timestamp: expect.any(Number),
      },
    });

    // 3. Get tab autosaves
    (chrome.storage.session.get as any).mockResolvedValueOnce({
      'autosaves:101:f1': { snapshot: sampleSnapshot, timestamp: Date.now() },
      'autosaves:102:f2': { snapshot: sampleSnapshot, timestamp: Date.now() },
      unrelated_key: 'val',
    });

    const snapshots = await sessionStorageManager.getTabAutosaves(101);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].formInstanceId).toBe('f1');

    // 4. Promote autosave to vault (must strictly call saveFormSnapshot with isFinalSubmit = true)
    const saveSpy = vi.spyOn(repository, 'saveFormSnapshot').mockResolvedValueOnce({
      formId: 'promoted_form_id',
      domainId: 'example.com',
      revisionId: 'rev_1',
      revisionNumber: 1,
    });
    const promoted = await sessionStorageManager.promoteAutosaveToVault(sampleSnapshot);
    expect(promoted.formId).toBe('promoted_form_id');
    expect(saveSpy).toHaveBeenCalledWith(sampleSnapshot, true);

    // 5. Clear tab autosaves
    (chrome.storage.session.get as any).mockResolvedValueOnce({
      'autosaves:101:f1': { snapshot: sampleSnapshot },
      'autosaves:102:f2': { snapshot: sampleSnapshot },
    });
    await sessionStorageManager.clearTabAutosaves(101);
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['autosaves:101:f1']);

    // 6. Clear tab autosaves when no keys match (keysToRemove.length === 0 -> remove must NOT be called)
    (chrome.storage.session.get as any).mockResolvedValueOnce({});
    (chrome.storage.session.remove as any).mockClear();
    await sessionStorageManager.clearTabAutosaves(999);
    expect(chrome.storage.session.remove).not.toHaveBeenCalled();

    // 7. Save ephemeral autosave with empty formInstanceId (fallback to 'default')
    await sessionStorageManager.saveEphemeralAutosave(101, {
      ...sampleSnapshot,
      formInstanceId: '',
    });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      'autosaves:101:default': {
        snapshot: { ...sampleSnapshot, formInstanceId: '' },
        timestamp: expect.any(Number),
      },
    });
  });

  it('handles storage errors and missing chrome.storage.session gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Missing session storage
    const origSession = chrome.storage.session;
    delete (chrome.storage as any).session;

    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);
    const empty1 = await sessionStorageManager.getTabAutosaves(101);
    expect(empty1).toEqual([]);
    await sessionStorageManager.clearTabAutosaves(101);
    expect(warnSpy).not.toHaveBeenCalled();

    (chrome.storage as any).session = origSession;

    // Missing entire chrome.storage
    const origStorage = chrome.storage;
    delete (chrome as any).storage;

    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);
    const empty2 = await sessionStorageManager.getTabAutosaves(101);
    expect(empty2).toEqual([]);
    await sessionStorageManager.clearTabAutosaves(101);
    expect(warnSpy).not.toHaveBeenCalled();

    (chrome as any).storage = origStorage;

    // Simulated rejection with console.warn verification
    const quotaErr = new Error('QuotaExceeded');
    (chrome.storage.session.set as any).mockRejectedValueOnce(quotaErr);
    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);
    expect(warnSpy).toHaveBeenCalledWith('Failed to save to chrome.storage.session:', quotaErr);

    (chrome.storage.session.get as any).mockRejectedValueOnce(new Error('StorageError'));
    const res = await sessionStorageManager.getTabAutosaves(101);
    expect(res).toEqual([]);

    const clearErr = new Error('ClearError');
    (chrome.storage.session.get as any).mockRejectedValueOnce(clearErr);
    await sessionStorageManager.clearTabAutosaves(101);
    expect(warnSpy).toHaveBeenCalledWith('Failed to clear tab autosaves:', clearErr);

    warnSpy.mockRestore();
  });
});
