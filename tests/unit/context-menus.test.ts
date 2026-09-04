import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupContextMenus,
  updateDynamicContextMenus,
  handleContextMenuClick,
} from '../../src/background/context-menus';
import { repository } from '../../src/common/db/repository';

describe('Context Menus Manager (src/background/context-menus.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets up base context menus in Chrome (omitting duplicate action item)', () => {
    // Default mock has chrome-extension:// URL
    setupContextMenus();
    expect(chrome.contextMenus.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lazarus-action-options',
      })
    );
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lazarus-open-options',
        contexts: ['editable'],
      })
    );
  });

  it('sets up action options context menu in Firefox', () => {
    const spy = vi
      .spyOn(chrome.runtime, 'getURL')
      .mockImplementation((p: string) => `moz-extension://uuid-mock/${p}`);
    setupContextMenus();
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lazarus-action-options',
        contexts: ['action'],
      })
    );
    spy.mockRestore();
  });

  it('updates dynamic context menus with revisions and snippets', async () => {
    // Mock repository methods
    vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([
      {
        form: {
          id: 'test_form_1',
          revisionNumber: 1,
          isFinalSubmit: false,
          lastModified: Date.now() - 5000,
        },
        fields: [],
      },
    ]);
    vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
      {
        id: 'f1',
        formId: 'test_form_1',
        name: 'bio',
        type: 'textarea',
        value: 'Snippet text',
        lastModified: Date.now() - 5000,
      },
    ]);

    await updateDynamicContextMenus('test.com', 'form-1', 'bio', 'textarea');
    expect(chrome.contextMenus.create).toHaveBeenCalled();

    // Fallback when formInstanceId has no revisions -> calls getLatestFormRevisions
    vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([]);
    vi.spyOn(repository, 'getLatestFormRevisions').mockResolvedValueOnce([]);
    vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([]);

    await updateDynamicContextMenus('test.com', 'form-2');
    expect(chrome.contextMenus.create).toHaveBeenCalled();
  });

  it('handles context menu item clicks', async () => {
    const mockTab: any = { id: 99, url: 'https://example.com/login', windowId: 1 };

    // 1. Save now
    await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, { action: 'FORCE_SAVE_NOW' });

    // 2. Open sidebar (with sidePanel.open)
    (chrome as any).sidePanel = { open: vi.fn().mockResolvedValue(undefined) };
    await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect((chrome as any).sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });

    // 3. Open sidebar (with sidebarAction fallback)
    delete (chrome as any).sidePanel;
    (chrome as any).sidebarAction = { open: vi.fn() };
    await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect((chrome as any).sidebarAction.open).toHaveBeenCalled();

    // 4. Open sidebar (with tabs.create fallback)
    delete (chrome as any).sidebarAction;
    await handleContextMenuClick({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect(chrome.tabs.create).toHaveBeenCalled();

    // 5. Disable domain
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const disableSpy = vi.spyOn(repository, 'disableDomain').mockResolvedValue();
    await handleContextMenuClick({ menuItemId: 'lazarus-disable-domain' }, mockTab);
    expect(disableSpy).toHaveBeenCalledWith('example.com', false);

    // 6. Click form revision item & 7. Click field snippet item
    vi.spyOn(repository, 'getLatestFormRevisions').mockImplementation(async () => [
      {
        form: { id: 'form_99', revisionNumber: 1, isFinalSubmit: false, lastModified: Date.now() },
        fields: [],
      },
    ]);
    vi.spyOn(repository, 'getRecoverableText').mockImplementation(async () => [
      {
        id: 'f1',
        formId: 'form_99',
        name: 'bio',
        type: 'text',
        value: 'Snippet Text',
        lastModified: Date.now(),
      },
    ]);
    await updateDynamicContextMenus('example.com', undefined, 'bio', 'text');
    await handleContextMenuClick({ menuItemId: 'lazarus-form-rev-0' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
      action: 'RESTORE_FORM_REVISION',
      payload: { formId: 'form_99' },
    });

    await handleContextMenuClick({ menuItemId: 'lazarus-field-val-0' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
      action: 'RESTORE_FIELD_TEXT',
      payload: { value: 'Snippet Text' },
    });

    // Options / Settings handler (toolbar action or in-page root menu)
    await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    await handleContextMenuClick({ menuItemId: 'lazarus-open-options' }, mockTab);
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(2);

    // Options fallback to tabs.create when openOptionsPage is undefined
    const origOpenOptions = chrome.runtime.openOptionsPage;
    delete (chrome.runtime as any).openOptionsPage;
    await handleContextMenuClick({ menuItemId: 'lazarus-action-options' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://mock/src/options/options.html',
    });
    chrome.runtime.openOptionsPage = origOpenOptions;

    // Error in click handler (malformed URL)
    await handleContextMenuClick(
      { menuItemId: 'lazarus-save-now' },
      { id: 99, url: 'invalid-url' }
    );

    // Error in updateDynamicContextMenus
    vi.spyOn(repository, 'getLatestFormRevisions').mockRejectedValueOnce(new Error('DBFail'));
    await updateDynamicContextMenus('example.com');

    // Edge case: tab with no url
    await handleContextMenuClick({ menuItemId: 'lazarus-save-now' }, { id: 99 });
  });
});
