import { defaultRepositoryAdapter, DexieFormRepositoryAdapter } from '../infrastructure/db/dexie-form-repository.adapter';
import { defaultVaultAdapter, WebCryptoVaultAdapter } from '../infrastructure/crypto/web-crypto-vault.adapter';
import { defaultSessionStorage, ChromeSessionStorageAdapter } from '../infrastructure/storage/chrome-session-storage.adapter';
import { defaultBroadcaster, RuntimeBroadcasterAdapter } from '../infrastructure/messaging/runtime-broadcaster.adapter';
import { defaultScheduler, ChromeAlarmsAdapter } from '../infrastructure/scheduler/chrome-alarms.adapter';

import { SaveFormDraftUseCase } from './use-cases/save-form-draft.use-case';
import { SubmitFormUseCase } from './use-cases/submit-form.use-case';
import { RestoreFormUseCase } from './use-cases/restore-form.use-case';
import { HistoryQueryUseCase } from './use-cases/history-query.use-case';
import { VaultSecurityUseCase } from './use-cases/vault-security.use-case';
import { DomainPolicyUseCase } from './use-cases/domain-policy.use-case';
import { RetentionCleanupUseCase } from './use-cases/retention-cleanup.use-case';

export class ServiceContainer {
  public readonly repository: DexieFormRepositoryAdapter;
  public readonly vault: WebCryptoVaultAdapter;
  public readonly sessionCache: ChromeSessionStorageAdapter;
  public readonly broadcaster: RuntimeBroadcasterAdapter;
  public readonly scheduler: ChromeAlarmsAdapter;

  public readonly saveFormDraftUseCase: SaveFormDraftUseCase;
  public readonly submitFormUseCase: SubmitFormUseCase;
  public readonly restoreFormUseCase: RestoreFormUseCase;
  public readonly historyQueryUseCase: HistoryQueryUseCase;
  public readonly vaultSecurityUseCase: VaultSecurityUseCase;
  public readonly domainPolicyUseCase: DomainPolicyUseCase;
  public readonly retentionCleanupUseCase: RetentionCleanupUseCase;

  constructor(
    repository = defaultRepositoryAdapter,
    vault = defaultVaultAdapter,
    sessionCache = defaultSessionStorage,
    broadcaster = defaultBroadcaster,
    scheduler = defaultScheduler
  ) {
    this.repository = repository;
    this.vault = vault;
    this.sessionCache = sessionCache;
    this.broadcaster = broadcaster;
    this.scheduler = scheduler;

    this.saveFormDraftUseCase = new SaveFormDraftUseCase(this.repository, this.vault, this.sessionCache, this.broadcaster);
    this.submitFormUseCase = new SubmitFormUseCase(this.repository, this.vault, this.sessionCache, this.broadcaster);
    this.restoreFormUseCase = new RestoreFormUseCase(this.repository, this.vault);
    this.historyQueryUseCase = new HistoryQueryUseCase(this.repository, this.broadcaster);
    this.vaultSecurityUseCase = new VaultSecurityUseCase(this.vault, this.broadcaster);
    this.domainPolicyUseCase = new DomainPolicyUseCase(this.repository, this.broadcaster);
    this.retentionCleanupUseCase = new RetentionCleanupUseCase(this.repository);
  }
}

export const container = new ServiceContainer();
