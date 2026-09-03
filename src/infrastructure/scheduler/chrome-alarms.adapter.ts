import { ISchedulerPort, AlarmJob } from '../../core/ports/outbound/scheduler.port';

export class ChromeAlarmsAdapter implements ISchedulerPort {
  public registerAlarm(job: AlarmJob): void {
    if (!chrome.alarms) return;

    chrome.alarms.create(job.name, {
      periodInMinutes: job.periodInMinutes,
    });
  }

  public onAlarm(handler: (name: string) => Promise<void>): void {
    if (!chrome.alarms) return;

    chrome.alarms.onAlarm.addListener((alarm) => {
      handler(alarm.name).catch((err) => {
        console.error(`[Lazarus Alarm] Error running alarm job ${alarm.name}:`, err);
      });
    });
  }
}

export const defaultScheduler = new ChromeAlarmsAdapter();
