export class WebCryptoVault {
  private static readonly PBKDF2_ITERATIONS = 100_000;
  private static readonly AES_KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12; // 96 bits for AES-GCM

  /**
   * Derives an AES-GCM key from a master password and salt.
   */
  public static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: this.AES_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts plaintext string using AES-GCM-256.
   * Format: base64(IV + Ciphertext + Tag)
   */
  public static async encrypt(plainText: string, key: CryptoKey): Promise<string> {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plainText)
    );

    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypts ciphertext string using AES-GCM-256.
   */
  public static async decrypt(cipherBase64: string, key: CryptoKey): Promise<string> {
    const binary = atob(cipherBase64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    const iv = combined.slice(0, this.IV_LENGTH);
    const cipherBuffer = combined.slice(this.IV_LENGTH);

    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuffer);

    return new TextDecoder().decode(plainBuffer);
  }
}
