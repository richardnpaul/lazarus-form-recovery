import { FormSnapshotData } from '../../domain/form-revision';

export interface SaveFormResult {
  success: boolean;
  formId: string;
  domainId: string;
  revisionId: string;
  revisionNumber: number;
  reason: string;
  error?: string;
}

export interface ISaveFormDraftUseCase {
  execute(formSnapshot: FormSnapshotData, tabId?: number, forceNewRevision?: boolean): Promise<SaveFormResult>;
}

export interface ISubmitFormUseCase {
  execute(formSnapshot: FormSnapshotData, tabId?: number): Promise<SaveFormResult>;
}
