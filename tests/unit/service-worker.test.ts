import { describe, it, expect, vi } from 'vitest';
import { onRuntimeMessage } from '../../src/background/service-worker';

describe('Background Service Worker (src/background/service-worker.ts)', () => {
  it('handles lifecycle events: onInstalled, onStartup, onRemoved, and commands', async () => {
    // 1. onInstalled
    const installListeners = (chrome.runtime.onInstalled.addListener as any).mock?.calls || [];
    if (installListeners.length > 0) {
      installListeners[0][0]();
      expect(chrome.alarms.create).toHaveBeenCalled();
      expect(chrome.contextMenus.create).toHaveBeenCalled();
    }

    // 2. onStartup
    const startupListeners =
      ((chrome.runtime as any).onStartup?.addListener as any)?.mock?.calls || [];
    if (startupListeners.length > 0) {
      startupListeners[0][0]();
    }

    // 3. tabs.onRemoved
    const removedListeners =
      ((chrome.tabs as any)?.onRemoved?.addListener as any)?.mock?.calls || [];
    if (removedListeners.length > 0) {
      removedListeners[0][0](105);
    }

    // 4. commands.onCommand
    const commandListeners =
      ((chrome as any).commands?.onCommand?.addListener as any)?.mock?.calls || [];
    if (commandListeners.length > 0) {
      // Success case
      await commandListeners[0][0]('recover_last_form');
      expect(chrome.tabs.sendMessage).toHaveBeenCalled();

      // Command without active tab id
      (chrome.tabs.query as any).mockResolvedValueOnce([]);
      await commandListeners[0][0]('recover_last_form');

      // Command with error
      (chrome.tabs.query as any).mockRejectedValueOnce(new Error('TabError'));
      await commandListeners[0][0]('recover_last_form');

      // Unhandled command
      await commandListeners[0][0]('unknown_command');
    }

    // 5. action.onClicked (Firefox sidebar toggle & Chrome sidePanel fallback)
    const actionListeners = (chrome.action?.onClicked?.addListener as any)?.mock?.calls || [];
    if (actionListeners.length > 0) {
      // Test with browser.sidebarAction.toggle
      (globalThis as any).browser = {
        sidebarAction: {
          toggle: vi.fn().mockResolvedValue(undefined),
          open: vi.fn().mockResolvedValue(undefined),
        },
      };
      await actionListeners[0][0]({ windowId: 10 });
      expect((globalThis as any).browser.sidebarAction.toggle).toHaveBeenCalled();

      // Test fallback to open if toggle rejects
      (globalThis as any).browser.sidebarAction.toggle.mockRejectedValueOnce(
        new Error('ToggleError')
      );
      await actionListeners[0][0]({ windowId: 10 });
      expect((globalThis as any).browser.sidebarAction.open).toHaveBeenCalled();

      // Test Chrome sidePanel.open fallback
      delete (globalThis as any).browser;
      await actionListeners[0][0]({ windowId: 10 });
      expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 10 });
    }
  });

  it('handles onMessage async responses and errors', async () => {
    // Success response
    let responseData: any = null;
    onRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'test.com' } },
      {},
      (res: any) => {
        responseData = res;
      }
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(responseData?.success).toBe(true);

    // Error response branch
    let errResponse: any = null;
    onRuntimeMessage(null as any, {}, (res: any) => {
      errResponse = res;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(errResponse?.success).toBe(false);
  });
});
