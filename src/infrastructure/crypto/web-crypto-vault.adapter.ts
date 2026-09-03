import { IVaultCryptoPort, EncryptionResult } from '../../core/ports/outbound/vault-crypto.port';
import { vault, VaultManager } from '../../common/crypto/vault';

export class WebCryptoVaultAdapter implements IVaultCryptoPort {
  constructor(private readonly vaultManager: VaultManager = vault) {}

  public async encrypt(plaintext: string): Promise<EncryptionResult> {
    return this.vaultManager.encrypt(plaintext);
  }

  public async decrypt(ciphertext: string, mode?: string): Promise<string> {
    return this.vaultManager.decrypt(ciphertext, mode as any);
  }

  public async hasMasterPassword(): Promise<boolean> {
    return this.vaultManager.hasMasterPassword();
  }

  public async setMasterPassword(password: string): Promise<void> {
    return this.vaultManager.setMasterPassword(password);
  }

  public async removeMasterPassword(): Promise<void> {
    await this.vaultManager.removeMasterPassword();
  }

  public async unlock(password: string): Promise<boolean> {
    return this.vaultManager.unlock(password);
  }

  public lock(): void {
    this.vaultManager.lock();
  }

  public isUnlocked(): boolean {
    return this.vaultManager.isUnlocked();
  }

  public hasKey(): boolean {
    return this.vaultManager.isUnlocked();
  }

  public setAutoLockTimeout(minutes: number): void {
    this.vaultManager.setAutoLockMinutes(minutes);
  }
}

export const defaultVaultAdapter = new WebCryptoVaultAdapter();
