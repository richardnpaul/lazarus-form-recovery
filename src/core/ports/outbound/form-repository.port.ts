
export interface StoredFormRecord {
  id: string;
  domainId: string;
  url: string;
  formInstanceId: string;
  revisionId: string;
  revisionNumber: number;
  isFinalSubmit: boolean;
  title: string;
  encryption: string;
  editingTime: number;
  lastModified: number;
  status: number;
}

export interface StoredFieldRecord {
  id: string;
  formId: string;
  domainId: string;
  revisionId: string;
  name: string;
  type: string;
  value: string;
  encryption: string;
  lastModified: number;
  status: number;
}

export interface FormWithFields {
  form: StoredFormRecord & { domain?: string };
  fields: StoredFieldRecord[];
}

export interface IFormRepositoryPort {
  saveFormRecord(form: StoredFormRecord): Promise<void>;
  saveFieldRecords(fields: StoredFieldRecord[]): Promise<void>;
  getFormById(formId: string): Promise<StoredFormRecord | undefined>;
  getFieldsByFormId(formId: string): Promise<StoredFieldRecord[]>;
  getRevisionsByFormInstance(domainId: string, formInstanceId: string): Promise<StoredFormRecord[]>;
  getLatestRevisionsForDomain(domainId: string, limit?: number): Promise<StoredFormRecord[]>;
  getAllHistory(limit?: number): Promise<FormWithFields[]>;
  getDomainHistory(domain: string, limit?: number): Promise<FormWithFields[]>;
  searchHistory(query: string, limit?: number): Promise<FormWithFields[]>;
  getRecoverableText(domain: string, fieldName: string, fieldType: string): Promise<StoredFieldRecord[]>;
  softDeleteForm(formId: string): Promise<void>;
  softDeleteRevision(formId: string): Promise<void>;
  clearAllHistory(): Promise<void>;
  purgeExpiredForms(retentionDays: number): Promise<number>;
  isDomainEnabled(domain: string): Promise<boolean>;
  setDomainEnabled(domain: string, enabled: boolean): Promise<void>;
  getDisabledDomains(): Promise<string[]>;
  getSetting<T>(key: string, defaultValue: T): Promise<T>;
  setSetting<T>(key: string, value: T): Promise<void>;
}
