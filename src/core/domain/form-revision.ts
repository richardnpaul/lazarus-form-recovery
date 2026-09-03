/**
 * Pure domain entity encapsulating Form Revisions, milestone calculations,
 * and 10-revision retention policies.
 */
export interface FieldData {
  name: string;
  type: string;
  value: string;
  selector?: string;
}

export interface FormSnapshotData {
  domain: string;
  url: string;
  title?: string;
  formInstanceId: string;
  editingTime?: number;
  fields: FieldData[];
}

export interface ExistingRevisionSummary {
  id: string;
  revisionId: string;
  revisionNumber: number;
  lastModified: number;
  isFinalSubmit?: boolean;
}

export interface RevisionDecision {
  shouldSpawnNewRevision: boolean;
  revisionId: string;
  revisionNumber: number;
  formId: string;
  reason: 'initial' | 'milestone_reached' | 'idle_timeout' | 'final_submit' | 'forced' | 'active_update';
}

export class FormRevisionPolicy {
  public static readonly MILESTONE_DURATION_MS = 5 * 60 * 1000; // 5 minutes continuous editing
  public static readonly SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes idle gap
  public static readonly MAX_REVISIONS_PER_FORM = 10;

  /**
   * Normalizes a domain or hostname into a clean lowercase identifier.
   */
  public static normalizeDomain(domain: string): string {
    return (domain || 'unknown').trim().toLowerCase();
  }

  /**
   * Generates a deterministic Form ID from domain, formInstance, and revisionId.
   */
  public static computeFormId(domainId: string, formInstanceId: string, revisionId: string): string {
    return `${domainId}_${formInstanceId}_${revisionId}`;
  }

  /**
   * Generates a unique revision ID based on timestamp and randomness.
   */
  public static generateRevisionId(timestamp: number = Date.now()): string {
    const randomSuffix = Math.random().toString(36).slice(2, 7);
    return `rev_${timestamp}_${randomSuffix}`;
  }

  /**
   * Extracts the creation timestamp from a revisionId string if formatted as rev_<timestamp>_*.
   */
  public static extractCreationTime(revisionId?: string, fallback: number = Date.now()): number {
    if (!revisionId) return fallback;
    const parts = revisionId.split('_');
    const parsed = parseInt(parts[1], 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * Decides whether to update the existing active revision or spawn a new milestone/submit revision.
   */
  public static evaluateRevisionDecision(
    latestRevision: ExistingRevisionSummary | undefined,
    maxRevisionNumber: number,
    domainId: string,
    formInstanceId: string,
    currentTime: number = Date.now(),
    isFinalSubmit = false,
    forceNewRevision = false
  ): RevisionDecision {
    if (!latestRevision) {
      const revisionId = this.generateRevisionId(currentTime);
      const revisionNumber = 1;
      return {
        shouldSpawnNewRevision: true,
        revisionId,
        revisionNumber,
        formId: this.computeFormId(domainId, formInstanceId, revisionId),
        reason: 'initial',
      };
    }

    if (forceNewRevision) {
      const revisionId = this.generateRevisionId(currentTime);
      const revisionNumber = maxRevisionNumber + 1;
      return {
        shouldSpawnNewRevision: true,
        revisionId,
        revisionNumber,
        formId: this.computeFormId(domainId, formInstanceId, revisionId),
        reason: 'forced',
      };
    }

    if (isFinalSubmit || latestRevision.isFinalSubmit) {
      const revisionId = this.generateRevisionId(currentTime);
      const revisionNumber = maxRevisionNumber + 1;
      return {
        shouldSpawnNewRevision: true,
        revisionId,
        revisionNumber,
        formId: this.computeFormId(domainId, formInstanceId, revisionId),
        reason: 'final_submit',
      };
    }

    const idleTime = currentTime - latestRevision.lastModified;
    if (idleTime >= this.SESSION_IDLE_TIMEOUT_MS) {
      const revisionId = this.generateRevisionId(currentTime);
      const revisionNumber = maxRevisionNumber + 1;
      return {
        shouldSpawnNewRevision: true,
        revisionId,
        revisionNumber,
        formId: this.computeFormId(domainId, formInstanceId, revisionId),
        reason: 'idle_timeout',
      };
    }

    const revisionCreationTime = this.extractCreationTime(latestRevision.revisionId, latestRevision.lastModified);
    const activeDuration = currentTime - revisionCreationTime;
    if (activeDuration >= this.MILESTONE_DURATION_MS) {
      const revisionId = this.generateRevisionId(currentTime);
      const revisionNumber = maxRevisionNumber + 1;
      return {
        shouldSpawnNewRevision: true,
        revisionId,
        revisionNumber,
        formId: this.computeFormId(domainId, formInstanceId, revisionId),
        reason: 'milestone_reached',
      };
    }

    // Active session update
    const revisionId = latestRevision.revisionId || `rev_${latestRevision.lastModified}`;
    const revisionNumber = latestRevision.revisionNumber || 1;
    return {
      shouldSpawnNewRevision: false,
      revisionId,
      revisionNumber,
      formId: latestRevision.id,
      reason: 'active_update',
    };
  }

  /**
   * Computes which revisions exceed the max cap of 10 and should be pruned (oldest first).
   */
  public static calculateRevisionsToPrune(
    revisions: { id: string; lastModified: number }[],
    maxRevisions = this.MAX_REVISIONS_PER_FORM
  ): string[] {
    if (revisions.length <= maxRevisions) return [];

    // Sort descending (newest first)
    const sorted = [...revisions].sort((a, b) => b.lastModified - a.lastModified);
    // Elements past maxRevisions are pruned
    return sorted.slice(maxRevisions).map(r => r.id);
  }
}
