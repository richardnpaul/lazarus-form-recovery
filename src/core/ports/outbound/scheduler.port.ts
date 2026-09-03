export interface AlarmJob {
  name: string;
  periodInMinutes: number;
}

export interface ISchedulerPort {
  registerAlarm(job: AlarmJob): void;
  onAlarm(handler: (name: string) => Promise<void>): void;
}
