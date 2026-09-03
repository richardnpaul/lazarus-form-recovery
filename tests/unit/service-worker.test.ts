import { describe, it, expect, vi } from 'vitest';
import '../../src/background/service-worker';

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
    const startupListeners = ((chrome.runtime as any).onStartup?.addListener as any)?.mock?.calls || [];
    if (startupListeners.length > 0) {
      startupListeners[0][0]();
    }

    // 3. tabs.onRemoved
    const removedListeners = ((chrome.tabs as any)?.onRemoved?.addListener as any)?.mock?.calls || [];
    if (removedListeners.length > 0) {
      removedListeners[0][0](105);
    }

    // 4. commands.onCommand
    const commandListeners = ((chrome as any).commands?.onCommand?.addListener as any)?.mock?.calls || [];
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
  });

  it('handles onMessage async responses and errors', async () => {
    // Find onMessage listener
    const onMessageListeners = (chrome.runtime.onMessage.addListener as any).mock?.calls || [];
    expect(onMessageListeners.length).toBeGreaterThan(0);
    const msgHandler = onMessageListeners[0][0];

    // Success response
    let responseData: any = null;
    msgHandler({ type: 'IS_DOMAIN_ENABLED', payload: { domain: 'test.com' } }, {}, (res: any) => {
      responseData = res;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(responseData?.success).toBe(true);

    // Error response branch
    let errResponse: any = null;
    msgHandler(null as any, {}, (res: any) => {
      errResponse = res;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(errResponse?.success).toBe(false);
  });
});
