import { repository } from '../common/db/repository';

export function setupAlarms() {
  if (!chrome.alarms) return;

  // Run cleanup every 30 minutes
  chrome.alarms.create('cleanup-expired-forms', {
    periodInMinutes: 30,
  });
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanup-expired-forms') {
      try {
        const cleanedCount = await repository.cleanupExpiredForms();
        if (cleanedCount > 0) {
          console.log(`[Lazarus Alarm] Cleaned up ${cleanedCount} expired form records.`);
        }
      } catch (err) {
        console.error('[Lazarus Alarm] Error running cleanup:', err);
      }
    }
  });
}
