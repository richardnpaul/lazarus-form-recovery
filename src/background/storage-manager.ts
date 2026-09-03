import { FormSnapshot } from '../common/types/messages';
import { repository } from '../common/db/repository';

export class SessionStorageManager {
  /**
   * Saves an ephemeral autosave draft to chrome.storage.session
   * Key pattern: autosaves:{tabId}:{formInstanceId}
   */
  public async saveEphemeralAutosave(
    tabId: number | undefined,
    snapshot: FormSnapshot
  ): Promise<void> {
    if (!chrome.storage?.session) return;

    const safeTabId = tabId ?? 'global';
    const key = `autosaves:${safeTabId}:${snapshot.formInstanceId || 'default'}`;

    try {
      await chrome.storage.session.set({
        [key]: {
          snapshot,
          timestamp: Date.now(),
        },
      });
    } catch (err) {
      console.warn('Failed to save to chrome.storage.session:', err);
    }
  }

  /**
   * Retrieves ephemeral autosaves for a given tab.
   */
  public async getTabAutosaves(tabId: number): Promise<FormSnapshot[]> {
    if (!chrome.storage?.session) return [];

    try {
      const all = await chrome.storage.session.get(null);
      const prefix = `autosaves:${tabId}:`;
      const snapshots: FormSnapshot[] = [];

      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(prefix) && value && (value as any).snapshot) {
          snapshots.push((value as any).snapshot);
        }
      }
      return snapshots;
    } catch {
      return [];
    }
  }

  /**
   * Promotes session autosaves to permanent IndexedDB vault.
   */
  public async promoteAutosaveToVault(snapshot: FormSnapshot): Promise<{ formId: string; domainId: string }> {
    return await repository.saveFormSnapshot(snapshot, true);
  }

  /**
   * Cleans up session drafts when a tab closes.
   */
  public async clearTabAutosaves(tabId: number): Promise<void> {
    if (!chrome.storage?.session) return;

    try {
      const all = await chrome.storage.session.get(null);
      const prefix = `autosaves:${tabId}:`;
      const keysToRemove = Object.keys(all).filter(k => k.startsWith(prefix));

      if (keysToRemove.length > 0) {
        await chrome.storage.session.remove(keysToRemove);
      }
    } catch (err) {
      console.warn('Failed to clear tab autosaves:', err);
    }
  }
}

export const sessionStorageManager = new SessionStorageManager();
