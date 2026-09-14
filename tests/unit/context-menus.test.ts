import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupContextMenus,
  updateDynamicContextMenus,
  handleContextMenuClick,
  isFirefox,
} from '../../src/background/context-menus';
import { repository } from '../../src/common/db/repository';

const initialClickListenerCount =
  (chrome.contextMenus?.onClicked?.addListener as any)?.mock?.calls?.length || 0;

describe('Context Menus Manager (src/background/context-menus.ts)', () => {
  let createdMenus: any[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    createdMenus = [];

    (chrome.contextMenus.create as any) = vi.fn((props: any, cb?: () => void) => {
      createdMenus.push(props);
      if (cb) cb();
    });
    (chrome.contextMenus.remove as any) = vi.fn((_id: string, cb?: () => void) => {
      if (cb) cb();
    });
    (chrome.contextMenus.removeAll as any) = vi.fn((cb?: () => void) => {
      if (cb) cb();
    });
  });

  it('registers contextMenu click listener on load', () => {
    expect(initialClickListenerCount).toBeGreaterThanOrEqual(1);
  });

  describe('Base Menus Setup', () => {
    it('registers standard editable context menu hierarchy in Chromium', () => {
      setupContextMenus();

      expect(chrome.contextMenus.removeAll).toHaveBeenCalled();

      // Verify exact hierarchy, parents, titles, and options
      expect(createdMenus).toEqual([
        {
          id: 'lazarus-root',
          title: 'Lazarus Form Recovery',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-save-now',
          parentId: 'lazarus-root',
          title: '⚡ Save Form Snapshot Now',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-recover-form-parent',
          parentId: 'lazarus-root',
          title: '🕒 Recover Form Version',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-form-none',
          parentId: 'lazarus-recover-form-parent',
          title: 'No past versions on this page',
          enabled: false,
          contexts: ['editable'],
        },
        {
          id: 'lazarus-recover-field-parent',
          parentId: 'lazarus-root',
          title: '🔤 Recover Field Text',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-field-none',
          parentId: 'lazarus-recover-field-parent',
          title: 'No past snippets for this field',
          enabled: false,
          contexts: ['editable'],
        },
        {
          id: 'lazarus-open-sidebar',
          parentId: 'lazarus-root',
          title: '📊 Browse Revisions in Sidebar',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-open-options',
          parentId: 'lazarus-root',
          title: '⚙️ Settings / Options',
          contexts: ['editable'],
        },
        {
          id: 'lazarus-disable-domain',
          parentId: 'lazarus-root',
          title: '🚫 Disable Lazarus on this Site',
          contexts: ['editable'],
        },
      ]);
    });

    it('registers Firefox toolbar action options menu when running in Firefox', () => {
      const getUrlSpy = vi.spyOn(chrome.runtime, 'getURL').mockImplementation((p: string) => {
        if (p === '') return 'moz-extension://uuid-mock/';
        return `chrome-extension://mock/${p}`;
      });

      setupContextMenus();

      const actionMenu = createdMenus.find((m) => m.id === 'lazarus-action-options');
      expect(actionMenu).toEqual({
        id: 'lazarus-action-options',
        title: '⚙️ Options',
        contexts: ['action'],
      });

      getUrlSpy.mockRestore();
    });

    it('evaluates isFirefox correctly across runtime checks', () => {
      // Line 27: sidebarAction defined
      (chrome as any).sidebarAction = {};
      expect(isFirefox()).toBe(true);
      delete (chrome as any).sidebarAction;

      // Line 23: getURL('') with exact empty string matching moz-extension://
      const getUrlSpy = vi.spyOn(chrome.runtime, 'getURL').mockImplementation((p: string) => {
        if (p === '') return 'moz-extension://test-id/';
        return 'chrome-extension://test-id/' + p;
      });
      expect(isFirefox()).toBe(true);
      getUrlSpy.mockRestore();

      // Line 32: true when userAgent includes firefox
      const origUserAgent = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
        configurable: true,
      });
      expect(isFirefox()).toBe(true);

      // Line 35: fallback false when userAgent is not firefox and getURL not moz-extension
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        configurable: true,
      });
      expect(isFirefox()).toBe(false);
      Object.defineProperty(navigator, 'userAgent', { value: origUserAgent, configurable: true });

      // Line 22: when chrome is undefined
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;
      expect(isFirefox()).toBe(false);
      (globalThis as any).chrome = origChrome;

      // Line 23: when chrome.runtime.getURL is undefined
      const origGetUrl = chrome.runtime.getURL;
      delete (chrome.runtime as any).getURL;
      expect(isFirefox()).toBe(false);
      (chrome.runtime as any).getURL = origGetUrl;

      // Line 30: when navigator is undefined
      const origNav = (globalThis as any).navigator;
      delete (globalThis as any).navigator;
      expect(isFirefox()).toBe(false);
      (globalThis as any).navigator = origNav;
    });

    it('returns early when chrome.contextMenus is undefined', async () => {
      const origMenus = chrome.contextMenus;
      delete (chrome as any).contextMenus;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const repoSpy = vi.spyOn(repository, 'getLatestFormRevisions');

      expect(() => setupContextMenus()).not.toThrow();
      await expect(updateDynamicContextMenus('example.com')).resolves.not.toThrow();
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(repoSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      repoSpy.mockRestore();
      (chrome as any).contextMenus = origMenus;
    });

    it('handles module boot when chrome.contextMenus is missing', async () => {
      vi.resetModules();
      const origMenus = (chrome as any).contextMenus;
      delete (chrome as any).contextMenus;
      const mod = await import('../../src/background/context-menus');
      expect(() => mod.setupContextMenus()).not.toThrow();
      (chrome as any).contextMenus = origMenus;
    });
  });

  describe('Dynamic Context Menus Update', () => {
    it('fetches form revisions and field snippets and updates submenus', async () => {
      vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([
        {
          form: {
            id: 'rev-1',
            revisionNumber: 1,
            isFinalSubmit: false,
            lastModified: 1700000000000,
          },
          fields: [],
        },
        {
          form: {
            id: 'rev-2',
            revisionNumber: 2,
            isFinalSubmit: true,
            lastModified: 1700000100000,
          },
          fields: [],
        },
      ]);

      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        {
          id: 'snip-1',
          formId: 'f1',
          name: 'notes',
          type: 'textarea',
          value: 'Short snippet',
          lastModified: Date.now() - 1000,
        },
        {
          id: 'snip-2',
          formId: 'f1',
          name: 'notes',
          type: 'textarea',
          value: 'This is a very long snippet that needs to be truncated for the menu',
          lastModified: Date.now() - 3600000,
        },
      ]);

      await updateDynamicContextMenus('test.com', 'form-instance-1', 'notes', 'textarea');

      // Verify remove calls for old items
      for (let i = 0; i < 5; i++) {
        expect(chrome.contextMenus.remove).toHaveBeenCalledWith(`lazarus-form-rev-${i}`);
        expect(chrome.contextMenus.remove).toHaveBeenCalledWith(`lazarus-field-val-${i}`);
      }
      expect(chrome.contextMenus.remove).toHaveBeenCalledWith('lazarus-form-none');
      expect(chrome.contextMenus.remove).toHaveBeenCalledWith('lazarus-field-none');
      expect(chrome.contextMenus.remove).not.toHaveBeenCalledWith('lazarus-form-rev-5');
      expect(chrome.contextMenus.remove).not.toHaveBeenCalledWith('lazarus-field-val-5');
      expect(chrome.contextMenus.remove).toHaveBeenCalledTimes(12);

      // Verify form revision submenus
      const rev0 = createdMenus.find((m) => m.id === 'lazarus-form-rev-0');
      expect(rev0).toBeDefined();
      expect(rev0.title).toContain('Rev 1 (Draft • ');
      expect(rev0.parentId).toBe('lazarus-recover-form-parent');

      const rev1 = createdMenus.find((m) => m.id === 'lazarus-form-rev-1');
      expect(rev1).toBeDefined();
      expect(rev1.title).toContain('Rev 2 (Submitted • ');

      // Verify field text snippets
      const snip0 = createdMenus.find((m) => m.id === 'lazarus-field-val-0');
      expect(snip0).toBeDefined();
      expect(snip0.title).toBe('"Short snippet" (Just now)');
      expect(snip0.parentId).toBe('lazarus-recover-field-parent');

      const snip1 = createdMenus.find((m) => m.id === 'lazarus-field-val-1');
      expect(snip1).toBeDefined();
      expect(snip1.title).toBe('"This is a very long snippet ..." (1h ago)');
    });

    it('limits dynamic submenus to at most 5 items using slice(0, 5)', async () => {
      const sevenRevs = Array.from({ length: 7 }, (_, i) => ({
        form: { id: `rev-${i}`, revisionNumber: i + 1, lastModified: 1000 + i },
        fields: [],
      }));
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValue(sevenRevs as any);

      const sevenFields = Array.from({ length: 7 }, (_, i) => ({
        id: `snip-${i}`,
        formId: `rev-${i}`,
        name: 'notes',
        type: 'text',
        value: `snippet-${i}`,
        lastModified: 1000 + i,
      }));
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValue(sevenFields as any);

      await updateDynamicContextMenus('example.com', undefined, 'notes', 'text');

      const revMenus = createdMenus.filter((m) => m.id.startsWith('lazarus-form-rev-'));
      expect(revMenus.length).toBe(5);

      const fieldMenus = createdMenus.filter((m) => m.id.startsWith('lazarus-field-val-'));
      expect(fieldMenus.length).toBe(5);
    });

    it('renders placeholder items when form revisions or snippets are empty', async () => {
      vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([]);

      await updateDynamicContextMenus('test.com', 'form-empty');

      const formNone = createdMenus.find((m) => m.id === 'lazarus-form-none');
      expect(formNone).toEqual({
        id: 'lazarus-form-none',
        parentId: 'lazarus-recover-form-parent',
        title: 'No past versions on this page',
        enabled: false,
        contexts: ['editable'],
      });

      const fieldNone = createdMenus.find((m) => m.id === 'lazarus-field-none');
      expect(fieldNone).toEqual({
        id: 'lazarus-field-none',
        parentId: 'lazarus-recover-field-parent',
        title: 'No past snippets for this field',
        enabled: false,
        contexts: ['editable'],
      });
    });

    it('handles repository errors in updateDynamicContextMenus without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(repository, 'getLatestFormRevisions').mockRejectedValueOnce(new Error('IndexError'));

      await updateDynamicContextMenus('test.com');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update dynamic context menus:',
        expect.any(Error)
      );
    });
  });

  describe('Context Menu Click Handling', () => {
    const mockTab: any = { id: 101, url: 'https://sub.example.com/checkout', windowId: 5 };

    it('handles save now by sending FORCE_SAVE_NOW to active tab', async () => {
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, mockTab);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, { action: 'FORCE_SAVE_NOW' });
    });

    it('ignores actions if tab is missing or has no URL', async () => {
      (chrome.tabs.sendMessage as any).mockClear();
      const consoleSpy = vi.spyOn(console, 'error');
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, undefined);
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, { id: 101 });
      await handleContextMenuClick(
        { menuItemId: 'lazarus-save-now' },
        { url: 'https://example.com' }
      );
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles options menu click via openOptionsPage or fallback tabs.create', async () => {
      // 1. openOptionsPage exists
      await handleContextMenuClick({ menuItemId: 'lazarus-open-options' }, mockTab);
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

      await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(2);

      // 2. openOptionsPage missing -> fallback to tabs.create
      const origOpenOptions = chrome.runtime.openOptionsPage;
      delete (chrome.runtime as any).openOptionsPage;

      await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'chrome-extension://mock/src/options/options.html',
      });

      // 2b. chrome.runtime undefined in open options -> calls tabs.create({ url: '' })
      const origRuntime = chrome.runtime;
      delete (chrome as any).runtime;
      (chrome.tabs.create as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '' });
      (chrome as any).runtime = origRuntime;

      // 3. both openOptionsPage and tabs.create missing
      const origTabsCreate = chrome.tabs.create;
      delete (chrome.tabs as any).create;
      const consoleSpy = vi.spyOn(console, 'error');
      await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();

      (chrome.tabs as any).create = origTabsCreate;
      chrome.runtime.openOptionsPage = origOpenOptions;
    });

    it('handles sidebar open via sidePanel.open, sidebarAction.open, and tabs.create fallback', async () => {
      // 1. sidePanel.open
      (chrome as any).sidePanel = { open: vi.fn().mockResolvedValue(undefined) };
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
      expect((chrome as any).sidePanel.open).toHaveBeenCalledWith({ windowId: 5 });

      // 1b. sidePanel.open with undefined tab
      ((chrome as any).sidePanel.open as any).mockClear();
      const consoleSpy = vi.spyOn(console, 'error');
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, undefined);
      expect((chrome as any).sidePanel.open).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();

      // 2. sidebarAction.open fallback
      delete (chrome as any).sidePanel;
      (chrome as any).sidebarAction = { open: vi.fn() };
      await handleContextMenuClick({ menuItemId: 'lazarus-action-sidebar' }, mockTab);
      expect((chrome as any).sidebarAction.open).toHaveBeenCalled();

      // 3. tabs.create fallback
      delete (chrome as any).sidebarAction;
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'chrome-extension://mock/src/sidepanel/sidepanel.html',
      });

      // 3b. tabs.create fallback when chrome.runtime is undefined
      const origRuntime = chrome.runtime;
      delete (chrome as any).runtime;
      (chrome.tabs.create as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '' });
      (chrome as any).runtime = origRuntime;

      // 3c. tabs.create missing
      const origTabsCreate = chrome.tabs.create;
      delete (chrome.tabs as any).create;
      consoleSpy.mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
      expect(consoleSpy).not.toHaveBeenCalled();
      (chrome.tabs as any).create = origTabsCreate;
      consoleSpy.mockRestore();
    });

    it('handles domain disable with confirmation and cancellation', async () => {
      const disableSpy = vi.spyOn(repository, 'disableDomain').mockResolvedValue();

      // Cancelled
      globalThis.confirm = vi.fn().mockReturnValue(false);
      await handleContextMenuClick({ menuItemId: 'lazarus-disable-domain' }, mockTab);
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Disable Lazarus Form Recovery on sub.example.com?'
      );
      expect(disableSpy).not.toHaveBeenCalled();

      // Confirmed
      globalThis.confirm = vi.fn().mockReturnValue(true);
      await handleContextMenuClick({ menuItemId: 'lazarus-disable-domain' }, mockTab);
      expect(disableSpy).toHaveBeenCalledWith('sub.example.com', false);
    });

    it('restores form revision on clicking revision submenu item', async () => {
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([
        {
          form: {
            id: 'rev_form_1',
            revisionNumber: 1,
            isFinalSubmit: false,
            lastModified: Date.now(),
          },
          fields: [],
        },
      ]);
      await updateDynamicContextMenus('sub.example.com');

      // Valid item click
      await handleContextMenuClick({ menuItemId: 'lazarus-form-rev-0' }, mockTab);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, {
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rev_form_1' },
      });

      // Invalid item index (does not throw, does not log error, does not send message)
      const consoleSpy = vi.spyOn(console, 'error');
      (chrome.tabs.sendMessage as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-form-rev-99' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('restores field snippet on clicking field snippet submenu item', async () => {
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        {
          id: 'snip_1',
          formId: 'rev_form_1',
          name: 'notes',
          type: 'text',
          value: 'Recovered Snippet Content',
          lastModified: Date.now(),
        },
      ]);
      await updateDynamicContextMenus('sub.example.com', undefined, 'notes', 'text');

      // Valid snippet click
      await handleContextMenuClick({ menuItemId: 'lazarus-field-val-0' }, mockTab);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, {
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'Recovered Snippet Content' },
      });

      // Invalid snippet index (does not throw, does not log error, does not send message)
      const consoleSpy = vi.spyOn(console, 'error');
      (chrome.tabs.sendMessage as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-field-val-99' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('catches and logs errors gracefully when URL is invalid', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await handleContextMenuClick(
        { menuItemId: 'lazarus-save-now' },
        { id: 101, url: 'invalid-url' }
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error handling context menu action:',
        expect.any(Error)
      );
    });

    it('handles rejection gracefully when sendMessage fails for save-now, revision restore, or field snippet restore', async () => {
      (chrome.tabs.sendMessage as any).mockRejectedValue(new Error('Connection lost'));

      // 1. save-now rejection
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, mockTab);

      // 2. form revision rejection
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([
        {
          form: {
            id: 'rev_form_1',
            revisionNumber: 1,
            isFinalSubmit: false,
            lastModified: Date.now(),
          },
          fields: [],
        },
      ]);
      await updateDynamicContextMenus('sub.example.com');
      await handleContextMenuClick({ menuItemId: 'lazarus-form-rev-0' }, mockTab);

      // 3. field snippet rejection
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        {
          id: 'snip_1',
          formId: 'rev_form_1',
          name: 'notes',
          type: 'text',
          value: 'Recovered Snippet Content',
          lastModified: Date.now(),
        },
      ]);
      await updateDynamicContextMenus('sub.example.com', undefined, 'notes', 'text');
      await handleContextMenuClick({ menuItemId: 'lazarus-field-val-0' }, mockTab);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('handles dynamic context menus with default fieldType and default revisionNumber', async () => {
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([
        {
          form: {
            id: 'rev_default_test',
            revisionNumber: 0 as any, // tests revisionNumber || 1
            isFinalSubmit: false,
            lastModified: Date.now(),
          },
          fields: [],
        },
      ]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        {
          id: '1',
          formId: 'f',
          name: 'myField',
          type: 'text',
          value: 'Snippet',
          lastModified: Date.now(),
        },
      ]);

      await updateDynamicContextMenus('sub.example.com', undefined, 'myField', undefined);
      expect(repository.getRecoverableText).toHaveBeenCalledWith(
        'sub.example.com',
        'myField',
        'text'
      );
    });

    it('handles unrecognized context menu item id gracefully and prevents accidental prefix matches', async () => {
      // Ensure currentCache has items at index 0
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([
        { form: { id: 'rev-0', revisionNumber: 1, lastModified: 1000 }, fields: [] },
      ]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        { id: '1', formId: 'f', name: 'f', type: 'text', value: 'snippet-0', lastModified: 1000 },
      ]);
      await updateDynamicContextMenus('sub.example.com', undefined, 'field0', 'text');

      (chrome.tabs.sendMessage as any).mockClear();
      // Test with menuItemId '0' which does NOT start with 'lazarus-field-val-' or 'lazarus-form-rev-'
      await handleContextMenuClick({ menuItemId: '0' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

      // Test with generic unknown id
      await handleContextMenuClick({ menuItemId: 'lazarus-unknown-id' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });
});
