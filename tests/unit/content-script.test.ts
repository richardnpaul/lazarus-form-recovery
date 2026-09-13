import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as runtimeUtils from '../../src/common/utils/runtime';

describe('Content Script Entrypoints (content-script.ts and content-script.iife.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).__LAZARUS_TRACKER__;
  });

  it('imports and boots src/content/content-script.ts without error', async () => {
    const cs = await import('../../src/content/content-script');
    expect((window as any).__LAZARUS_TRACKER__).toBeDefined();

    // Test invalid context branch
    vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValueOnce(false);
    cs.initContentScript();

    // Test existing tracker with stop() throwing an error
    (window as any).__LAZARUS_TRACKER__ = {
      stop: vi.fn(() => {
        throw new Error('StopFailed');
      }),
    };
    cs.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeDefined();
  });

  it('imports and boots src/content/content-script.iife.ts without error', async () => {
    const csIife = await import('../../src/content/content-script.iife');
    expect((window as any).__LAZARUS_TRACKER__).toBeDefined();

    // Test invalid context branch
    vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValueOnce(false);
    csIife.initContentScript();

    // Test existing tracker with stop() throwing an error
    (window as any).__LAZARUS_TRACKER__ = {
      stop: vi.fn(() => {
        throw new Error('StopFailed');
      }),
    };
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeDefined();
  });
});
