import {
  FormSnapshotData,
  FormRevisionPolicy,
  ExistingRevisionSummary,
} from '../domain/form-revision';
import { PiiSanitizer } from '../domain/pii-sanitizer';
import { ISubmitFormUseCase, SaveFormResult } from '../ports/inbound/save-form.port';
import {
  IFormRepositoryPort,
  StoredFormRecord,
  StoredFieldRecord,
} from '../ports/outbound/form-repository.port';
import { IVaultCryptoPort } from '../ports/outbound/vault-crypto.port';
import { IEphemeralStoragePort } from '../ports/outbound/ephemeral-cache.port';
import { IEventBroadcasterPort } from '../ports/outbound/event-broadcaster.port';

export class SubmitFormUseCase implements ISubmitFormUseCase {
  constructor(
    private readonly repository: IFormRepositoryPort,
    private readonly vault: IVaultCryptoPort,
    private readonly sessionCache: IEphemeralStoragePort,
    private readonly broadcaster: IEventBroadcasterPort
  ) {}

  public async execute(formSnapshot: FormSnapshotData, tabId?: number): Promise<SaveFormResult> {
    const domain = formSnapshot.domain || 'unknown';
    const domainId = FormRevisionPolicy.normalizeDomain(domain);

    const enabled = await this.repository.isDomainEnabled(domain);
    if (!enabled) {
      return {
        success: false,
        formId: '',
        domainId,
        revisionId: '',
        revisionNumber: 0,
        reason: 'domain_disabled',
        error: `Form recovery is disabled on ${domain}`,
      };
    }

    const now = Date.now();
    const formInstanceId = formSnapshot.formInstanceId || 'form_default';

    const existing = await this.repository.getRevisionsByFormInstance(domainId, formInstanceId);
    const existingSummaries: ExistingRevisionSummary[] = existing.map((r) => ({
      id: r.id,
      revisionId: r.revisionId,
      revisionNumber: r.revisionNumber,
      lastModified: r.lastModified,
      isFinalSubmit: r.isFinalSubmit,
    }));

    const latestRevision = existingSummaries[0];
    const maxRevisionNumber = existingSummaries.reduce(
      (max, r) => Math.max(max, r.revisionNumber || 1),
      0
    );

    const effectiveNow = Math.max(now, (latestRevision?.lastModified || 0) + 1);

    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latestRevision,
      maxRevisionNumber,
      domainId,
      formInstanceId,
      effectiveNow,
      true, // isFinalSubmit = true
      false
    );

    const { ciphertext: encUrl, mode: formEncMode } = await this.vault.encrypt(formSnapshot.url);

    const formRecord: StoredFormRecord = {
      id: decision.formId,
      domainId,
      url: encUrl,
      formInstanceId,
      revisionId: decision.revisionId,
      revisionNumber: decision.revisionNumber,
      isFinalSubmit: true,
      title: formSnapshot.title || domain,
      encryption: formEncMode,
      editingTime: formSnapshot.editingTime || 0,
      lastModified: effectiveNow,
      status: 0,
    };
    await this.repository.saveFormRecord(formRecord);

    if (Array.isArray(formSnapshot.fields)) {
      const fieldRecords: StoredFieldRecord[] = [];

      for (const field of formSnapshot.fields) {
        if (!field.name && !field.value) continue;

        const sanitizedValue = PiiSanitizer.sanitize(field.value || '', field.name);
        const { ciphertext: encValue, mode: fieldEncMode } =
          await this.vault.encrypt(sanitizedValue);

        const fieldName = field.name || 'field_anonymous';
        const fieldType = field.type || 'text';
        const fieldId = `${decision.formId}_${fieldName}_${fieldType}`;

        fieldRecords.push({
          id: fieldId,
          formId: decision.formId,
          domainId,
          revisionId: decision.revisionId,
          name: fieldName,
          type: fieldType,
          value: encValue,
          encryption: fieldEncMode,
          lastModified: effectiveNow,
          status: 0,
        });
      }

      await this.repository.saveFieldRecords(fieldRecords);
    }

    // Prune older revisions beyond the 10-revision cap
    const updatedRevisions = [
      { id: decision.formId, lastModified: now },
      ...existingSummaries.map((r) => ({ id: r.id, lastModified: r.lastModified })),
    ];
    const toPrune = FormRevisionPolicy.calculateRevisionsToPrune(updatedRevisions);
    for (const pruneId of toPrune) {
      await this.repository.softDeleteRevision(pruneId);
    }

    // Clean up ephemeral tab draft upon submission
    if (typeof tabId === 'number') {
      await this.sessionCache.clearTabDrafts(tabId);
    }

    this.broadcaster.broadcastFormSaved({
      domain,
      formInstanceId,
      revisionNumber: decision.revisionNumber,
      formId: decision.formId,
    });

    return {
      success: true,
      formId: decision.formId,
      domainId,
      revisionId: decision.revisionId,
      revisionNumber: decision.revisionNumber,
      reason: 'final_submit',
    };
  }
}
