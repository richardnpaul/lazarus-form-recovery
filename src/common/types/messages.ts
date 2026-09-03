import { ExtensionSettings } from './config';

export interface FormSnapshot {
  formInstanceId: string;
  url: string;
  domain: string;
  title: string;
  editingTime: number;
  fields: FieldSnapshot[];
}

export interface FieldSnapshot {
  name: string;
  type: string;
  value: string;
  selector?: string;
}

export type RuntimeMessage =
  | { type: 'SAVE_AUTOSAVE'; payload: { form: FormSnapshot } }
  | { type: 'SUBMIT_FORM'; payload: { form: FormSnapshot } }
  | { type: 'GET_RECOVERABLE_TEXT'; payload: { domain: string; fieldName: string; fieldType: string } }
  | { type: 'GET_RECOVERABLE_FORM'; payload: { formId: string } }
  | { type: 'CHECK_VAULT_STATUS' }
  | { type: 'UNLOCK_VAULT'; payload: { password: string } }
  | { type: 'LOCK_VAULT' }
  | { type: 'SET_MASTER_PASSWORD'; payload: { password: string } }
  | { type: 'REMOVE_MASTER_PASSWORD'; payload: { currentPassword?: string } }
  | { type: 'IS_DOMAIN_ENABLED'; payload: { domain: string } }
  | { type: 'DISABLE_DOMAIN'; payload: { domain: string; wipeExisting?: boolean } }
  | { type: 'ENABLE_DOMAIN'; payload: { domain: string } }
  | { type: 'SEARCH_HISTORY'; payload: { query: string; limit?: number } }
  | { type: 'GET_ALL_HISTORY'; payload?: { limit?: number } }
  | { type: 'GET_DOMAIN_HISTORY'; payload: { domain: string; limit?: number } }
  | { type: 'DELETE_FORM'; payload: { formId: string } }
  | { type: 'CLEAR_ALL_HISTORY' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; payload: { settings: Partial<ExtensionSettings> } }
  | { type: 'EXPORT_DATA' }
  | { type: 'GET_FORM_REVISIONS'; payload: { domain: string; formInstanceId: string } }
  | { type: 'FORCE_SAVE_SNAPSHOT'; payload: { form: FormSnapshot } }
  | { type: 'UPDATE_CONTEXT_MENU'; payload: { domain: string; formInstanceId?: string; fieldName?: string; fieldType?: string } }
  | { type: 'RESTORE_FORM_TO_ACTIVE_TAB'; payload: { formId: string } };

export interface RuntimeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
