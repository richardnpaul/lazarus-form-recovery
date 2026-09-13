import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as runtimeUtils from '../../src/common/utils/runtime';
import { FormTracker } from '../../src/content/form-tracker';

describe('content-script.iife.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).__LAZARUS_TRACKER__;
  });

  it('executes initContentScript() on top-level evaluation', async () => {
    await import('../../src/content/content-script.iife');
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
  });

  it('boots and tracks forms, stopping previous trackers and logging', async () => {
    const csIife = await import('../../src/content/content-script.iife');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const startSpy = vi.spyOn(FormTracker.prototype, 'start');

    // 1. Existing tracker with valid stop()
    const stopMock = vi.fn();
    (window as any).__LAZARUS_TRACKER__ = { stop: stopMock };

    csIife.initContentScript();

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalled();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
    expect(logSpy).toHaveBeenCalledWith(
      'Lazarus Form Recovery: Content script loaded and tracking forms.'
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 2. Early return when extension context is invalid
    (window as any).__LAZARUS_TRACKER__ = 'sentinel_tracker';
    vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBe('sentinel_tracker');
    vi.restoreAllMocks();

    // 3. Existing tracker with non-function stop
    const nonFnWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).__LAZARUS_TRACKER__ = { stop: 'not_a_fn' };
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
    expect(nonFnWarnSpy).not.toHaveBeenCalled();

    // 4. Existing tracker without stop property
    (window as any).__LAZARUS_TRACKER__ = {};
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
    expect(nonFnWarnSpy).not.toHaveBeenCalled();

    // 5. Existing tracker whose stop() throws error
    const stopErr = new Error('StopFailed');
    (window as any).__LAZARUS_TRACKER__ = {
      stop: vi.fn(() => {
        throw stopErr;
      }),
    };
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
    expect(nonFnWarnSpy).toHaveBeenCalledWith('Failed to stop previous tracker:', stopErr);

    // 6. Existing tracker is null / undefined
    (window as any).__LAZARUS_TRACKER__ = null;
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);

    delete (window as any).__LAZARUS_TRACKER__;
    csIife.initContentScript();
    expect((window as any).__LAZARUS_TRACKER__).toBeInstanceOf(FormTracker);
  });
});
