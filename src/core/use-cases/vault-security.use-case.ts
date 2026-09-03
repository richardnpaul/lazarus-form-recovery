import { IVaultSecurityUseCase, VaultStatusDTO } from '../ports/inbound/vault-security.port';
import { IVaultCryptoPort } from '../ports/outbound/vault-crypto.port';
import { IEventBroadcasterPort } from '../ports/outbound/event-broadcaster.port';

export class VaultSecurityUseCase implements IVaultSecurityUseCase {
  constructor(
    private readonly vault: IVaultCryptoPort,
    private readonly broadcaster: IEventBroadcasterPort
  ) {}

  public async getStatus(): Promise<VaultStatusDTO> {
    const hasPass = await this.vault.hasMasterPassword();
    const isUnlocked = this.vault.isUnlocked();
    return {
      hasMasterPassword: hasPass,
      isUnlocked,
      securityMode: hasPass ? 'encrypted' : 'standard',
    };
  }

  public async setupMasterPassword(password: string): Promise<{ success: boolean; error?: string }> {
    if (!password || password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters.' };
    }

    try {
      await this.vault.setMasterPassword(password);
      this.broadcaster.broadcastRefresh();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to setup master password.' };
    }
  }

  public async removeMasterPassword(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.vault.removeMasterPassword();
      this.broadcaster.broadcastRefresh();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to remove master password.' };
    }
  }

  public async unlock(password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const ok = await this.vault.unlock(password);
      if (ok) {
        this.broadcaster.broadcastRefresh();
        return { success: true };
      }
      return { success: false, error: 'Invalid master password.' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to unlock vault.' };
    }
  }

  public lock(): void {
    this.vault.lock();
    this.broadcaster.broadcastRefresh();
  }
}
