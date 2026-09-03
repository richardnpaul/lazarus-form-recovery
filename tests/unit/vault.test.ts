import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultManager } from '../../src/common/crypto/vault';
import { db } from '../../src/common/db/lazarus-db';

describe('VaultManager Unit Tests', () => {
  let vault: VaultManager;

  beforeEach(async () => {
    await db.settings.clear();
    vault = new VaultManager();
  });

  it('should report no master password initially', async () => {
    const hasPass = await vault.hasMasterPassword();
    expect(hasPass).toBe(false);
    expect(vault.isUnlocked()).toBe(false);

    // Unlocking without master password configured throws
    await expect(vault.unlock('AnyPassword')).rejects.toThrow(
      'No Master Password has been configured.'
    );

    // Status
    const status = await vault.getStatus();
    expect(status.hasMasterPassword).toBe(false);

    // Encrypt without master password falls back to mode: none
    const enc = await vault.encrypt('Plaintext');
    expect(enc.mode).toBe('none');
    expect(enc.ciphertext).toBe('Plaintext');

    // Decrypt mode: none
    const dec = await vault.decrypt('Plaintext', 'none');
    expect(dec).toBe('Plaintext');
  });

  it('should configure master password, store salt and token, and become unlocked', async () => {
    await vault.setMasterPassword('MySecurePassword123!');
    expect(await vault.hasMasterPassword()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);

    const salt = await db.settings.get('vault_salt');
    const token = await db.settings.get('vault_verification_token');
    expect(salt).toBeDefined();
    expect(token).toBeDefined();

    const status = await vault.getStatus();
    expect(status.hasMasterPassword).toBe(true);
    expect(status.isUnlocked).toBe(true);
  });

  it('should lock the vault and purge the in-memory key', async () => {
    await vault.setMasterPassword('Pass123!');
    expect(vault.isUnlocked()).toBe(true);

    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
  });

  it('should unlock successfully with the correct password', async () => {
    await vault.setMasterPassword('Pass123!');
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);

    const unlocked = await vault.unlock('Pass123!');
    expect(unlocked).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('should reject wrong master passwords', async () => {
    await vault.setMasterPassword('CorrectPassword!');
    vault.lock();

    const wrongAttempt = await vault.unlock('WrongPassword!');
    expect(wrongAttempt).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('should encrypt and decrypt plaintext using AES-GCM when unlocked', async () => {
    await vault.setMasterPassword('VaultKey#42');
    const text = 'Confidential form input';

    const { ciphertext, mode } = await vault.encrypt(text);
    expect(mode).toBe('hybrid-aes-gcm');
    expect(ciphertext).not.toBe(text);

    const decrypted = await vault.decrypt(ciphertext, mode);
    expect(decrypted).toBe(text);
  });

  it('should fail decryption if vault is locked', async () => {
    await vault.setMasterPassword('VaultKey#42');
    const { ciphertext, mode } = await vault.encrypt('Secret');

    vault.lock();
    await expect(vault.decrypt(ciphertext, mode)).rejects.toThrow(/locked/i);
  });

  it('should remove master password when valid or fail when locked/invalid', async () => {
    await vault.setMasterPassword('RemovablePassword123!');
    vault.lock();

    // 1. Remove while locked with no currentPassword -> returns false
    const lockedRemove = await vault.removeMasterPassword();
    expect(lockedRemove).toBe(false);

    // 2. Remove with wrong currentPassword -> returns false
    const wrongRemove = await vault.removeMasterPassword('WrongPassword');
    expect(wrongRemove).toBe(false);

    // 3. Remove with correct currentPassword -> returns true
    const validRemove = await vault.removeMasterPassword('RemovablePassword123!');
    expect(validRemove).toBe(true);
    expect(await vault.hasMasterPassword()).toBe(false);
  });

  it('should auto-lock after specified inactivity duration', async () => {
    await vault.setMasterPassword('AutoLockPass');
    expect(vault.isUnlocked()).toBe(true);

    vi.useFakeTimers();
    vault.setAutoLockMinutes(5);

    // Advance past 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(vault.isUnlocked()).toBe(false);

    vi.useRealTimers();
  });
});
