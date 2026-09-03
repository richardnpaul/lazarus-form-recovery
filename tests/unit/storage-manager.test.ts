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
    expect(chrome.storage.session.set).toHaveBeenCalled();

    // 2. Save with undefined tabId (fallback to 'global')
    await sessionStorageManager.saveEphemeralAutosave(undefined, sampleSnapshot);

    // 3. Get tab autosaves
    (chrome.storage.session.get as any).mockResolvedValueOnce({
      'autosaves:101:f1': { snapshot: sampleSnapshot, timestamp: Date.now() },
      'autosaves:102:f2': { snapshot: sampleSnapshot, timestamp: Date.now() },
      unrelated_key: 'val',
    });

    const snapshots = await sessionStorageManager.getTabAutosaves(101);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].formInstanceId).toBe('f1');

    // 4. Promote autosave to vault
    vi.spyOn(repository, 'saveFormSnapshot').mockResolvedValueOnce({
      formId: 'promoted_form_id',
      domainId: 'example.com',
      revisionId: 'rev_1',
      revisionNumber: 1,
    });
    const promoted = await sessionStorageManager.promoteAutosaveToVault(sampleSnapshot);
    expect(promoted.formId).toBe('promoted_form_id');

    // 5. Clear tab autosaves
    (chrome.storage.session.get as any).mockResolvedValueOnce({
      'autosaves:101:f1': { snapshot: sampleSnapshot },
      'autosaves:102:f2': { snapshot: sampleSnapshot },
    });
    await sessionStorageManager.clearTabAutosaves(101);
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['autosaves:101:f1']);
  });

  it('handles storage errors and missing chrome.storage.session gracefully', async () => {
    // Missing session storage
    const origSession = chrome.storage.session;
    delete (chrome.storage as any).session;

    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);
    const empty = await sessionStorageManager.getTabAutosaves(101);
    expect(empty).toEqual([]);
    await sessionStorageManager.clearTabAutosaves(101);

    (chrome.storage as any).session = origSession;

    // Simulated rejection
    (chrome.storage.session.set as any).mockRejectedValueOnce(new Error('QuotaExceeded'));
    await sessionStorageManager.saveEphemeralAutosave(101, sampleSnapshot);

    (chrome.storage.session.get as any).mockRejectedValueOnce(new Error('StorageError'));
    const res = await sessionStorageManager.getTabAutosaves(101);
    expect(res).toEqual([]);

    (chrome.storage.session.get as any).mockRejectedValueOnce(new Error('StorageError'));
    await sessionStorageManager.clearTabAutosaves(101);
  });
});
