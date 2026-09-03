import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupContextMenus, updateDynamicContextMenus } from '../../src/background/context-menus';
import { repository } from '../../src/common/db/repository';

let clickHandler: ((info: any, tab: any) => Promise<void>) | null = null;

describe('Context Menus Manager (src/background/context-menus.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const calls = (chrome.contextMenus.onClicked.addListener as any).mock?.calls || [];
    if (calls.length > 0) {
      clickHandler = calls[0][0];
    }
  });

  it('sets up base context menus', () => {
    setupContextMenus();
    expect(chrome.contextMenus.create).toHaveBeenCalled();
  });

  it('updates dynamic context menus with revisions and snippets', async () => {
    // Mock repository methods
    vi.spyOn(repository, 'getFormRevisions').mockResolvedValueOnce([
      {
        form: { id: 'test_form_1', revisionNumber: 1, isFinalSubmit: false, lastModified: Date.now() - 5000 },
        fields: [],
      },
    ]);
    vi.spyOn(repository, 'getRecoverableText').mockResolvedValueOnce([
      { id: 'f1', formId: 'test_form_1', name: 'bio', type: 'textarea', value: 'Snippet text', lastModified: Date.now() - 5000 },
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
    expect(clickHandler).not.toBeNull();
    if (!clickHandler) return;

    const mockTab: any = { id: 99, url: 'https://example.com/login', windowId: 1 };

    // 1. Save now
    await clickHandler({ menuItemId: 'lazarus-save-now' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, { action: 'FORCE_SAVE_NOW' });

    // 2. Open sidebar (with sidePanel.open)
    (chrome as any).sidePanel = { open: vi.fn().mockResolvedValue(undefined) };
    await clickHandler({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect((chrome as any).sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });

    // 3. Open sidebar (with sidebarAction fallback)
    delete (chrome as any).sidePanel;
    (chrome as any).sidebarAction = { open: vi.fn() };
    await clickHandler({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect((chrome as any).sidebarAction.open).toHaveBeenCalled();

    // 4. Open sidebar (with tabs.create fallback)
    delete (chrome as any).sidebarAction;
    await clickHandler({ menuItemId: 'lazarus-open-sidebar' }, mockTab);
    expect(chrome.tabs.create).toHaveBeenCalled();

    // 5. Disable domain
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const disableSpy = vi.spyOn(repository, 'disableDomain').mockResolvedValue();
    await clickHandler({ menuItemId: 'lazarus-disable-domain' }, mockTab);
    expect(disableSpy).toHaveBeenCalledWith('example.com', false);

    // 6. Click form revision item & 7. Click field snippet item
    vi.spyOn(repository, 'getLatestFormRevisions').mockImplementation(async () => [
      { form: { id: 'form_99', revisionNumber: 1, isFinalSubmit: false, lastModified: Date.now() }, fields: [] }
    ]);
    vi.spyOn(repository, 'getRecoverableText').mockImplementation(async () => [
      { id: 'f1', formId: 'form_99', name: 'bio', type: 'text', value: 'Snippet Text', lastModified: Date.now() }
    ]);
    await updateDynamicContextMenus('example.com', undefined, 'bio', 'text');
    await clickHandler({ menuItemId: 'lazarus-form-rev-0' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
      action: 'RESTORE_FORM_REVISION',
      payload: { formId: 'form_99' },
    });

    await clickHandler({ menuItemId: 'lazarus-field-val-0' }, mockTab);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
      action: 'RESTORE_FIELD_TEXT',
      payload: { value: 'Snippet Text' },
    });

    // Error in click handler (malformed URL)
    await clickHandler({ menuItemId: 'lazarus-save-now' }, { id: 99, url: 'invalid-url' });

    // Error in updateDynamicContextMenus
    vi.spyOn(repository, 'getLatestFormRevisions').mockRejectedValueOnce(new Error('DBFail'));
    await updateDynamicContextMenus('example.com');

    // Edge case: tab with no url
    await clickHandler({ menuItemId: 'lazarus-save-now' }, { id: 99 });
  });
});
