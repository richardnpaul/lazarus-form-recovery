export type EncryptionMode = 'plaintext' | 'standard-obf' | 'hybrid-aes-gcm' | 'none';

export interface EncryptionResult {
  ciphertext: string;
  mode: EncryptionMode;
}

export interface IVaultCryptoPort {
  encrypt(plaintext: string): Promise<EncryptionResult>;
  decrypt(ciphertext: string, mode?: string): Promise<string>;
  hasMasterPassword(): Promise<boolean>;
  setMasterPassword(password: string): Promise<void>;
  removeMasterPassword(): Promise<void>;
  unlock(password: string): Promise<boolean>;
  lock(): void;
  isUnlocked(): boolean;
  hasKey(): boolean;
  setAutoLockTimeout(minutes: number): void;
}
