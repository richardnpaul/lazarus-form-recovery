import {
  IFormRepositoryPort,
  StoredFormRecord,
  StoredFieldRecord,
  FormWithFields
} from '../../core/ports/outbound/form-repository.port';
import { db } from '../../common/db/lazarus-db';
import { repository, normalizeDomainId } from '../../common/db/repository';
import Dexie from 'dexie';

export class DexieFormRepositoryAdapter implements IFormRepositoryPort {
  public async saveFormRecord(form: StoredFormRecord): Promise<void> {
    await db.forms.put(form as any);
  }

  public async saveFieldRecords(fields: StoredFieldRecord[]): Promise<void> {
    for (const field of fields) {
      await db.fields.put(field as any);
    }
  }

  public async getFormById(formId: string): Promise<StoredFormRecord | undefined> {
    const form = await db.forms.get(formId);
    return form as StoredFormRecord | undefined;
  }

  public async getFieldsByFormId(formId: string): Promise<StoredFieldRecord[]> {
    const raw = await db.fields
      .where('formId')
      .equals(formId)
      .filter(f => f.status === 0)
      .toArray();
    return raw as StoredFieldRecord[];
  }

  public async getRevisionsByFormInstance(domainId: string, formInstanceId: string): Promise<StoredFormRecord[]> {
    let forms: any[] = [];
    try {
      forms = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter(f => f.formInstanceId === formInstanceId && f.status === 0)
        .sortBy('lastModified');
    } catch {
      forms = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter(f => f.formInstanceId === formInstanceId && f.status === 0)
        .sortBy('lastModified');
    }
    return (forms as StoredFormRecord[]).reverse();
  }

  public async getLatestRevisionsForDomain(domainId: string, limit = 5): Promise<StoredFormRecord[]> {
    let forms: any[] = [];
    try {
      forms = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .filter(f => f.status === 0)
        .sortBy('lastModified');
    } catch {
      forms = await db.forms
        .where('domainId')
        .equals(domainId)
        .filter(f => f.status === 0)
        .sortBy('lastModified');
    }
    return forms.reverse().slice(0, limit) as StoredFormRecord[];
  }

  public async getAllHistory(limit = 50): Promise<FormWithFields[]> {
    return repository.getAllHistory(limit);
  }

  public async getDomainHistory(domain: string, limit = 20): Promise<FormWithFields[]> {
    return repository.getDomainHistory(domain, limit);
  }

  public async searchHistory(query: string, limit = 30): Promise<FormWithFields[]> {
    return repository.searchHistory(query, limit);
  }

  public async getRecoverableText(domain: string, fieldName: string, fieldType: string): Promise<StoredFieldRecord[]> {
    const domainId = normalizeDomainId(domain);
    let fields: any[] = [];
    try {
      fields = await db.fields
        .where('[domainId+name+type]')
        .equals([domainId, fieldName, fieldType])
        .filter(f => f.status === 0 && f.value.trim().length > 0)
        .reverse()
        .sortBy('lastModified');
    } catch {
      fields = await db.fields
        .where('domainId')
        .equals(domainId)
        .filter(f => f.status === 0 && f.name === fieldName && f.type === fieldType && f.value.trim().length > 0)
        .reverse()
        .sortBy('lastModified');
    }
    return fields as StoredFieldRecord[];
  }

  public async softDeleteForm(formId: string): Promise<void> {
    await repository.deleteForm(formId);
  }

  public async softDeleteRevision(formId: string): Promise<void> {
    await repository.deleteForm(formId);
  }

  public async clearAllHistory(): Promise<void> {
    await repository.clearAllHistory();
  }

  public async purgeExpiredForms(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const expiredForms = await db.forms.where('lastModified').below(cutoff).toArray();
    let deletedCount = 0;
    for (const form of expiredForms) {
      await repository.deleteForm(form.id);
      deletedCount++;
    }
    return deletedCount;
  }

  public async isDomainEnabled(domain: string): Promise<boolean> {
    return repository.isDomainEnabled(domain);
  }

  public async setDomainEnabled(domain: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await repository.enableDomain(domain);
    } else {
      await repository.disableDomain(domain);
    }
  }

  public async getDisabledDomains(): Promise<string[]> {
    const disabled = await db.domains.where('status').equals(1).toArray();
    return disabled.map(d => d.domain);
  }

  public async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const setting = await db.settings.get(key);
    return (setting?.value as T) ?? defaultValue;
  }

  public async setSetting<T>(key: string, value: T): Promise<void> {
    await db.settings.put({ key, value, lastModified: Date.now() });
  }
}

export const defaultRepositoryAdapter = new DexieFormRepositoryAdapter();
