import { WebCryptoVault } from './web-crypto';
import { db } from '../db/lazarus-db';
import { VaultStatus } from '../types/config';

const VAULT_SENTINEL = 'LAZARUS_VAULT_VERIFIED_v1';
const SALT_SETTING_KEY = 'vault_salt';
const TOKEN_SETTING_KEY = 'vault_verification_token';
const AUTOLOCK_SETTING_KEY = 'autoLockMinutes';

export class VaultManager {
  private activeKey: CryptoKey | null = null;
  private autoLockTimer: any = null;
  private unlockTimestamp: number = 0;
  private autoLockMinutes: number = 15;

  constructor() {
    this.initAutoLockDuration();
  }

  private async initAutoLockDuration() {
    try {
      const setting = await db.settings.get(AUTOLOCK_SETTING_KEY);
      if (setting && typeof setting.value === 'number') {
        this.autoLockMinutes = setting.value;
      }
    } catch {
      // IndexedDB might not be initialized yet
    }
  }

  public setAutoLockMinutes(minutes: number) {
    this.autoLockMinutes = minutes;
    this.resetAutoLockTimer();
  }

  public async hasMasterPassword(): Promise<boolean> {
    const saltRecord = await db.settings.get(SALT_SETTING_KEY);
    const tokenRecord = await db.settings.get(TOKEN_SETTING_KEY);
    return Boolean(saltRecord?.value && tokenRecord?.value);
  }

  public isUnlocked(): boolean {
    return this.activeKey !== null;
  }

  public async getStatus(): Promise<VaultStatus> {
    const hasPassword = await this.hasMasterPassword();
    const unlocked = this.isUnlocked();
    let remainingUnlockTimeMs: number | undefined;

    if (unlocked && this.autoLockMinutes > 0) {
      const elapsed = Date.now() - this.unlockTimestamp;
      const total = this.autoLockMinutes * 60 * 1000;
      remainingUnlockTimeMs = Math.max(0, total - elapsed);
    }

    return {
      hasMasterPassword: hasPassword,
      isUnlocked: unlocked,
      autoLockMinutes: this.autoLockMinutes,
      remainingUnlockTimeMs,
    };
  }

  /**
   * Initializes or updates the Master Password.
   */
  public async setMasterPassword(newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 1) {
      throw new Error('Password cannot be empty');
    }

    // Generate random 32-byte salt
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltBase64 = btoa(String.fromCharCode(...salt));

    const key = await WebCryptoVault.deriveKey(newPassword, salt);
    const verificationToken = await WebCryptoVault.encrypt(VAULT_SENTINEL, key);

    const now = Date.now();
    await db.settings.put({ key: SALT_SETTING_KEY, value: saltBase64, lastModified: now });
    await db.settings.put({ key: TOKEN_SETTING_KEY, value: verificationToken, lastModified: now });

    this.activeKey = key;
    this.unlockTimestamp = Date.now();
    this.resetAutoLockTimer();
  }

  /**
   * Unlocks the vault given the master password.
   */
  public async unlock(password: string): Promise<boolean> {
    const saltRecord = await db.settings.get(SALT_SETTING_KEY);
    const tokenRecord = await db.settings.get(TOKEN_SETTING_KEY);

    if (!saltRecord?.value || !tokenRecord?.value) {
      throw new Error('No Master Password has been configured.');
    }

    const saltBinary = atob(saltRecord.value);
    const salt = new Uint8Array(saltBinary.length);
    for (let i = 0; i < saltBinary.length; i++) {
      salt[i] = saltBinary.charCodeAt(i);
    }

    try {
      const key = await WebCryptoVault.deriveKey(password, salt);
      const decryptedSentinel = await WebCryptoVault.decrypt(tokenRecord.value, key);

      if (decryptedSentinel === VAULT_SENTINEL) {
        this.activeKey = key;
        this.unlockTimestamp = Date.now();
        this.resetAutoLockTimer();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Manually locks the vault, purging the active in-memory CryptoKey.
   */
  public lock(): void {
    this.activeKey = null;
    this.unlockTimestamp = 0;
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  /**
   * Removes master password encryption and decrypts all records if needed.
   */
  public async removeMasterPassword(currentPassword?: string): Promise<boolean> {
    if (currentPassword) {
      const valid = await this.unlock(currentPassword);
      if (!valid) return false;
    } else if (!this.isUnlocked()) {
      return false;
    }

    await db.settings.delete(SALT_SETTING_KEY);
    await db.settings.delete(TOKEN_SETTING_KEY);
    this.lock();
    return true;
  }

  private resetAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }

    if (this.autoLockMinutes > 0 && this.activeKey) {
      this.autoLockTimer = setTimeout(() => {
        this.lock();
      }, this.autoLockMinutes * 60 * 1000);
    }
  }

  /**
   * Encrypts a string if vault is enabled and active key is available.
   */
  public async encrypt(text: string): Promise<{ ciphertext: string; mode: 'none' | 'hybrid-aes-gcm' }> {
    if (this.activeKey) {
      this.resetAutoLockTimer();
      const ciphertext = await WebCryptoVault.encrypt(text, this.activeKey);
      return { ciphertext, mode: 'hybrid-aes-gcm' };
    }
    return { ciphertext: text, mode: 'none' };
  }

  /**
   * Decrypts a string if it was encrypted.
   */
  public async decrypt(text: string, mode: string): Promise<string> {
    if (mode === 'hybrid-aes-gcm') {
      if (!this.activeKey) {
        throw new Error('Vault is locked. Master Password required to decrypt.');
      }
      this.resetAutoLockTimer();
      return await WebCryptoVault.decrypt(text, this.activeKey);
    }
    return text;
  }
}

export const vault = new VaultManager();
