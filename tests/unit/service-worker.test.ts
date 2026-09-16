import { describe, it, expect, vi } from 'vitest';
import {
  initBackgroundServiceWorker,
  onRuntimeMessage,
  setupSidePanelBehavior,
  injectContentScriptIntoOpenTabs,
  handleActionClick,
} from '../../src/background/service-worker';
import { sessionStorageManager } from '../../src/background/storage-manager';

describe('Background Service Worker (src/background/service-worker.ts)', () => {
  it('executes top-level initialization on load', () => {
    expect((globalThis as any).__LAZARUS_SW_INITIALIZED__).toBe(true);
  });

  it('initializes alarms, context menus, and side panel behavior', () => {
    vi.clearAllMocks();
    const result = initBackgroundServiceWorker();
    expect(result).toBe(true);
    expect(chrome.alarms.create).toHaveBeenCalledWith('cleanup-expired-forms', {
      periodInMinutes: 30,
    });
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
  });

  it('handles side panel behavior initialization', async () => {
    // 1. chrome.sidePanel.setPanelBehavior succeeds
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    (chrome as any).sidePanel = { setPanelBehavior };
    setupSidePanelBehavior();
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });

    // 2. chrome.sidePanel.setPanelBehavior rejects (handled cleanly)
    setPanelBehavior.mockRejectedValueOnce(new Error('Rejected'));
    expect(() => setupSidePanelBehavior()).not.toThrow();

    // 3. chrome.sidePanel is undefined
    const origSidePanel = (chrome as any).sidePanel;
    delete (chrome as any).sidePanel;
    expect(() => setupSidePanelBehavior()).not.toThrow();
    (chrome as any).sidePanel = origSidePanel;

    // 4. chrome.sidePanel.setPanelBehavior is not a function
    (chrome as any).sidePanel = { setPanelBehavior: 'not-fn' };
    expect(() => setupSidePanelBehavior()).not.toThrow();
    (chrome as any).sidePanel = origSidePanel;
  });

  it('handles lifecycle events: onInstalled and onStartup', async () => {
    const triggers = (chrome as any)._testTriggers;
    expect(triggers).toBeDefined();

    // onInstalled
    vi.clearAllMocks();
    (chrome.tabs.query as any).mockResolvedValueOnce([]);
    await triggers.installed();
    expect(chrome.alarms.create).toHaveBeenCalled();
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*', 'file:///*'],
    });

    // onStartup
    vi.clearAllMocks();
    (chrome.tabs.query as any).mockResolvedValueOnce([]);
    await triggers.startup();
    expect(chrome.alarms.create).toHaveBeenCalled();
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*', 'file:///*'],
    });
  });

  it('handles tab lifecycle: onRemoved clears tab autosaves', async () => {
    const triggers = (chrome as any)._testTriggers;
    const clearSpy = vi
      .spyOn(sessionStorageManager, 'clearTabAutosaves')
      .mockResolvedValue(undefined);

    await triggers.tabRemoved(105);
    expect(clearSpy).toHaveBeenCalledWith(105);

    // Error in clearTabAutosaves is caught
    clearSpy.mockRejectedValueOnce(new Error('ClearFailed'));
    await expect(triggers.tabRemoved(106)).resolves.not.toThrow();
    clearSpy.mockRestore();
  });

  it('handles keyboard shortcut commands', async () => {
    const triggers = (chrome as any)._testTriggers;

    // 1. Success case: active tab in lastFocusedWindow exists and message is sent
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.sendMessage as any).mockClear();
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 42, windowId: 10 }]);
    await triggers.command('recover_last_form');
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'RESTORE_LAST_FORM' });

    // 1b. Active tab exists but sendMessage rejects (exercises .catch(() => {}))
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 43, windowId: 10 }]);
    (chrome.tabs.sendMessage as any).mockRejectedValueOnce(new Error('TabDisconnected'));
    await triggers.command('recover_last_form');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(43, { action: 'RESTORE_LAST_FORM' });

    // 2. Fallback when lastFocusedWindow query returns empty array
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.sendMessage as any).mockClear();
    (chrome.tabs.query as any).mockResolvedValueOnce([]);
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 99 }]);
    await triggers.command('recover_last_form');
    expect(chrome.tabs.query).toHaveBeenNthCalledWith(1, { active: true, lastFocusedWindow: true });
    expect(chrome.tabs.query).toHaveBeenNthCalledWith(2, { active: true, currentWindow: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, { action: 'RESTORE_LAST_FORM' });

    // 3. Both queries return empty
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.sendMessage as any).mockClear();
    (chrome.tabs.query as any).mockResolvedValue([]);
    const consoleErrorSpy = vi.spyOn(console, 'error');
    await triggers.command('recover_last_form');
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();

    // 4. Active tab has no id
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.sendMessage as any).mockClear();
    (chrome.tabs.query as any).mockResolvedValueOnce([{}]);
    await triggers.command('recover_last_form');
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

    // 5. Query throws error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (chrome.tabs.query as any).mockRejectedValueOnce(new Error('TabQueryFailed'));
    await triggers.command('recover_last_form');
    expect(consoleSpy).toHaveBeenCalledWith('Error handling command:', expect.any(Error));
    consoleSpy.mockRestore();

    // 6. Unknown command ignored
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.sendMessage as any).mockClear();
    await triggers.command('other_command');
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('handles action click: Firefox sidebarAction toggle and fallback to open', async () => {
    const triggers = (chrome as any)._testTriggers;

    // Scenario A: browser.sidebarAction.toggle succeeds
    (globalThis as any).browser = {
      sidebarAction: {
        toggle: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
      },
    };
    await triggers.actionClick({ windowId: 10 });
    expect((globalThis as any).browser.sidebarAction.toggle).toHaveBeenCalled();
    expect((globalThis as any).browser.sidebarAction.open).not.toHaveBeenCalled();

    // Scenario B: browser.sidebarAction.toggle fails
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as any).browser.sidebarAction.toggle.mockRejectedValueOnce(new Error('ToggleFail'));
    await triggers.actionClick({ windowId: 10 });
    expect(consoleSpy).toHaveBeenCalledWith('Failed to toggle sidebarAction:', expect.any(Error));

    // Scenario C: sidebarAction has only open (no toggle), and open succeeds
    consoleSpy.mockClear();
    (globalThis as any).browser.sidebarAction = {
      open: vi.fn().mockResolvedValue(undefined),
    };
    await triggers.actionClick({ windowId: 10 });
    expect((globalThis as any).browser.sidebarAction.open).toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    // Scenario D: sidebarAction has only open (no toggle), and open fails
    (globalThis as any).browser.sidebarAction.open.mockRejectedValueOnce(new Error('OpenFail'));
    await triggers.actionClick({ windowId: 10 });
    expect(consoleSpy).toHaveBeenCalledWith('Failed to open sidebarAction:', expect.any(Error));

    // Scenario E: sidebarAction has neither toggle nor open functions
    consoleSpy.mockClear();
    (globalThis as any).browser.sidebarAction = {};
    await triggers.actionClick({ windowId: 10 });
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    delete (globalThis as any).browser;
  });

  it('handles action click: Chrome sidePanel.open with windowId and error fallback', async () => {
    const triggers = (chrome as any)._testTriggers;
    const sidePanelOpen = vi.fn().mockResolvedValue(undefined);
    (chrome as any).sidePanel = { open: sidePanelOpen };

    // 1. Success with tab.windowId
    await triggers.actionClick({ windowId: 99 });
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 99 });

    // 2. Open throws error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sidePanelOpen.mockRejectedValueOnce(new Error('SidePanelOpenFail'));
    await triggers.actionClick({ windowId: 99 });
    expect(consoleSpy).toHaveBeenCalledWith('Failed to open sidePanel:', expect.any(Error));
    consoleSpy.mockRestore();

    // 3. Chrome sidePanel undefined when tab has windowId
    const origSidePanel = (chrome as any).sidePanel;
    delete (chrome as any).sidePanel;
    const noErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await triggers.actionClick({ windowId: 99 });
    expect(noErrSpy).not.toHaveBeenCalled();
    noErrSpy.mockRestore();
    (chrome as any).sidePanel = origSidePanel;

    // 4. Tab without windowId
    sidePanelOpen.mockClear();
    await triggers.actionClick({});
    expect(sidePanelOpen).not.toHaveBeenCalled();
    await handleActionClick({});
    expect(sidePanelOpen).not.toHaveBeenCalled();

    // 5. Tab is undefined or has invalid windowId
    await triggers.actionClick(undefined as any);
    expect(sidePanelOpen).not.toHaveBeenCalled();
    await handleActionClick(undefined as any);
    expect(sidePanelOpen).not.toHaveBeenCalled();
    await handleActionClick({ windowId: 'not-a-number' as any });
    expect(sidePanelOpen).not.toHaveBeenCalled();

    // 6. SidePanel open is not a function
    const notFnConsoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (chrome as any).sidePanel = { open: 'not-fn' };
    await handleActionClick({ windowId: 99 });
    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(notFnConsoleSpy).not.toHaveBeenCalled();
    notFnConsoleSpy.mockRestore();
    (chrome as any).sidePanel = origSidePanel;
  });

  it('handles action click: Firefox for Android tab creation fallback and error handling', async () => {
    const origSidePanel = (chrome as any).sidePanel;
    delete (chrome as any).sidePanel;

    // 1. Success with runtime.getURL
    (chrome.tabs.create as any).mockClear();
    await handleActionClick({ id: 1 });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://mock/src/sidepanel/sidepanel.html',
    });

    // 2. Success when runtime.getURL is not a function
    const origGetUrl = chrome.runtime.getURL;
    (chrome.runtime as any).getURL = null;
    (chrome.tabs.create as any).mockClear();
    await handleActionClick({ id: 2 });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'src/sidepanel/sidepanel.html',
    });
    chrome.runtime.getURL = origGetUrl;

    // 2b. Success when runtime is missing entirely
    const origRuntime = chrome.runtime;
    delete (chrome as any).runtime;
    (chrome.tabs.create as any).mockClear();
    await handleActionClick({ id: 22 });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'src/sidepanel/sidepanel.html',
    });
    (chrome as any).runtime = origRuntime;

    // 3. Error handling when tabs.create fails
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (chrome.tabs.create as any).mockRejectedValueOnce(new Error('TabCreateFailed'));
    await handleActionClick({ id: 3 });
    expect(consoleSpy).toHaveBeenCalledWith('Failed to open sidepanel tab:', expect.any(Error));
    consoleSpy.mockRestore();

    // 4. browserApi.tabs is undefined
    const consoleSpy2 = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origTabs = chrome.tabs;
    delete (chrome as any).tabs;
    await handleActionClick({ id: 4 });
    expect(consoleSpy2).not.toHaveBeenCalled();
    (chrome as any).tabs = origTabs;

    // 5. browserApi.tabs.create is not a function
    (chrome as any).tabs = { create: 'not-fn' };
    await handleActionClick({ id: 5 });
    expect(consoleSpy2).not.toHaveBeenCalled();
    (chrome as any).tabs = origTabs;
    consoleSpy2.mockRestore();

    (chrome as any).sidePanel = origSidePanel;
  });

  it('handles onMessage async responses and errors', async () => {
    // Success response and return value check
    let responseData: any = null;
    const keepOpen = onRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'test.com' } },
      {} as any,
      (res: any) => {
        responseData = res;
      }
    );
    expect(keepOpen).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(responseData?.success).toBe(true);

    // Error response branch via handleRuntimeMessage resolution
    let errResponse: any = null;
    onRuntimeMessage(null as any, {} as any, (res: any) => {
      errResponse = res;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(errResponse?.success).toBe(false);

    // Catch branch when handleRuntimeMessage rejects
    const router = await import('../../src/background/message-router');
    const routerSpy = vi
      .spyOn(router, 'handleRuntimeMessage')
      .mockRejectedValueOnce(new Error('RouterPanic'));
    let panicRes: any = null;
    onRuntimeMessage({ type: 'PING' } as any, {} as any, (res: any) => {
      panicRes = res;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(panicRes?.success).toBe(false);
    expect(panicRes?.error).toBe('RouterPanic');
    routerSpy.mockRestore();
  });

  it('injects content scripts into open tabs upon extension initialization', async () => {
    // 1. Successful injection into tabs
    (chrome.tabs.query as any).mockClear();
    (chrome.tabs.query as any).mockResolvedValueOnce([
      { id: 101, url: 'https://example.com' },
      { id: 102, url: 'http://example.org' },
      { id: undefined, url: 'https://no-id.com' },
    ]);
    (chrome.scripting.executeScript as any).mockResolvedValue([]);

    await injectContentScriptIntoOpenTabs();

    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*', 'file:///*'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 101, allFrames: true },
      files: ['src/content/content-script.iife.js'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 102, allFrames: true },
      files: ['src/content/content-script.iife.js'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ tabId: undefined }) })
    );

    // 2. Tab rejection is caught cleanly
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 103, url: 'https://rejected.com' }]);
    (chrome.scripting.executeScript as any).mockRejectedValueOnce(new Error('CannotAccessTab'));
    await expect(injectContentScriptIntoOpenTabs()).resolves.not.toThrow();

    // 3. Query error is logged and caught
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (chrome.tabs.query as any).mockRejectedValueOnce(new Error('QueryFailed'));
    await injectContentScriptIntoOpenTabs();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Lazarus] Content script injection failed:',
      expect.any(Error)
    );
    warnSpy.mockRestore();

    // 4. Missing chrome.scripting returns early
    const origScripting = chrome.scripting;
    delete (chrome as any).scripting;
    (chrome.tabs.query as any).mockClear();
    await expect(injectContentScriptIntoOpenTabs()).resolves.not.toThrow();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    (chrome as any).scripting = origScripting;

    // 5. Missing chrome.tabs returns early without error
    const origTabs = chrome.tabs;
    delete (chrome as any).tabs;
    const warnSpyTabs = vi.spyOn(console, 'warn');
    await expect(injectContentScriptIntoOpenTabs()).resolves.not.toThrow();
    expect(warnSpyTabs).not.toHaveBeenCalled();
    warnSpyTabs.mockRestore();
    (chrome as any).tabs = origTabs;

    // 6. Missing browserApi entirely returns early
    const origChrome = (globalThis as any).chrome;
    const origBrowser = (globalThis as any).browser;
    delete (globalThis as any).chrome;
    delete (globalThis as any).browser;
    await expect(injectContentScriptIntoOpenTabs()).resolves.not.toThrow();
    (globalThis as any).chrome = origChrome;
    (globalThis as any).browser = origBrowser;
  });
});
