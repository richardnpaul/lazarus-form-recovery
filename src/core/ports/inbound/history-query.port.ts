import { FormWithFields, StoredFormRecord } from '../outbound/form-repository.port';

export interface IHistoryQueryUseCase {
  getAllHistory(limit?: number): Promise<FormWithFields[]>;
  getDomainHistory(domain: string, limit?: number): Promise<FormWithFields[]>;
  getFormRevisions(domain: string, formInstanceId: string): Promise<FormWithFields[]>;
  getLatestFormRevisions(domain: string, limit?: number): Promise<StoredFormRecord[]>;
  searchHistory(query: string, limit?: number): Promise<FormWithFields[]>;
  deleteForm(formId: string): Promise<void>;
  clearAll(): Promise<void>;
}
