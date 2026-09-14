import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultManager } from '../../src/common/crypto/vault';
import { WebCryptoVault } from '../../src/common/crypto/web-crypto';
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

    // Partial setting records for hasMasterPassword
    await db.settings.put({
      key: 'vault_verification_token',
      value: 'token',
      lastModified: Date.now(),
    });
    expect(await vault.hasMasterPassword()).toBe(false);

    await db.settings.clear();
    await db.settings.put({
      key: 'vault_salt',
      value: 'salt',
      lastModified: Date.now(),
    });
    expect(await vault.hasMasterPassword()).toBe(false);
  });

  it('should configure master password, store salt and token, and become unlocked', async () => {
    await vault.setMasterPassword('MySecurePassword123!');
    expect(await vault.hasMasterPassword()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);

    const salt = await db.settings.get('vault_salt');
    const token = await db.settings.get('vault_verification_token');
    expect(salt).toBeDefined();
    expect(token).toBeDefined();

    // Verify stored sentinel directly
    const saltBytes = Uint8Array.from(atob(salt!.value), (c) => c.charCodeAt(0));
    const derivedKey = await WebCryptoVault.deriveKey('MySecurePassword123!', saltBytes);
    const decryptedSentinel = await WebCryptoVault.decrypt(token!.value, derivedKey);
    expect(decryptedSentinel).toBe('LAZARUS_VAULT_VERIFIED_v1');

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
    expect(await db.settings.get('vault_verification_token')).toBeUndefined();
    expect(await db.settings.get('vault_salt')).toBeUndefined();
    expect(vault.isUnlocked()).toBe(false);

    // 4. Remove while already unlocked without providing currentPassword
    await vault.setMasterPassword('AlreadyUnlockedPass');
    expect(vault.isUnlocked()).toBe(true);
    const unlockedRemove = await vault.removeMasterPassword();
    expect(unlockedRemove).toBe(true);
    expect(await vault.hasMasterPassword()).toBe(false);
    expect(await db.settings.get('vault_verification_token')).toBeUndefined();
    expect(await db.settings.get('vault_salt')).toBeUndefined();
    expect(vault.isUnlocked()).toBe(false);
  });

  it('does not schedule auto-lock timer when autoLockMinutes <= 0 or activeKey is null', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    // When locked (activeKey is null), setting autoLockMinutes should not schedule a timer
    expect(vault.isUnlocked()).toBe(false);
    vault.setAutoLockMinutes(15);
    expect((vault as any).autoLockTimer).toBeNull();

    // When unlocked but autoLockMinutes is 0, should not schedule a timer
    await vault.setMasterPassword('ZeroTestPass');
    vault.setAutoLockMinutes(0);
    expect((vault as any).autoLockTimer).toBeNull();
    expect(vault.isUnlocked()).toBe(true);

    // Advancing timers should keep vault unlocked
    vi.advanceTimersByTime(10000);
    expect(vault.isUnlocked()).toBe(true);

    vi.useRealTimers();
  });

  it('calculates accurate remainingUnlockTimeMs and handles autoLockMinutes boundary conditions', async () => {
    await vault.setMasterPassword('TimeTestPass');
    vault.setAutoLockMinutes(15);
    expect(vault.isUnlocked()).toBe(true);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Elapsed 5 minutes -> remaining is approx 10 minutes (between 9.99m and 10m)
    vi.advanceTimersByTime(5 * 60 * 1000);
    let status = await vault.getStatus();
    expect(status.remainingUnlockTimeMs).toBeGreaterThan(9 * 60 * 1000);
    expect(status.remainingUnlockTimeMs).toBeLessThanOrEqual(10 * 60 * 1000);

    // Elapsed past 15 minutes before lock callback fires
    vi.advanceTimersByTime(11 * 60 * 1000);
    status = await vault.getStatus();
    expect(status.remainingUnlockTimeMs).toBe(0);

    // Disabled autoLockMinutes (0)
    vault.setAutoLockMinutes(0);
    status = await vault.getStatus();
    expect(status.remainingUnlockTimeMs).toBeUndefined();

    // Locked vault has undefined remainingUnlockTimeMs
    vault.lock();
    status = await vault.getStatus();
    expect(status.remainingUnlockTimeMs).toBeUndefined();

    vi.useRealTimers();
  });

  it('resets the inactivity auto-lock timer on setMasterPassword, encrypt, decrypt, and unlock', async () => {
    await vault.setMasterPassword('InactivityPass');
    expect(vault.isUnlocked()).toBe(true);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Re-arm timer under fake timer environment
    vault.setAutoLockMinutes(15);

    // 10 minutes pass (vault still unlocked)
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(vault.isUnlocked()).toBe(true);

    // Encrypt resets the timer
    const enc = await vault.encrypt('secret text');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(vault.isUnlocked()).toBe(true); // Total 20 min from start, but reset by encrypt

    // Decrypt resets the timer
    await vault.decrypt(enc.ciphertext, enc.mode);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(vault.isUnlocked()).toBe(true); // Reset by decrypt

    // Now let full 15 minutes + 1s pass without activity -> should lock
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(vault.isUnlocked()).toBe(false);

    // Unlock resets the timer
    const unlocked = await vault.unlock('InactivityPass');
    expect(unlocked).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(vault.isUnlocked()).toBe(false);

    vi.useRealTimers();
  });

  it('does not auto-lock when autoLockMinutes is 0 and clears timers properly on lock', async () => {
    await vault.setMasterPassword('PassZero');
    vault.setAutoLockMinutes(0);
    expect(vault.isUnlocked()).toBe(true);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(vault.isUnlocked()).toBe(true);

    // Test lock clears previous timer properly so unlock after lock is not prematurely locked
    vault.setAutoLockMinutes(15);
    vi.advanceTimersByTime(5 * 60 * 1000); // 5 min
    vault.lock();
    vi.advanceTimersByTime(1000);
    const unlocked = await vault.unlock('PassZero');
    expect(unlocked).toBe(true);
    // At T = 16 min (11 min after second unlock, but past original 15 min):
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(vault.isUnlocked()).toBe(true);

    vi.useRealTimers();
  });

  it('auto-locks directly from setMasterPassword without intermediate setAutoLockMinutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const localVault = new VaultManager();
    // Default is 15 minutes
    await localVault.setMasterPassword('FreshPass');
    expect(localVault.isUnlocked()).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(localVault.isUnlocked()).toBe(false);
    vi.useRealTimers();
  });

  it('verifies explicit sentinel during unlock to prevent empty sentinel vulnerability', async () => {
    await vault.setMasterPassword('PassSentinel');
    vault.lock();

    // Verify unlock expects the exact non-empty sentinel string
    const salt = await db.settings.get('vault_salt');
    const saltBytes = Uint8Array.from(atob(salt!.value), (c) => c.charCodeAt(0));
    const key = await WebCryptoVault.deriveKey('PassSentinel', saltBytes);
    const validToken = await WebCryptoVault.encrypt('LAZARUS_VAULT_VERIFIED_v1', key);
    await db.settings.put({
      key: 'vault_verification_token',
      value: validToken,
      lastModified: Date.now(),
    });

    const success = await vault.unlock('PassSentinel');
    expect(success).toBe(true);
  });

  it('should auto-lock after specified inactivity duration', async () => {
    await vault.setMasterPassword('AutoLockPass');
    expect(vault.isUnlocked()).toBe(true);

    vi.useFakeTimers();
    vault.setAutoLockMinutes(5);

    // Advance past 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(vault.isUnlocked()).toBe(false);

    // Line 157: autoLockMinutes <= 0 branch
    vault.setAutoLockMinutes(0);
    expect((vault as any).autoLockMinutes).toBe(0);

    vi.useRealTimers();
  });

  it('initializes autoLockMinutes from settings in db', async () => {
    await db.settings.put({
      key: 'autoLockMinutes',
      value: 30,
      lastModified: Date.now(),
    });
    const loadedVault = new VaultManager();
    // Allow async initAutoLockDuration to resolve
    await new Promise((r) => setTimeout(r, 20));
    const status = await loadedVault.getStatus();
    expect(status.autoLockMinutes).toBe(30);

    // Ignore non-number setting values
    await db.settings.put({
      key: 'autoLockMinutes',
      value: 'not-a-number' as any,
      lastModified: Date.now(),
    });
    const loadedVaultBad = new VaultManager();
    await new Promise((r) => setTimeout(r, 20));
    const statusBad = await loadedVaultBad.getStatus();
    expect(statusBad.autoLockMinutes).toBe(15);
  });

  it('rejects empty master password when setting', async () => {
    await expect(vault.setMasterPassword('')).rejects.toThrow('Password cannot be empty');
  });

  it('returns false in unlock when decrypted sentinel does not match', async () => {
    await vault.setMasterPassword('CorrectPass');
    vault.lock();

    vi.spyOn(WebCryptoVault, 'decrypt').mockResolvedValueOnce('WRONG_SENTINEL');
    const unlocked = await vault.unlock('CorrectPass');
    expect(unlocked).toBe(false);
  });
});
