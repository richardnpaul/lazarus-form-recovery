import { describe, it, expect } from 'vitest';
import { WebCryptoVault } from '../../src/common/crypto/web-crypto';

describe('WebCryptoVault Unit Tests', () => {
  const testPassword = 'CorrectHorseBatteryStaple!42';
  const testSalt = new Uint8Array([
    12, 34, 56, 78, 90, 21, 43, 65,
    87, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 19, 20, 21, 22, 23, 24,
    25, 26, 27, 28, 29, 30, 31, 32,
  ]);

  describe('Key Derivation (PBKDF2)', () => {
    it('should derive a valid AES-GCM 256-bit CryptoKey', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as any).length).toBe(256);
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('should derive functionally equivalent keys given identical credentials', async () => {
      const key1 = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const key2 = await WebCryptoVault.deriveKey(testPassword, testSalt);

      const plaintext = 'Sensitive form draft test';
      const ciphertext = await WebCryptoVault.encrypt(plaintext, key1);
      const decrypted = await WebCryptoVault.decrypt(ciphertext, key2);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce incompatible keys for different passwords', async () => {
      const key1 = await WebCryptoVault.deriveKey('PasswordA', testSalt);
      const key2 = await WebCryptoVault.deriveKey('PasswordB', testSalt);

      const ciphertext = await WebCryptoVault.encrypt('Secret data', key1);
      await expect(WebCryptoVault.decrypt(ciphertext, key2)).rejects.toThrow();
    });

    it('should produce incompatible keys for different salts', async () => {
      const differentSalt = new Uint8Array(32).fill(99);
      const key1 = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const key2 = await WebCryptoVault.deriveKey(testPassword, differentSalt);

      const ciphertext = await WebCryptoVault.encrypt('Secret data', key1);
      await expect(WebCryptoVault.decrypt(ciphertext, key2)).rejects.toThrow();
    });
  });

  describe('AES-GCM-256 Encryption & Decryption', () => {
    it('should successfully encrypt and decrypt regular strings', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const original = 'This is a test comment with multiple lines.\nSecond line of input.';

      const encrypted = await WebCryptoVault.encrypt(original, key);
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(original);

      const decrypted = await WebCryptoVault.decrypt(encrypted, key);
      expect(decrypted).toBe(original);
    });

    it('should handle empty strings', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const original = '';

      const encrypted = await WebCryptoVault.encrypt(original, key);
      const decrypted = await WebCryptoVault.decrypt(encrypted, key);
      expect(decrypted).toBe(original);
    });

    it('should preserve complex Unicode, emojis, and HTML entities', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const original = '🔥 Phoenix recovery! 你好,世界! <form action="/post"><textarea>100%</textarea></form> 🚀🎉';

      const encrypted = await WebCryptoVault.encrypt(original, key);
      const decrypted = await WebCryptoVault.decrypt(encrypted, key);
      expect(decrypted).toBe(original);
    });

    it('should handle large text inputs (50KB+ form essays)', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const paragraph = 'Lazarus ensures no form data is ever lost. ';
      const largeText = paragraph.repeat(1200); // ~51.6 KB

      const encrypted = await WebCryptoVault.encrypt(largeText, key);
      const decrypted = await WebCryptoVault.decrypt(encrypted, key);
      expect(decrypted).toBe(largeText);
      expect(decrypted.length).toBe(largeText.length);
    });

    it('should generate unique ciphertext on each encryption due to unique IVs', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const message = 'Identical message';

      const cipher1 = await WebCryptoVault.encrypt(message, key);
      const cipher2 = await WebCryptoVault.encrypt(message, key);

      // IV randomness guarantees distinct ciphertexts
      expect(cipher1).not.toBe(cipher2);

      expect(await WebCryptoVault.decrypt(cipher1, key)).toBe(message);
      expect(await WebCryptoVault.decrypt(cipher2, key)).toBe(message);
    });

    it('should reject tampered or corrupted ciphertext (AES-GCM authentication failure)', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      const message = 'Untampered original';
      const ciphertext = await WebCryptoVault.encrypt(message, key);

      // Decode base64, flip a byte in the payload, and re-encode
      const rawBinary = atob(ciphertext);
      const bytes = new Uint8Array(rawBinary.length);
      for (let i = 0; i < rawBinary.length; i++) {
        bytes[i] = rawBinary.charCodeAt(i);
      }
      // Flip a bit in the ciphertext / tag region (past the 12-byte IV)
      bytes[bytes.length - 1] ^= 0x01;
      const tamperedCiphertext = btoa(String.fromCharCode(...bytes));

      await expect(WebCryptoVault.decrypt(tamperedCiphertext, key)).rejects.toThrow();
    });

    it('should reject invalid base64 input gracefully', async () => {
      const key = await WebCryptoVault.deriveKey(testPassword, testSalt);
      await expect(WebCryptoVault.decrypt('NotValidBase64!@#$%', key)).rejects.toThrow();
    });
  });
});
