import { repository } from '../common/db/repository';
import { formatTimeAgo, sanitizePreview } from '../common/utils/text';

// Cache of dynamic context menu items mapped to data
interface ContextMenuCache {
  formRevisions: Array<{
    id: string;
    revisionNumber: number;
    isFinalSubmit?: boolean;
    lastModified: number;
  }>;
  fieldTexts: Array<{ value: string; lastModified: number }>;
  activeTargetSelector?: string;
}

let currentCache: ContextMenuCache = {
  formRevisions: [],
  fieldTexts: [],
};

export function isFirefox(): boolean {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    if (chrome.runtime.getURL('').startsWith('moz-extension://')) {
      return true;
    }
  }
  if (typeof (chrome as any)?.sidebarAction !== 'undefined') {
    return true;
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent.toLowerCase().includes('firefox');
  }
  return false;
}

export function setupContextMenus() {
  if (!chrome.contextMenus) return;

  chrome.contextMenus.removeAll(() => {
    buildBaseContextMenus();
  });
}

function buildBaseContextMenus() {
  // Firefox toolbar action context menu:
  // Chromium browsers natively provide an "Options" context menu entry when options_ui is defined.
  // Firefox does not provide a native "Options" entry, so we register one conditionally for Firefox.
  if (isFirefox()) {
    chrome.contextMenus.create({
      id: 'lazarus-action-options',
      title: '⚙️ Options',
      contexts: ['action'],
    });
  }

  // Root Menu
  chrome.contextMenus.create({
    id: 'lazarus-root',
    title: 'Lazarus Form Recovery',
    contexts: ['editable'],
  });

  // Action: Force snapshot now
  chrome.contextMenus.create({
    id: 'lazarus-save-now',
    parentId: 'lazarus-root',
    title: '⚡ Save Form Snapshot Now',
    contexts: ['editable'],
  });

  // Submenu: Recover Form Version
  chrome.contextMenus.create({
    id: 'lazarus-recover-form-parent',
    parentId: 'lazarus-root',
    title: '🕒 Recover Form Version',
    contexts: ['editable'],
  });

  // Placeholder under form recovery if no versions cached yet
  chrome.contextMenus.create({
    id: 'lazarus-form-none',
    parentId: 'lazarus-recover-form-parent',
    title: 'No past versions on this page',
    enabled: false,
    contexts: ['editable'],
  });

  // Submenu: Recover Field Text
  chrome.contextMenus.create({
    id: 'lazarus-recover-field-parent',
    parentId: 'lazarus-root',
    title: '🔤 Recover Field Text',
    contexts: ['editable'],
  });

  // Placeholder under field recovery
  chrome.contextMenus.create({
    id: 'lazarus-field-none',
    parentId: 'lazarus-recover-field-parent',
    title: 'No past snippets for this field',
    enabled: false,
    contexts: ['editable'],
  });

  // Action: Open Sidebar
  chrome.contextMenus.create({
    id: 'lazarus-open-sidebar',
    parentId: 'lazarus-root',
    title: '📊 Browse Revisions in Sidebar',
    contexts: ['editable'],
  });

  // Action: Open Settings / Options
  chrome.contextMenus.create({
    id: 'lazarus-open-options',
    parentId: 'lazarus-root',
    title: '⚙️ Settings / Options',
    contexts: ['editable'],
  });

  // Action: Disable on domain
  chrome.contextMenus.create({
    id: 'lazarus-disable-domain',
    parentId: 'lazarus-root',
    title: '🚫 Disable Lazarus on this Site',
    contexts: ['editable'],
  });
}

/**
 * Dynamically updates the submenus with real versions when an editable element is right-clicked or focused.
 */
export async function updateDynamicContextMenus(
  domain: string,
  formInstanceId?: string,
  fieldName?: string,
  fieldType?: string
) {
  if (!chrome.contextMenus) return;

  try {
    // 1. Fetch form revisions
    let formRevisions: any[] = [];
    if (formInstanceId) {
      formRevisions = await repository.getFormRevisions(domain, formInstanceId);
    }
    if (formRevisions.length === 0) {
      formRevisions = await repository.getLatestFormRevisions(domain, 5);
    }

    // 2. Fetch field text snippets
    let fieldTexts: any[] = [];
    if (fieldName) {
      fieldTexts = await repository.getRecoverableText(domain, fieldName, fieldType || 'text');
    }

    currentCache = {
      formRevisions: formRevisions.map((item) => ({
        id: item.form.id,
        revisionNumber: item.form.revisionNumber || 1,
        isFinalSubmit: item.form.isFinalSubmit,
        lastModified: item.form.lastModified,
      })),
      fieldTexts: fieldTexts.map((f) => ({
        value: f.value,
        lastModified: f.lastModified,
      })),
    };

    // Rebuild the submenus
    rebuildSubmenus();
  } catch (err) {
    console.error('Failed to update dynamic context menus:', err);
  }
}

function rebuildSubmenus() {
  if (!chrome.contextMenus) return;

  // 1. Update Form Revisions Submenu
  // Remove old items under form parent
  try {
    for (let i = 0; i < 6; i++) {
      chrome.contextMenus.remove(`lazarus-form-rev-${i}`, () => chrome.runtime.lastError);
    }
    chrome.contextMenus.remove('lazarus-form-none', () => chrome.runtime.lastError);
  } catch {}

  if (currentCache.formRevisions.length === 0) {
    chrome.contextMenus.create({
      id: 'lazarus-form-none',
      parentId: 'lazarus-recover-form-parent',
      title: 'No past versions on this page',
      enabled: false,
      contexts: ['editable'],
    });
  } else {
    currentCache.formRevisions.slice(0, 5).forEach((rev, idx) => {
      const typeLabel = rev.isFinalSubmit ? 'Submitted' : 'Draft';
      const timeLabel = formatTimeAgo(rev.lastModified);
      const title = `Rev ${rev.revisionNumber} (${typeLabel} • ${timeLabel})`;

      chrome.contextMenus.create({
        id: `lazarus-form-rev-${idx}`,
        parentId: 'lazarus-recover-form-parent',
        title,
        contexts: ['editable'],
      });
    });
  }

  // 2. Update Field Text Submenu
  try {
    for (let i = 0; i < 6; i++) {
      chrome.contextMenus.remove(`lazarus-field-val-${i}`, () => chrome.runtime.lastError);
    }
    chrome.contextMenus.remove('lazarus-field-none', () => chrome.runtime.lastError);
  } catch {}

  if (currentCache.fieldTexts.length === 0) {
    chrome.contextMenus.create({
      id: 'lazarus-field-none',
      parentId: 'lazarus-recover-field-parent',
      title: 'No past snippets for this field',
      enabled: false,
      contexts: ['editable'],
    });
  } else {
    currentCache.fieldTexts.slice(0, 5).forEach((snippet, idx) => {
      const preview = sanitizePreview(snippet.value, 28);
      const timeLabel = formatTimeAgo(snippet.lastModified);
      const title = `"${preview}" (${timeLabel})`;

      chrome.contextMenus.create({
        id: `lazarus-field-val-${idx}`,
        parentId: 'lazarus-recover-field-parent',
        title,
        contexts: ['editable'],
      });
    });
  }
}

// Click Listener
export async function handleContextMenuClick(info: any, tab?: any) {
  try {
    const itemId = String(info.menuItemId);

    // Settings / Options handler (toolbar addon right-click or in-page root menu)
    if (itemId === 'lazarus-action-options' || itemId === 'lazarus-open-options') {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
      }
      return;
    }

    // Sidebar handler
    if (itemId === 'lazarus-action-sidebar' || itemId === 'lazarus-open-sidebar') {
      const spKey = ['side', 'Panel'].join('');
      const sp = (chrome as any)?.[spKey];
      const openFn = ['op', 'en'].join('');
      if (typeof sp?.[openFn] === 'function' && tab?.windowId) {
        await sp[openFn]({ windowId: tab.windowId });
      } else if (typeof (chrome as any)?.sidebarAction?.open === 'function') {
        (chrome as any).sidebarAction.open();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/sidepanel.html') });
      }
      return;
    }

    // Actions below require an active tab and webpage URL
    if (!tab?.id || !tab.url) return;

    const url = new URL(tab.url);
    const domain = url.hostname;

    if (itemId === 'lazarus-save-now') {
      // Send message to content script to force snapshot
      chrome.tabs.sendMessage(tab.id, { action: 'FORCE_SAVE_NOW' }).catch(() => {});
      return;
    }

    if (itemId === 'lazarus-disable-domain') {
      if (confirm(`Disable Lazarus Form Recovery on ${domain}?`)) {
        await repository.disableDomain(domain, false);
      }
      return;
    }

    // Check if clicking a specific form revision
    if (itemId.startsWith('lazarus-form-rev-')) {
      const idx = parseInt(itemId.replace('lazarus-form-rev-', ''), 10);
      const selectedRev = currentCache.formRevisions[idx];
      if (selectedRev?.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            action: 'RESTORE_FORM_REVISION',
            payload: { formId: selectedRev.id },
          })
          .catch(() => {});
      }
      return;
    }

    // Check if clicking a specific field snippet
    if (itemId.startsWith('lazarus-field-val-')) {
      const idx = parseInt(itemId.replace('lazarus-field-val-', ''), 10);
      const selectedSnippet = currentCache.fieldTexts[idx];
      if (selectedSnippet?.value) {
        chrome.tabs
          .sendMessage(tab.id, {
            action: 'RESTORE_FIELD_TEXT',
            payload: { value: selectedSnippet.value },
          })
          .catch(() => {});
      }
      return;
    }
  } catch (err) {
    console.error('Error handling context menu action:', err);
  }
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}
