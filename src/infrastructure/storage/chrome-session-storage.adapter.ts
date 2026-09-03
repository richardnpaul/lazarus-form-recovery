import { IEphemeralStoragePort } from '../../core/ports/outbound/ephemeral-cache.port';
import { FormSnapshotData } from '../../core/domain/form-revision';

export class ChromeSessionStorageAdapter implements IEphemeralStoragePort {
  public async saveEphemeralDraft(
    tabId: number | undefined,
    form: FormSnapshotData
  ): Promise<void> {
    if (!chrome.storage?.session) return;

    const safeTabId = tabId ?? 'global';
    const key = `autosave_tab_${safeTabId}_${form.formInstanceId}`;

    try {
      await chrome.storage.session.set({
        [key]: {
          ...form,
          timestamp: Date.now(),
        },
      });
    } catch (err) {
      console.warn('Failed to save ephemeral draft to chrome.storage.session:', err);
    }
  }

  public async getTabDrafts(tabId: number | undefined): Promise<FormSnapshotData[]> {
    if (!chrome.storage?.session) return [];

    const safeTabId = tabId ?? 'global';
    const prefix = `autosave_tab_${safeTabId}_`;

    try {
      const all = await chrome.storage.session.get(null);
      const drafts: FormSnapshotData[] = [];

      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(prefix) && value) {
          drafts.push(value as FormSnapshotData);
        }
      }

      return drafts;
    } catch (err) {
      console.warn('Failed to get tab drafts from chrome.storage.session:', err);
      return [];
    }
  }

  public async clearTabDrafts(tabId: number): Promise<void> {
    if (!chrome.storage?.session) return;

    const prefix = `autosave_tab_${tabId}_`;

    try {
      const all = await chrome.storage.session.get(null);
      const keysToRemove = Object.keys(all).filter((k) => k.startsWith(prefix));

      if (keysToRemove.length > 0) {
        await chrome.storage.session.remove(keysToRemove);
      }
    } catch (err) {
      console.warn('Failed to clear tab autosaves from chrome.storage.session:', err);
    }
  }
}

export const defaultSessionStorage = new ChromeSessionStorageAdapter();
