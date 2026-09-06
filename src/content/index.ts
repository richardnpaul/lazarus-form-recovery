import { FormTracker } from './form-tracker';
import { isExtensionContextValid } from '../common/utils/runtime';

if (isExtensionContextValid()) {
  const existingTracker = (window as any).__LAZARUS_TRACKER__;
  if (existingTracker && typeof existingTracker.stop === 'function') {
    try {
      existingTracker.stop();
    } catch {}
  }

  const tracker = new FormTracker();
  tracker.start();
  (window as any).__LAZARUS_TRACKER__ = tracker;
  console.log('Lazarus Form Recovery: Content script loaded and tracking forms.');
}
