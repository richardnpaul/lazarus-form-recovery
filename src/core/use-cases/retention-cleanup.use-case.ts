import { IFormRepositoryPort } from '../ports/outbound/form-repository.port';

export class RetentionCleanupUseCase {
  constructor(private readonly repository: IFormRepositoryPort) {}

  public async execute(): Promise<{ cleanedCount: number }> {
    const retentionDays = await this.repository.getSetting<number>('retentionDays', 7);
    const cleaned = await this.repository.purgeExpiredForms(retentionDays);
    return { cleanedCount: cleaned };
  }
}
