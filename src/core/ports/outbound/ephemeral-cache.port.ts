import { FormSnapshotData } from '../../domain/form-revision';

export interface IEphemeralStoragePort {
  saveEphemeralDraft(tabId: number | undefined, form: FormSnapshotData): Promise<void>;
  getTabDrafts(tabId: number | undefined): Promise<FormSnapshotData[]>;
  clearTabDrafts(tabId: number): Promise<void>;
}
