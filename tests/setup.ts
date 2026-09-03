import 'fake-indexeddb/auto';
import { vi } from 'vitest';

globalThis.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb?: any) {
    if (cb) cb();
  }
} as any;

// Mock Chrome extension APIs for headless unit testing
const messageListeners: Array<(message: any, sender: any, sendResponse: (res?: any) => void) => void> = [];
const contextMenuClickListeners: Array<(info: any, tab: any) => void> = [];

const mockStorage: Record<string, any> = {};
const mockSessionStorage: Record<string, any> = {};

globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn((message: any) => {
      return new Promise((resolve) => {
        let responded = false;
        const sendResponse = (res?: any) => {
          responded = true;
          resolve(res);
        };
        for (const listener of messageListeners) {
          listener(message, {}, sendResponse);
        }
        setTimeout(() => {
          if (!responded) resolve({ success: true });
        }, 100);
      });
    }),
    onMessage: {
      addListener: vi.fn((fn: any) => {
        messageListeners.push(fn);
      }),
      removeListener: vi.fn((fn: any) => {
        const idx = messageListeners.indexOf(fn);
        if (idx !== -1) messageListeners.splice(idx, 1);
      }),
      hasListeners: vi.fn(() => messageListeners.length > 0),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://mock/${path}`),
    lastError: null,
  },
  commands: {
    onCommand: {
      addListener: vi.fn(),
    },
  },
  alarms: {
    create: vi.fn(),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
  contextMenus: {
    create: vi.fn((props: any, cb?: () => void) => {
      if (cb) cb();
    }),
    remove: vi.fn((id: string, cb?: () => void) => {
      if (cb) cb();
    }),
    removeAll: vi.fn((cb?: () => void) => {
      if (cb) cb();
    }),
    onClicked: {
      addListener: vi.fn((fn: any) => {
        contextMenuClickListeners.push(fn);
      }),
      removeListener: vi.fn((fn: any) => {
        const idx = contextMenuClickListeners.indexOf(fn);
        if (idx !== -1) contextMenuClickListeners.splice(idx, 1);
      }),
    },
  },
  storage: {
    local: {
      get: vi.fn(async (key: string | string[] | null) => {
        if (!key) return { ...mockStorage };
        if (typeof key === 'string') return { [key]: mockStorage[key] };
        const result: Record<string, any> = {};
        for (const k of key) result[k] = mockStorage[k];
        return result;
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockStorage, items);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          for (const k of key) delete mockStorage[k];
        } else {
          delete mockStorage[key];
        }
      }),
      clear: vi.fn(async () => {
        for (const k in mockStorage) delete mockStorage[k];
      }),
    },
    session: {
      get: vi.fn(async (key: string | string[] | null) => {
        if (!key) return { ...mockSessionStorage };
        if (typeof key === 'string') return { [key]: mockSessionStorage[key] };
        const result: Record<string, any> = {};
        for (const k of key) result[k] = mockSessionStorage[k];
        return result;
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockSessionStorage, items);
      }),
      remove: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          for (const k of key) delete mockSessionStorage[k];
        } else {
          delete mockSessionStorage[key];
        }
      }),
      clear: vi.fn(async () => {
        for (const k in mockSessionStorage) delete mockSessionStorage[k];
      }),
    },
  },
  sidePanel: {
    open: vi.fn(async () => {}),
  },
  tabs: {
    query: vi.fn(async () => [{ id: 1, windowId: 100 }]),
    sendMessage: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ id: 2 })),
    onRemoved: {
      addListener: vi.fn(),
    },
    onActivated: {
      addListener: vi.fn(),
    },
  },
} as unknown as typeof chrome;
