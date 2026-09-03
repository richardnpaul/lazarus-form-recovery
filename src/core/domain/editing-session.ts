/**
 * Pure domain value object tracking continuous user typing session time,
 * with automatic idle gap detection and session resumption.
 */
export interface SessionState {
  startTime: number;
  lastActiveTime: number;
  totalActiveSeconds: number;
}

export class EditingSessionTracker {
  private static readonly IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle gap

  /**
   * Updates an editing session with a new activity timestamp, accumulating
   * active seconds if within idle bounds or resetting session start if expired.
   */
  public static recordActivity(
    previousState: SessionState | undefined,
    currentTime: number = Date.now()
  ): SessionState {
    if (!previousState) {
      return {
        startTime: currentTime,
        lastActiveTime: currentTime,
        totalActiveSeconds: 0,
      };
    }

    const elapsedMs = currentTime - previousState.lastActiveTime;

    if (elapsedMs > this.IDLE_THRESHOLD_MS) {
      // Idle gap exceeded: restart fresh editing session
      return {
        startTime: currentTime,
        lastActiveTime: currentTime,
        totalActiveSeconds: previousState.totalActiveSeconds,
      };
    }

    const additionalSeconds = Math.max(0, Math.round(elapsedMs / 1000));

    return {
      startTime: previousState.startTime,
      lastActiveTime: currentTime,
      totalActiveSeconds: previousState.totalActiveSeconds + additionalSeconds,
    };
  }
}
