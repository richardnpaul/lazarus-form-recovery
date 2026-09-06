import { describe, it, expect, vi } from 'vitest';
import {
  onRuntimeMessage,
  setupSidePanelBehavior,
  injectContentScriptIntoOpenTabs,
} from '../../src/background/service-worker';
import { sessionStorageManager } from '../../src/background/storage-manager';

describe('Background Service Worker (src/background/service-worker.ts)', () => {
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
  });

  it('handles lifecycle events: onInstalled and onStartup', async () => {
    const triggers = (chrome as any)._testTriggers;
    expect(triggers).toBeDefined();

    // onInstalled
    await triggers.installed();
    expect(chrome.alarms.create).toHaveBeenCalled();
    expect(chrome.contextMenus.create).toHaveBeenCalled();

    // onStartup
    await triggers.startup();
    expect(chrome.alarms.create).toHaveBeenCalled();
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

    // 1. Success case: active tab exists and message is sent
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 42, windowId: 10 }]);
    await triggers.command('recover_last_form');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'RESTORE_LAST_FORM' });

    // 2. Active tab has no id
    (chrome.tabs.query as any).mockResolvedValueOnce([{}]);
    await triggers.command('recover_last_form');

    // 3. No active tabs returned
    (chrome.tabs.query as any).mockResolvedValueOnce([]);
    await triggers.command('recover_last_form');

    // 4. Query throws error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (chrome.tabs.query as any).mockRejectedValueOnce(new Error('TabQueryFailed'));
    await triggers.command('recover_last_form');
    expect(consoleSpy).toHaveBeenCalledWith('Error handling command:', expect.any(Error));

    // 5. Unknown command ignored
    await triggers.command('other_command');
    consoleSpy.mockRestore();
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

    // Scenario B: browser.sidebarAction.toggle fails, falls back to browser.sidebarAction.open
    (globalThis as any).browser.sidebarAction.toggle.mockRejectedValueOnce(new Error('ToggleFail'));
    await triggers.actionClick({ windowId: 10 });
    expect((globalThis as any).browser.sidebarAction.open).toHaveBeenCalled();

    // Scenario C: browser.sidebarAction.open also fails
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as any).browser.sidebarAction.toggle.mockRejectedValueOnce(new Error('ToggleFail'));
    (globalThis as any).browser.sidebarAction.open.mockRejectedValueOnce(new Error('OpenFail'));
    await triggers.actionClick({ windowId: 10 });
    expect(consoleSpy).toHaveBeenCalledWith('Failed to open sidebarAction:', expect.any(Error));

    delete (globalThis as any).browser;
    consoleSpy.mockRestore();
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

    // 3. Tab without windowId
    sidePanelOpen.mockClear();
    await triggers.actionClick({});
    expect(sidePanelOpen).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('handles onMessage async responses and errors', async () => {
    // Success response
    let responseData: any = null;
    onRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'test.com' } },
      {} as any,
      (res: any) => {
        responseData = res;
      }
    );
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
    (chrome.tabs.query as any).mockResolvedValueOnce([
      { id: 101, url: 'https://example.com' },
      { id: 102, url: 'http://example.org' },
      { id: undefined, url: 'https://no-id.com' },
    ]);
    (chrome.scripting.executeScript as any).mockResolvedValue([]);

    await injectContentScriptIntoOpenTabs();

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 101, allFrames: true },
      files: ['src/content/content-script.iife.js'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 102, allFrames: true },
      files: ['src/content/content-script.iife.js'],
    });

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
    await expect(injectContentScriptIntoOpenTabs()).resolves.not.toThrow();
    (chrome as any).scripting = origScripting;
  });
});
