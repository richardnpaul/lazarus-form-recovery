import { IFormRepositoryPort } from '../ports/outbound/form-repository.port';
import { IEventBroadcasterPort } from '../ports/outbound/event-broadcaster.port';

export class DomainPolicyUseCase {
  constructor(
    private readonly repository: IFormRepositoryPort,
    private readonly broadcaster: IEventBroadcasterPort
  ) {}

  public async isDomainEnabled(domain: string): Promise<boolean> {
    return this.repository.isDomainEnabled(domain);
  }

  public async setDomainEnabled(
    domain: string,
    enabled: boolean,
    wipeExisting = false
  ): Promise<void> {
    await this.repository.setDomainEnabled(domain, enabled);

    if (!enabled && wipeExisting) {
      const history = await this.repository.getDomainHistory(domain, 1000);
      for (const item of history) {
        await this.repository.softDeleteForm(item.form.id);
      }
    }

    this.broadcaster.broadcastRefresh();
  }

  public async getDisabledDomains(): Promise<string[]> {
    return this.repository.getDisabledDomains();
  }
}
