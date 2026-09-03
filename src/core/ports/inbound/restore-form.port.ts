import { FormWithFields } from '../outbound/form-repository.port';

export interface RecoverableFieldSnippet {
  value: string;
  lastModified: number;
}

export interface IRestoreFormUseCase {
  getRecoverableForm(formId: string): Promise<FormWithFields | undefined>;
  getRecoverableText(
    domain: string,
    fieldName: string,
    fieldType: string
  ): Promise<RecoverableFieldSnippet[]>;
}
