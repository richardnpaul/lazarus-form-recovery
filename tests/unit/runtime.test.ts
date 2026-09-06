import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isExtensionContextValid,
  safeSendMessage,
  safeGetURL,
} from '../../src/common/utils/runtime';
import { FormTracker } from '../../src/content/form-tracker';

describe('Runtime Utilities (src/common/utils/runtime.ts)', () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    globalThis.chrome = {
      runtime: {
        id: 'valid-extension-id',
        sendMessage: vi.fn().mockResolvedValue({ success: true, data: 'test' }),
        getURL: vi.fn((path: string) => `chrome-extension://valid-id/${path}`),
      },
    } as any;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  describe('isExtensionContextValid', () => {
    it('returns true when chrome.runtime.id is a non-empty string', () => {
      expect(isExtensionContextValid()).toBe(true);
    });

    it('returns false when chrome is undefined', () => {
      delete (globalThis as any).chrome;
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when chrome.runtime is undefined', () => {
      (globalThis as any).chrome = {};
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when chrome.runtime.id is undefined (context invalidated)', () => {
      delete (globalThis as any).chrome.runtime.id;
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when chrome.runtime.id is an empty string', () => {
      (globalThis as any).chrome.runtime.id = '';
      expect(isExtensionContextValid()).toBe(false);
    });

    it('returns false when accessing chrome.runtime throws', () => {
      Object.defineProperty(globalThis.chrome, 'runtime', {
        get() {
          throw new Error('Extension context invalidated.');
        },
        configurable: true,
      });
      expect(isExtensionContextValid()).toBe(false);
    });
  });

  describe('safeSendMessage', () => {
    it('sends message and returns resolved response when context is valid', async () => {
      const res = await safeSendMessage({ type: 'PING' });
      expect(res).toEqual({ success: true, data: 'test' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PING' });
    });

    it('returns null immediately without calling runtime when context is invalid', async () => {
      delete (globalThis as any).chrome.runtime.id;
      const res = await safeSendMessage({ type: 'PING' });
      expect(res).toBeNull();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('catches synchronous Error: Extension context invalidated and returns null', async () => {
      (chrome.runtime.sendMessage as any).mockImplementation(() => {
        throw new Error('Extension context invalidated.');
      });

      const res = await safeSendMessage({ type: 'TEST' });
      expect(res).toBeNull();
    });

    it('catches asynchronous rejection with Extension context invalidated and returns null', async () => {
      (chrome.runtime.sendMessage as any).mockRejectedValue(
        new Error('Extension context invalidated.')
      );

      const res = await safeSendMessage({ type: 'TEST' });
      expect(res).toBeNull();
    });

    it('catches asynchronous rejection with Receiving end does not exist and returns null', async () => {
      (chrome.runtime.sendMessage as any).mockRejectedValue(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      const res = await safeSendMessage({ type: 'TEST' });
      expect(res).toBeNull();
    });

    it('re-throws non-invalidation errors for caller handling', async () => {
      (chrome.runtime.sendMessage as any).mockRejectedValue(new Error('DatabaseError'));
      await expect(safeSendMessage({ type: 'TEST' })).rejects.toThrow('DatabaseError');
    });
  });

  describe('safeGetURL', () => {
    it('returns formatted extension URL when context is valid', () => {
      expect(safeGetURL('options.html')).toBe('chrome-extension://valid-id/options.html');
    });

    it('returns null when context is invalid', () => {
      delete (globalThis as any).chrome.runtime.id;
      expect(safeGetURL('options.html')).toBeNull();
    });

    it('returns null when chrome.runtime.getURL throws', () => {
      (chrome.runtime.getURL as any).mockImplementation(() => {
        throw new Error('Access denied');
      });
      expect(safeGetURL('options.html')).toBeNull();
    });
  });

  describe('FormTracker auto-stop on context invalidation', () => {
    it('silently stops and removes listeners if context becomes invalid during an event', () => {
      const container = document.createElement('div');
      const input = document.createElement('input');
      input.name = 'email';
      input.type = 'text';
      container.appendChild(input);
      document.body.appendChild(container);

      const tracker = new FormTracker(container);
      tracker.start();

      // Simulate context invalidation (extension reload)
      delete (globalThis as any).chrome.runtime.id;

      // Simulate user typing on the page
      input.value = 'user@example.com';
      expect(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }).not.toThrow();

      // Ensure no runtime messages were sent after invalidation
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

      container.remove();
    });

    it('removes lazarus-recovery-host when stop is invoked', () => {
      const host = document.createElement('lazarus-recovery-host');
      document.documentElement.appendChild(host);
      expect(document.querySelector('lazarus-recovery-host')).toBe(host);

      const tracker = new FormTracker();
      tracker.stop();

      expect(document.querySelector('lazarus-recovery-host')).toBeNull();
    });
  });
});
