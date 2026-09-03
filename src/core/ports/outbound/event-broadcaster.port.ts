export interface FormSavedEventPayload {
  domain: string;
  formInstanceId: string;
  revisionNumber: number;
  formId: string;
}

export interface IEventBroadcasterPort {
  broadcastFormSaved(payload: FormSavedEventPayload): void;
  broadcastRefresh(): void;
}
