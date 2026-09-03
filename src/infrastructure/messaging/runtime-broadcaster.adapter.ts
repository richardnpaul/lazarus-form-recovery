import {
  IEventBroadcasterPort,
  FormSavedEventPayload,
} from '../../core/ports/outbound/event-broadcaster.port';

export class RuntimeBroadcasterAdapter implements IEventBroadcasterPort {
  public broadcastFormSaved(payload: FormSavedEventPayload): void {
    try {
      chrome.runtime
        ?.sendMessage?.({
          type: 'FORM_SAVED',
          payload,
        })
        .catch?.(() => {});
    } catch {
      // Ignored if no receiver is active
    }
  }

  public broadcastRefresh(): void {
    try {
      chrome.runtime
        ?.sendMessage?.({
          type: 'REFRESH_HISTORY',
        })
        .catch?.(() => {});
    } catch {
      // Ignored if no receiver is active
    }
  }
}

export const defaultBroadcaster = new RuntimeBroadcasterAdapter();
