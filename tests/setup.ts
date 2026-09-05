import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import pkg from '../package.json';

globalThis.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb?: any) {
    if (cb) cb();
  }
} as any;

// Mock Chrome extension APIs for headless unit testing
const messageListeners: Array<
  (message: any, sender: any, sendResponse: (res?: any) => void) => void
> = [];
const contextMenuClickListeners: Array<(info: any, tab: any) => void> = [];

const installedListeners: Array<() => void> = [];
const startupListeners: Array<() => void> = [];
const commandListeners: Array<(command: string) => any> = [];
const actionClickedListeners: Array<(tab: any) => any> = [];
const tabRemovedListeners: Array<(tabId: number) => any> = [];
const tabActivatedListeners: Array<(activeInfo: any) => any> = [];
const tabUpdatedListeners: Array<(tabId: number, changeInfo: any, tab: any) => any> = [];

const mockStorage: Record<string, any> = {};
const mockSessionStorage: Record<string, any> = {};

globalThis.chrome = {
  _testTriggers: {
    installed: async () => {
      for (const fn of [...installedListeners]) await fn();
    },
    startup: async () => {
      for (const fn of [...startupListeners]) await fn();
    },
    command: async (command: string) => {
      for (const fn of [...commandListeners]) await fn(command);
    },
    actionClick: async (tab: any) => {
      for (const fn of [...actionClickedListeners]) await fn(tab);
    },
    tabRemoved: async (tabId: number) => {
      for (const fn of [...tabRemovedListeners]) await fn(tabId);
    },
    tabActivated: async (activeInfo: any) => {
      for (const fn of [...tabActivatedListeners]) await fn(activeInfo);
    },
    tabUpdated: async (tabId: number, changeInfo: any, tab: any) => {
      for (const fn of [...tabUpdatedListeners]) await fn(tabId, changeInfo, tab);
    },
  },
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
      addListener: vi.fn((fn: any) => {
        installedListeners.push(fn);
      }),
    },
    onStartup: {
      addListener: vi.fn((fn: any) => {
        startupListeners.push(fn);
      }),
    },
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://mock/${path}`),
    getManifest: vi.fn(() => ({
      version: pkg.version,
      manifest_version: 3,
      name: 'Lazarus: Form Recovery',
    })),
    lastError: null,
  },
  commands: {
    onCommand: {
      addListener: vi.fn((fn: any) => {
        commandListeners.push(fn);
      }),
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
  action: {
    onClicked: {
      addListener: vi.fn((fn: any) => {
        actionClickedListeners.push(fn);
      }),
    },
  },
  sidePanel: {
    open: vi.fn(async () => {}),
    setPanelBehavior: vi.fn(async () => {}),
  },
  tabs: {
    query: vi.fn(async () => [{ id: 1, windowId: 100, active: true, url: 'https://example.com' }]),
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      windowId: 100,
      active: true,
      url: 'https://example.com',
    })),
    sendMessage: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ id: 2 })),
    onRemoved: {
      addListener: vi.fn((fn: any) => {
        tabRemovedListeners.push(fn);
      }),
    },
    onActivated: {
      addListener: vi.fn((fn: any) => {
        tabActivatedListeners.push(fn);
      }),
    },
    onUpdated: {
      addListener: vi.fn((fn: any) => {
        tabUpdatedListeners.push(fn);
      }),
    },
  },
} as unknown as typeof chrome;
