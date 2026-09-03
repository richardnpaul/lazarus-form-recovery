import { IHistoryQueryUseCase } from '../ports/inbound/history-query.port';
import { IFormRepositoryPort, FormWithFields, StoredFormRecord } from '../ports/outbound/form-repository.port';
import { IEventBroadcasterPort } from '../ports/outbound/event-broadcaster.port';

export class HistoryQueryUseCase implements IHistoryQueryUseCase {
  constructor(
    private readonly repository: IFormRepositoryPort,
    private readonly broadcaster: IEventBroadcasterPort
  ) {}

  public async getAllHistory(limit = 50): Promise<FormWithFields[]> {
    return this.repository.getAllHistory(limit);
  }

  public async getDomainHistory(domain: string, limit = 20): Promise<FormWithFields[]> {
    return this.repository.getDomainHistory(domain, limit);
  }

  public async getFormRevisions(domain: string, formInstanceId: string): Promise<FormWithFields[]> {
    const forms = await this.repository.getRevisionsByFormInstance(domain, formInstanceId);
    const results: FormWithFields[] = [];

    for (const form of forms) {
      const fields = await this.repository.getFieldsByFormId(form.id);
      results.push({
        form: {
          ...form,
          domain: form.domainId,
        },
        fields,
      });
    }

    return results;
  }

  public async getLatestFormRevisions(domain: string, limit = 5): Promise<StoredFormRecord[]> {
    return this.repository.getLatestRevisionsForDomain(domain, limit);
  }

  public async searchHistory(query: string, limit = 30): Promise<FormWithFields[]> {
    return this.repository.searchHistory(query, limit);
  }

  public async deleteForm(formId: string): Promise<void> {
    await this.repository.softDeleteForm(formId);
    this.broadcaster.broadcastRefresh();
  }

  public async clearAll(): Promise<void> {
    await this.repository.clearAllHistory();
    this.broadcaster.broadcastRefresh();
  }
}
