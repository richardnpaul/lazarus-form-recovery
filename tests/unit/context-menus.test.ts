import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupContextMenus,
  updateDynamicContextMenus,
  handleContextMenuClick,
} from '../../src/background/context-menus';
import { repository } from '../../src/common/db/repository';

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

  describe('Base Menus Setup', () => {
    it('registers standard editable context menu hierarchy in Chromium', () => {
      setupContextMenus();

      expect(chrome.contextMenus.removeAll).toHaveBeenCalled();

      const ids = createdMenus.map((m) => m.id);
      expect(ids).toContain('lazarus-root');
      expect(ids).toContain('lazarus-save-now');
      expect(ids).toContain('lazarus-recover-form-parent');
      expect(ids).toContain('lazarus-form-none');
      expect(ids).toContain('lazarus-recover-field-parent');
      expect(ids).toContain('lazarus-field-none');
      expect(ids).toContain('lazarus-open-sidebar');
      expect(ids).toContain('lazarus-open-options');
      expect(ids).toContain('lazarus-disable-domain');

      // Does not contain Firefox-only action options menu
      expect(ids).not.toContain('lazarus-action-options');

      // Verify exact titles and contexts
      const root = createdMenus.find((m) => m.id === 'lazarus-root');
      expect(root).toEqual({
        id: 'lazarus-root',
        title: 'Lazarus Form Recovery',
        contexts: ['editable'],
      });

      const saveNow = createdMenus.find((m) => m.id === 'lazarus-save-now');
      expect(saveNow).toEqual({
        id: 'lazarus-save-now',
        parentId: 'lazarus-root',
        title: '⚡ Save Form Snapshot Now',
        contexts: ['editable'],
      });

      const formNone = createdMenus.find((m) => m.id === 'lazarus-form-none');
      expect(formNone).toEqual({
        id: 'lazarus-form-none',
        parentId: 'lazarus-recover-form-parent',
        title: 'No past versions on this page',
        enabled: false,
        contexts: ['editable'],
      });

      const disableDomain = createdMenus.find((m) => m.id === 'lazarus-disable-domain');
      expect(disableDomain).toEqual({
        id: 'lazarus-disable-domain',
        parentId: 'lazarus-root',
        title: '🚫 Disable Lazarus on this Site',
        contexts: ['editable'],
      });
    });

    it('registers Firefox toolbar action options menu when running in Firefox', () => {
      const getUrlSpy = vi
        .spyOn(chrome.runtime, 'getURL')
        .mockImplementation((p: string) => `moz-extension://uuid-mock/${p}`);

      setupContextMenus();

      const actionMenu = createdMenus.find((m) => m.id === 'lazarus-action-options');
      expect(actionMenu).toEqual({
        id: 'lazarus-action-options',
        title: '⚙️ Options',
        contexts: ['action'],
      });

      getUrlSpy.mockRestore();
    });
  });

  describe('Dynamic Context Menus & Formatting', () => {
    it('formats time labels and sanitizes previews across seconds, minutes, hours, and days', async () => {
      const now = Date.now();

      // Form revisions with various times: 10s ago, 15m ago, 2h ago, 3d ago
      vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([
        {
          form: {
            id: 'form_1',
            revisionNumber: 1,
            isFinalSubmit: false,
            lastModified: now - 10 * 1000, // 10s ago
          },
          fields: [],
        },
        {
          form: {
            id: 'form_2',
            revisionNumber: 2,
            isFinalSubmit: true,
            lastModified: now - 15 * 60 * 1000, // 15m ago
          },
          fields: [],
        },
        {
          form: {
            id: 'form_3',
            revisionNumber: 3,
            isFinalSubmit: false,
            lastModified: now - 2 * 3600 * 1000, // 2h ago
          },
          fields: [],
        },
        {
          form: {
            id: 'form_4',
            revisionNumber: 4,
            isFinalSubmit: true,
            lastModified: now - 3 * 86400 * 1000, // 3d ago
          },
          fields: [],
        },
      ]);

      // Field text snippets: normal snippet and a long snippet > 28 chars with whitespace
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
        {
          id: 'f1',
          formId: 'form_1',
          name: 'notes',
          type: 'textarea',
          value: 'Short snippet',
          lastModified: now - 45 * 1000, // 45s ago
        },
        {
          id: 'f2',
          formId: 'form_2',
          name: 'notes',
          type: 'textarea',
          value: 'This is a very long snippet of text that exceeds twenty eight characters easily',
          lastModified: now - 90 * 60 * 1000, // 1h ago
        },
      ]);

      await updateDynamicContextMenus('test.com', 'form-instance-1', 'notes', 'textarea');

      // Verify form revision items
      const rev0 = createdMenus.find((m) => m.id === 'lazarus-form-rev-0');
      expect(rev0).toBeDefined();
      expect(rev0.title).toBe('Rev 1 (Draft • Just now)');
      expect(rev0.parentId).toBe('lazarus-recover-form-parent');

      const rev1 = createdMenus.find((m) => m.id === 'lazarus-form-rev-1');
      expect(rev1.title).toBe('Rev 2 (Submitted • 15m ago)');

      const rev2 = createdMenus.find((m) => m.id === 'lazarus-form-rev-2');
      expect(rev2.title).toBe('Rev 3 (Draft • 2h ago)');

      const rev3 = createdMenus.find((m) => m.id === 'lazarus-form-rev-3');
      expect(rev3.title).toContain('Rev 4 (Submitted • ');

      // Verify field text snippets
      const snip0 = createdMenus.find((m) => m.id === 'lazarus-field-val-0');
      expect(snip0).toBeDefined();
      expect(snip0.title).toBe('"Short snippet" (Just now)');
      expect(snip0.parentId).toBe('lazarus-recover-field-parent');

      const snip1 = createdMenus.find((m) => m.id === 'lazarus-field-val-1');
      expect(snip1).toBeDefined();
      // Should be truncated to 28 chars with ...
      expect(snip1.title).toBe('"This is a very long snippet ..." (1h ago)');
    });

    it('renders placeholder items when form revisions or snippets are empty', async () => {
      vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([]);
      vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([]);

      await updateDynamicContextMenus('test.com', 'form-empty');

      const formNone = createdMenus.find((m) => m.id === 'lazarus-form-none');
      expect(formNone).toBeDefined();
      expect(formNone.title).toBe('No past versions on this page');

      const fieldNone = createdMenus.find((m) => m.id === 'lazarus-field-none');
      expect(fieldNone).toBeDefined();
      expect(fieldNone.title).toBe('No past snippets for this field');
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
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, undefined);
      await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, { id: 101 });
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
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

      chrome.runtime.openOptionsPage = origOpenOptions;
    });

    it('handles sidebar open via sidePanel.open, sidebarAction.open, and tabs.create fallback', async () => {
      // 1. sidePanel.open
      (chrome as any).sidePanel = { open: vi.fn().mockResolvedValue(undefined) };
      await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
      expect((chrome as any).sidePanel.open).toHaveBeenCalledWith({ windowId: 5 });

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

      // Invalid item index
      (chrome.tabs.sendMessage as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-form-rev-99' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
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

      // Invalid snippet index
      (chrome.tabs.sendMessage as any).mockClear();
      await handleContextMenuClick({ menuItemId: 'lazarus-field-val-99' }, mockTab);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
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
  });
});
