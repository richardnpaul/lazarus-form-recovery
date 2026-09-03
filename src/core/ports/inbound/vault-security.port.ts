export interface VaultStatusDTO {
  hasMasterPassword: boolean;
  isUnlocked: boolean;
  securityMode: 'standard' | 'encrypted';
}

export interface IVaultSecurityUseCase {
  getStatus(): Promise<VaultStatusDTO>;
  setupMasterPassword(password: string): Promise<{ success: boolean; error?: string }>;
  removeMasterPassword(): Promise<{ success: boolean; error?: string }>;
  unlock(password: string): Promise<{ success: boolean; error?: string }>;
  lock(): void;
}
