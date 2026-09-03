export type EncryptionMode = 'none' | 'hybrid-aes-gcm';

export interface ExtensionSettings {
  savePasswords: boolean;
  filterCreditCards: boolean;
  expireFormsInterval: number; // in days (1 - 30, default 10)
  autoLockMinutes: number; // in minutes (0 means never during session, default 15)
  encryptionMode: EncryptionMode;
  disabledDomains: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  savePasswords: false,
  filterCreditCards: true,
  expireFormsInterval: 10,
  autoLockMinutes: 15,
  encryptionMode: 'none',
  disabledDomains: [],
};

export interface VaultStatus {
  hasMasterPassword: boolean;
  isUnlocked: boolean;
  autoLockMinutes: number;
  remainingUnlockTimeMs?: number;
}
