import { FormSnapshotData, FormRevisionPolicy, ExistingRevisionSummary } from '../domain/form-revision';
import { PiiSanitizer } from '../domain/pii-sanitizer';
import { ISaveFormDraftUseCase, SaveFormResult } from '../ports/inbound/save-form.port';
import { IFormRepositoryPort, StoredFormRecord, StoredFieldRecord } from '../ports/outbound/form-repository.port';
import { IVaultCryptoPort } from '../ports/outbound/vault-crypto.port';
import { IEphemeralStoragePort } from '../ports/outbound/ephemeral-cache.port';
import { IEventBroadcasterPort } from '../ports/outbound/event-broadcaster.port';

export class SaveFormDraftUseCase implements ISaveFormDraftUseCase {
  constructor(
    private readonly repository: IFormRepositoryPort,
    private readonly vault: IVaultCryptoPort,
    private readonly sessionCache: IEphemeralStoragePort,
    private readonly broadcaster: IEventBroadcasterPort
  ) {}

  public async execute(
    formSnapshot: FormSnapshotData,
    tabId?: number,
    forceNewRevision = false
  ): Promise<SaveFormResult> {
    const domain = formSnapshot.domain || 'unknown';
    const domainId = FormRevisionPolicy.normalizeDomain(domain);

    // 1. Check if domain is enabled
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

    // 2. Cache in ephemeral storage
    await this.sessionCache.saveEphemeralDraft(tabId, formSnapshot);

    const now = Date.now();
    const formInstanceId = formSnapshot.formInstanceId || 'form_default';

    // 3. Query existing revisions for this form instance
    const existing = await this.repository.getRevisionsByFormInstance(domainId, formInstanceId);
    const existingSummaries: ExistingRevisionSummary[] = existing.map(r => ({
      id: r.id,
      revisionId: r.revisionId,
      revisionNumber: r.revisionNumber,
      lastModified: r.lastModified,
      isFinalSubmit: r.isFinalSubmit,
    }));

    const latestRevision = existingSummaries[0];
    const maxRevisionNumber = existingSummaries.reduce((max, r) => Math.max(max, r.revisionNumber || 1), 0);

    // 4. Domain Decision: active update vs new revision
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latestRevision,
      maxRevisionNumber,
      domainId,
      formInstanceId,
      now,
      false, // isFinalSubmit
      forceNewRevision
    );

    // 5. Encrypt URL
    const { ciphertext: encUrl, mode: formEncMode } = await this.vault.encrypt(formSnapshot.url);

    // 6. Save Form Record
    const formRecord: StoredFormRecord = {
      id: decision.formId,
      domainId,
      url: encUrl,
      formInstanceId,
      revisionId: decision.revisionId,
      revisionNumber: decision.revisionNumber,
      isFinalSubmit: false,
      title: formSnapshot.title || domain,
      encryption: formEncMode,
      editingTime: formSnapshot.editingTime || 0,
      lastModified: now,
      status: 0,
    };
    await this.repository.saveFormRecord(formRecord);

    // 7. Sanitize, Encrypt, and Save Fields
    if (Array.isArray(formSnapshot.fields)) {
      const fieldRecords: StoredFieldRecord[] = [];

      for (const field of formSnapshot.fields) {
        if (!field.name && !field.value) continue;

        const sanitizedValue = PiiSanitizer.sanitize(field.value || '', field.name);
        const { ciphertext: encValue, mode: fieldEncMode } = await this.vault.encrypt(sanitizedValue);

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
          lastModified: now,
          status: 0,
        });
      }

      await this.repository.saveFieldRecords(fieldRecords);
    }

    // 8. Enforce 10-revision retention cap
    if (decision.shouldSpawnNewRevision) {
      const updatedRevisions = [
        { id: decision.formId, lastModified: now },
        ...existingSummaries.map(r => ({ id: r.id, lastModified: r.lastModified })),
      ];
      const toPrune = FormRevisionPolicy.calculateRevisionsToPrune(updatedRevisions);
      for (const pruneId of toPrune) {
        await this.repository.softDeleteRevision(pruneId);
      }
    }

    // 9. Broadcast Form Saved Event
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
      reason: decision.reason,
    };
  }
}
