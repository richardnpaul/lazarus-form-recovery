import { db } from './lazarus-db';
import { IDBForm, IDBField } from '../types/schema';
import { ExtensionSettings, DEFAULT_SETTINGS } from '../types/config';
import { FormSnapshot } from '../types/messages';
import { vault } from '../crypto/vault';
import Dexie from 'dexie';

/**
 * Normalizes a hostname or domain string into a lowercase trimmed string.
 */
export function normalizeDomainId(domain: string): string {
  if (!domain) return 'unknown';
  let clean = domain.trim().toLowerCase();
  clean = clean.replace(/^[a-z]+:\/\//, '');
  clean = clean.split('/')[0];
  clean = clean.split(':')[0];
  return clean || 'unknown';
}

/**
 * Validates whether a domain matches a wildcard pattern.
 * e.g., "mail.google.com" matches "*.google.com".
 */
export function matchesDomainPattern(hostname: string, pattern: string): boolean {
  const normHost = hostname.toLowerCase();
  const normPattern = pattern.toLowerCase().trim();

  if (normHost === normPattern) return true;

  // Convert wildcard pattern to regex
  const regexPattern =
    '^' + normPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';

  return new RegExp(regexPattern).test(normHost);
}

export class LazarusRepository {
  /**
   * Retrieves extension settings from the database, falling back to defaults.
   */
  public async getSettings(): Promise<ExtensionSettings> {
    const records = await db.settings.toArray();
    const settings: ExtensionSettings = { ...DEFAULT_SETTINGS };

    for (const record of records) {
      if (record.key in settings) {
        (settings as any)[record.key] = record.value;
      }
    }
    return settings;
  }

  /**
   * Updates settings in the database.
   */
  public async updateSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const now = Date.now();
    for (const [key, value] of Object.entries(patch)) {
      await db.settings.put({
        key,
        value,
        lastModified: now,
      });
    }
    return await this.getSettings();
  }

  /**
   * Checks whether tracking is enabled on a domain against user-defined blocklist patterns.
   */
  public async isDomainEnabled(hostname: string): Promise<boolean> {
    const settings = await this.getSettings();
    for (const pattern of settings.disabledDomains) {
      if (matchesDomainPattern(hostname, pattern)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Disables tracking on a domain and optionally wipes existing records.
   */
  public async disableDomain(domain: string, wipeExisting = false): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.disabledDomains.includes(domain)) {
      settings.disabledDomains.push(domain);
      await this.updateSettings({ disabledDomains: settings.disabledDomains });
    }

    if (wipeExisting) {
      const domainId = normalizeDomainId(domain);
      await db.forms.where('domainId').equals(domainId).delete();
      await db.fields.where('domainId').equals(domainId).delete();
      await db.domains.where('id').equals(domainId).delete();
    }
  }

  /**
   * Enables tracking on a domain by removing it from the disabledDomains list.
   */
  public async enableDomain(domain: string): Promise<void> {
    const settings = await this.getSettings();
    const updated = settings.disabledDomains.filter((d) => d !== domain);
    await this.updateSettings({ disabledDomains: updated });
  }

  /**
   * Persists a form snapshot into IndexedDB with multi-version revision support.
   * Debounced typing updates the active editing session's revision, while form
   * submissions or new sessions spawn new chronological revisions.
   */
  public async saveFormSnapshot(
    snapshot: FormSnapshot,
    isFinalSubmit = false,
    forceNewRevision = false
  ): Promise<{ formId: string; domainId: string; revisionId: string; revisionNumber: number }> {
    const domain = snapshot.domain || 'unknown';
    const domainId = normalizeDomainId(domain);
    const now = Date.now();
    const formInstanceId = snapshot.formInstanceId || 'form_default';

    // 1. Find existing revisions for this domain and formInstanceId
    let existingRevisions: IDBForm[] = [];
    try {
      existingRevisions = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter((f) => f.formInstanceId === formInstanceId && f.status === 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      existingRevisions = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.formInstanceId === formInstanceId && f.status === 0)
        .reverse()
        .sortBy('lastModified');
    }

    const latestRevision = existingRevisions[0];
    const maxRevisionNumber = existingRevisions.reduce(
      (max, r) => Math.max(max, r.revisionNumber || 1),
      0
    );

    // Milestones: 5 minutes of active editing within a revision, or 15 minutes of idle
    const MILESTONE_DURATION_MS = 5 * 60 * 1000;
    const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

    let revisionCreationTime = now;
    if (latestRevision?.revisionId) {
      const parts = latestRevision.revisionId.split('_');
      const parsedTime = parseInt(parts[1], 10);
      if (!isNaN(parsedTime)) {
        revisionCreationTime = parsedTime;
      }
    }

    const isRevisionMilestoneReached = now - revisionCreationTime >= MILESTONE_DURATION_MS;
    const isIdleTimeout = latestRevision
      ? now - latestRevision.lastModified >= SESSION_IDLE_TIMEOUT_MS
      : true;

    const shouldSpawnNewRevision =
      forceNewRevision ||
      isFinalSubmit ||
      !latestRevision ||
      latestRevision.isFinalSubmit ||
      isIdleTimeout ||
      isRevisionMilestoneReached;

    let revisionId: string;
    let revisionNumber: number;
    let formId: string;

    if (!shouldSpawnNewRevision) {
      // Update existing active session revision
      revisionId = latestRevision.revisionId || `rev_${latestRevision.lastModified}`;
      revisionNumber = latestRevision.revisionNumber || 1;
      formId = latestRevision.id;
    } else {
      // Create a brand new revision snapshot
      revisionId = `rev_${now}_${Math.random().toString(36).slice(2, 7)}`;
      revisionNumber = maxRevisionNumber + 1;
      formId = `${domainId}_${formInstanceId}_${revisionId}`;
    }

    // 2. Update Domain aggregate stats
    const existingDomain = await db.domains.get(domainId);
    await db.domains.put({
      id: domainId,
      domain,
      totalEditingTime: (existingDomain?.totalEditingTime || 0) + (snapshot.editingTime || 0),
      lastModified: now,
      status: 0,
    });

    // 3. Encrypt URL if vault active
    const { ciphertext: encUrl, mode: encMode } = await vault.encrypt(snapshot.url || '');

    // 4. Update Form Record
    await db.forms.put({
      id: formId,
      domainId,
      url: encUrl,
      formInstanceId,
      revisionId,
      revisionNumber,
      isFinalSubmit,
      title: snapshot.title || domain,
      encryption: encMode,
      editingTime: snapshot.editingTime || 0,
      lastModified: now,
      status: 0,
    });

    // 5. Update Fields
    if (Array.isArray(snapshot.fields)) {
      for (const field of snapshot.fields) {
        if (!field.name && !field.value) continue;
        const fieldName = field.name || 'field_anonymous';
        const fieldType = field.type || 'text';
        const fieldId = `${formId}_${fieldName}_${fieldType}`;

        const { ciphertext: encValue, mode: fieldEncMode } = await vault.encrypt(field.value || '');

        await db.fields.put({
          id: fieldId,
          formId,
          domainId,
          revisionId,
          name: fieldName,
          type: fieldType,
          value: encValue,
          encryption: fieldEncMode,
          lastModified: now,
          status: 0,
        });
      }
    }

    // 6. Revision pruning: Cap at 10 revisions per form instance
    if (existingRevisions.length >= 10) {
      const revisionsToPrune = existingRevisions.slice(9);
      for (const oldRev of revisionsToPrune) {
        if (!oldRev.isFinalSubmit) {
          await db.forms.delete(oldRev.id);
          await db.fields.where('formId').equals(oldRev.id).delete();
        }
      }
    }

    return { formId, domainId, revisionId, revisionNumber };
  }

  /**
   * Retrieves recoverable text drafts for a specific field across all historical revisions,
   * returning unique values sorted by lastModified DESC.
   */
  public async getRecoverableText(
    domain: string,
    fieldName: string,
    fieldType: string
  ): Promise<any[]> {
    const domainId = normalizeDomainId(domain);

    // 1. Exact match by [domainId+name+type]
    let fields: IDBField[] = [];
    try {
      fields = await db.fields
        .where('[domainId+name+type]')
        .equals([domainId, fieldName, fieldType])
        .filter((f) => f.status === 0 && f.value.trim().length > 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      fields = await db.fields
        .where('domainId')
        .equals(domainId)
        .filter(
          (f) =>
            f.status === 0 &&
            f.name === fieldName &&
            f.type === fieldType &&
            f.value.trim().length > 0
        )
        .reverse()
        .sortBy('lastModified');
    }

    // 2. Fallback to any field with this name on domain
    if (fields.length === 0) {
      fields = await db.fields
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.status === 0 && f.name === fieldName && f.value.trim().length > 0)
        .reverse()
        .sortBy('lastModified');
    }

    // 3. Fallback to any recent field on domain
    if (fields.length === 0) {
      fields = await db.fields
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.status === 0 && f.value.trim().length > 0)
        .reverse()
        .sortBy('lastModified');
    }

    const decryptedList = await Promise.all(
      fields.map(async (f) => {
        let val = f.value;
        try {
          val = await vault.decrypt(f.value, f.encryption);
        } catch {
          val = '[Locked Draft - Enter Master Password]';
        }
        return {
          id: f.id,
          formId: f.formId,
          revisionId: f.revisionId,
          name: f.name,
          type: f.type,
          value: val,
          lastModified: f.lastModified,
        };
      })
    );

    // Deduplicate unique values across revisions, keeping the latest timestamp
    const uniqueValues: any[] = [];
    const seenValues = new Set<string>();

    for (const item of decryptedList) {
      const normalized = item.value.trim();
      if (!seenValues.has(normalized)) {
        seenValues.add(normalized);
        uniqueValues.push(item);
      }
    }

    return uniqueValues.slice(0, 10);
  }

  /**
   * Retrieves all historical revisions of a specific form.
   */
  public async getFormRevisions(domain: string, formInstanceId: string): Promise<any[]> {
    const domainId = normalizeDomainId(domain);
    let forms: IDBForm[] = [];
    try {
      forms = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter((f) => f.formInstanceId === formInstanceId && f.status === 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      forms = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.formInstanceId === formInstanceId && f.status === 0)
        .reverse()
        .sortBy('lastModified');
    }

    return await Promise.all(forms.map((f) => this.formatFormOutput(f)));
  }

  /**
   * Retrieves the most recent form revisions for a domain (used for context menus).
   */
  public async getLatestFormRevisions(domain: string, limit = 5): Promise<any[]> {
    const domainId = normalizeDomainId(domain);
    let forms: IDBForm[] = [];
    try {
      forms = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter((f) => f.status === 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      forms = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.status === 0)
        .reverse()
        .sortBy('lastModified');
    }

    return await Promise.all(forms.slice(0, limit).map((f) => this.formatFormOutput(f)));
  }

  /**
   * Retrieves an entire form revision and all its fields by formId.
   */
  public async getRecoverableForm(formId: string): Promise<{ form: any; fields: any[] }> {
    const form = await db.forms.get(formId);
    const rawFields = await db.fields
      .where('formId')
      .equals(formId)
      .filter((f) => f.status === 0)
      .toArray();

    const fields = await Promise.all(
      rawFields.map(async (f) => {
        let val = f.value;
        try {
          val = await vault.decrypt(f.value, f.encryption);
        } catch {
          val = '[Locked Draft]';
        }
        return { ...f, value: val };
      })
    );

    let decryptedUrl = form?.url || '';
    if (form?.encryption === 'hybrid-aes-gcm') {
      try {
        decryptedUrl = await vault.decrypt(form.url, form.encryption);
      } catch {
        decryptedUrl = '[Encrypted URL]';
      }
    }

    return {
      form: form ? { ...form, url: decryptedUrl, domain: form.domainId } : null,
      fields,
    };
  }

  /**
   * Searches historical records matching a query.
   */
  public async searchHistory(query = '', limit = 20): Promise<any[]> {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      const forms = await db.forms.where('status').equals(0).reverse().sortBy('lastModified');

      return await Promise.all(forms.slice(0, limit).map((f) => this.formatFormOutput(f)));
    }

    // 1. Search in Forms by title or url
    const allForms = await db.forms.where('status').equals(0).toArray();
    const matchingFormIds = new Set<string>();

    for (const form of allForms) {
      if (
        form.title?.toLowerCase().includes(lowerQuery) ||
        form.domainId?.toLowerCase().includes(lowerQuery)
      ) {
        matchingFormIds.add(form.id);
      }
    }

    // 2. Search in Fields by name or plaintext value
    const allFields = await db.fields.where('status').equals(0).toArray();
    for (const field of allFields) {
      if (field.name?.toLowerCase().includes(lowerQuery)) {
        matchingFormIds.add(field.formId);
      } else if (field.encryption === 'none' && field.value?.toLowerCase().includes(lowerQuery)) {
        matchingFormIds.add(field.formId);
      }
    }

    const matchedForms = allForms
      .filter((f) => matchingFormIds.has(f.id))
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, limit);

    return await Promise.all(matchedForms.map((f) => this.formatFormOutput(f)));
  }

  /**
   * Retrieves all forms across domains.
   */
  public async getAllHistory(limit = 50): Promise<any[]> {
    const forms = await db.forms.where('status').equals(0).reverse().sortBy('lastModified');

    return await Promise.all(forms.slice(0, limit).map((f) => this.formatFormOutput(f)));
  }

  /**
   * Retrieves form history for a specific domain.
   */
  public async getDomainHistory(domain: string, limit = 20): Promise<any[]> {
    const domainId = normalizeDomainId(domain);
    let forms: IDBForm[] = [];
    try {
      forms = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter((f) => f.status === 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      forms = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter((f) => f.status === 0)
        .reverse()
        .sortBy('lastModified');
    }

    return await Promise.all(forms.slice(0, limit).map((f) => this.formatFormOutput(f)));
  }

  /**
   * Soft-deletes a form and its fields.
   */
  public async deleteForm(formId: string): Promise<void> {
    await db.forms.update(formId, { status: 1 });
    await db.fields.where('formId').equals(formId).modify({ status: 1 });
  }

  /**
   * Cleans up forms older than the expireFormsInterval setting (default: 10 days).
   */
  public async cleanupExpiredForms(): Promise<number> {
    const settings = await this.getSettings();
    const intervalDays = settings.expireFormsInterval || 10;
    const cutoff = Date.now() - intervalDays * 24 * 60 * 60 * 1000;

    const expiredForms = await db.forms.where('lastModified').below(cutoff).toArray();

    let deletedCount = 0;
    for (const form of expiredForms) {
      await db.forms.delete(form.id);
      await db.fields.where('formId').equals(form.id).delete();
      deletedCount++;
    }

    return deletedCount;
  }

  /**
   * Permanently clears all data in all tables.
   */
  public async clearAllHistory(): Promise<void> {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
  }

  /**
   * Exports all forms, fields, and domains as a structured JSON object.
   */
  public async exportAllData(): Promise<any> {
    const domains = await db.domains.toArray();
    const forms = await db.forms.toArray();
    const fields = await db.fields.toArray();
    const settings = await this.getSettings();

    return {
      version: '4.0.0',
      exportedAt: Date.now(),
      settings,
      domains,
      forms,
      fields,
    };
  }

  /**
   * Formats a form and decrypts its fields for client consumption.
   */
  private async formatFormOutput(form: IDBForm): Promise<{ form: any; fields: any[] }> {
    let url = form.url;
    if (form.encryption === 'hybrid-aes-gcm') {
      try {
        url = await vault.decrypt(form.url, form.encryption);
      } catch {
        url = '[Encrypted URL]';
      }
    }

    const rawFields = await db.fields
      .where('formId')
      .equals(form.id)
      .filter((f) => f.status === 0)
      .toArray();

    const fields = await Promise.all(
      rawFields.map(async (f) => {
        let val = f.value;
        try {
          val = await vault.decrypt(f.value, f.encryption);
        } catch {
          val = '[Locked Draft]';
        }
        return {
          ...f,
          value: val,
        };
      })
    );

    return {
      form: {
        ...form,
        url,
        domain: form.domainId || 'unknown',
        revisionNumber: form.revisionNumber || 1,
        isFinalSubmit: !!form.isFinalSubmit,
      },
      fields,
    };
  }
}

export const repository = new LazarusRepository();
