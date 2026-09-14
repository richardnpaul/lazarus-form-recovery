import { FormTracker } from './form-tracker';
import { isExtensionContextValid } from '../common/utils/runtime';

export function initContentScript() {
  if (!isExtensionContextValid()) {
    return;
  }

  // Stop any previous tracker instance (e.g. before extension reload or re-injection)
  const existingTracker = (window as any).__LAZARUS_TRACKER__;
  if (typeof existingTracker?.stop === 'function') {
    try {
      existingTracker.stop();
    } catch (e) {
      console.warn('Failed to stop previous tracker:', e);
    }
  }

  const tracker = new FormTracker();
  tracker.start();
  (window as any).__LAZARUS_TRACKER__ = tracker;
  console.log('Lazarus Form Recovery: Content script loaded and tracking forms.');
}

initContentScript();
