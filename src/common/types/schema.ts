export interface IDBDomain {
  id: string; // Normalized domain identifier
  domain: string; // Plain or encrypted domain string
  totalEditingTime: number; // Aggregate editing seconds
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBForm {
  id: string; // Unique snapshot ID: ${domainId}_${formInstanceId}_${revisionId}
  domainId: string; // Foreign key -> IDBDomain.id
  url: string; // Full URL (plain or AES-GCM encrypted)
  formInstanceId: string; // Runtime DOM instance identifier
  revisionId: string; // Unique revision token (e.g. rev_1725360000000)
  revisionNumber: number; // Incremental revision counter per form (1, 2, 3...)
  isFinalSubmit?: boolean; // True if captured on confirmed form submission
  title: string; // Page / Form title
  encryption: 'none' | 'hybrid-aes-gcm';
  editingTime: number; // Seconds spent editing this form
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBField {
  id: string; // Unique field ID: ${formId}_${fieldName}_${fieldType}
  formId: string; // Foreign key -> IDBForm.id
  domainId: string; // Foreign key -> IDBDomain.id
  revisionId: string; // Foreign key -> IDBForm.revisionId
  name: string; // Field name or selector identifier
  type: string; // 'text' | 'textarea' | 'contenteditable' | 'select' | etc.
  value: string; // Plain text or AES-GCM encrypted ciphertext
  encryption: 'none' | 'hybrid-aes-gcm';
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBSetting {
  key: string; // Primary key (e.g. 'expireFormsInterval')
  value: any; // JSON-serializable value
  lastModified: number;
}
