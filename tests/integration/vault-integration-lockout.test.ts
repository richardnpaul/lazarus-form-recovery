import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import '../../src/background/service-worker';
import fs from 'fs';
import path from 'path';

describe('Master Password Vault & Auto-Lockout Integration Flow', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Selecting Master Password Vault & Settings Persistence', () => {
    it('persists encryptionMode as hybrid-aes-gcm when master password is configured and keeps vault mode selected on revisit', async () => {
      // 1. Setup options HTML in DOM
      const optionsHtml = fs.readFileSync(
        path.resolve(__dirname, '../../src/options/options.html'),
        'utf-8'
      );
      const match = optionsHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      document.body.innerHTML = match ? match[1] : optionsHtml;

      const optionsModule = await import('../../src/options/options');
      await optionsModule.init();

      const modeStandard = document.getElementById('mode-standard') as HTMLElement;
      const modeVault = document.getElementById('mode-vault') as HTMLElement;
      const passwordModal = document.getElementById('password-modal') as HTMLElement;
      const inputPass = document.getElementById('input-master-pass') as HTMLInputElement;
      const inputConfirm = document.getElementById('input-master-pass-confirm') as HTMLInputElement;
      const btnSave = document.getElementById('btn-save-master-pass') as HTMLButtonElement;

      // Initially standard mode is selected
      expect(modeStandard.classList.contains('is-selected')).toBe(true);
      expect(modeVault.classList.contains('is-selected')).toBe(false);

      // User selects master password vault
      modeVault.click();
      expect(passwordModal.classList.contains('is-visible')).toBe(true);

      // User enters password and saves
      inputPass.value = 'SecretVaultPass123!';
      inputConfirm.value = 'SecretVaultPass123!';
      btnSave.click();

      // Allow async IPC to complete
      await new Promise((r) => setTimeout(r, 100));

      // Modal should be closed and modeVault selected
      expect(passwordModal.classList.contains('is-visible')).toBe(false);
      expect(modeVault.classList.contains('is-selected')).toBe(true);
      expect(modeStandard.classList.contains('is-selected')).toBe(false);

      // Verify settings in backend: encryptionMode MUST be 'hybrid-aes-gcm'
      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      expect(settingsRes.success).toBe(true);
      expect(settingsRes.data.encryptionMode).toBe('hybrid-aes-gcm');

      // Revisit settings (simulate reloading options page after period of time)
      document.body.innerHTML = match ? match[1] : optionsHtml;
      await optionsModule.init();

      const revisitedModeStandard = document.getElementById('mode-standard') as HTMLElement;
      const revisitedModeVault = document.getElementById('mode-vault') as HTMLElement;

      // MUST persist vault mode, NOT revert to standard mode!
      expect(revisitedModeVault.classList.contains('is-selected')).toBe(true);
      expect(revisitedModeStandard.classList.contains('is-selected')).toBe(false);
    });
  });

  describe('2. Auto-Lockout Timeout Expiration', () => {
    it('locks the vault after the timeout period passes and prevents reading plaintext data', async () => {
      // 1. Configure master password
      const setPassRes = await chrome.runtime.sendMessage({
        type: 'SET_MASTER_PASSWORD',
        payload: { password: 'TopSecretMasterPass456!' },
      });
      expect(setPassRes.success).toBe(true);

      // 2. Set auto-lock timeout to 1 minute
      const updateSettingsRes = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { settings: { autoLockMinutes: 1 } },
      });
      expect(updateSettingsRes.success).toBe(true);

      // 3. Save a sensitive form while unlocked
      const saveRes = await chrome.runtime.sendMessage({
        type: 'SAVE_AUTOSAVE',
        payload: {
          form: {
            formInstanceId: 'confidential-form',
            url: 'https://bank.example.com/transfer',
            domain: 'bank.example.com',
            title: 'Bank Transfer',
            fields: [
              { name: 'account_number', type: 'text', value: 'ACCT-987654321' },
              { name: 'transfer_amount', type: 'text', value: '50000' },
            ],
          },
        },
      });
      expect(saveRes.success).toBe(true);

      // Verify it was encrypted in DB
      const rawFields = await db.fields.toArray();
      expect(rawFields.length).toBe(2);
      expect(rawFields[0].encryption).toBe('hybrid-aes-gcm');
      expect(rawFields[0].value).not.toBe('ACCT-987654321');

      // While unlocked, querying history yields decrypted plaintext
      const openHistoryRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
      expect(openHistoryRes.success).toBe(true);
      expect(openHistoryRes.data[0].fields[0].value).toBe('ACCT-987654321');

      // 4. Simulate time passing beyond the 1-minute auto-lock timeout
      const futureTime = Date.now() + 65 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(futureTime);

      // Status check should now report locked
      const statusRes = await chrome.runtime.sendMessage({ type: 'CHECK_VAULT_STATUS' });
      expect(statusRes.success).toBe(true);
      expect(statusRes.data.isUnlocked).toBe(false);

      // While locked, history MUST NOT return plaintext
      const lockedHistoryRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
      expect(lockedHistoryRes.success).toBe(true);
      expect(lockedHistoryRes.data[0].fields[0].value).toBe('[Locked Draft]');
    });
  });

  describe('3. Sidepanel Vault Prompt & Unlock Lifecycle', () => {
    it('prompts for master password when visiting sidepanel while locked, and displays decrypted content only after unlocking', async () => {
      // 1. Setup sidepanel HTML in DOM
      const sidepanelHtml = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidepanel/sidepanel.html'),
        'utf-8'
      );
      const match = sidepanelHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      document.body.innerHTML = match ? match[1] : sidepanelHtml;

      // 2. Configure master password and save form
      await chrome.runtime.sendMessage({
        type: 'SET_MASTER_PASSWORD',
        payload: { password: 'UnlockPassword789!' },
      });

      await chrome.runtime.sendMessage({
        type: 'SAVE_AUTOSAVE',
        payload: {
          form: {
            formInstanceId: 'classified-form',
            url: 'https://classified.example.com/dossier',
            domain: 'classified.example.com',
            title: 'Agent Dossier',
            fields: [
              { name: 'codename', type: 'text', value: 'Agent Lazarus' },
              { name: 'mission', type: 'text', value: 'Recover lost form data' },
            ],
          },
        },
      });

      // 3. Manually lock the vault
      await chrome.runtime.sendMessage({ type: 'LOCK_VAULT' });

      // 4. Initialize Sidepanel while locked
      const sidepanelModule = await import('../../src/sidepanel/sidepanel');
      sidepanelModule.initSidepanel();

      await new Promise((r) => setTimeout(r, 100));

      // Sidepanel MUST show a vault unlock prompt when locked
      const unlockContainer = document.getElementById('vault-unlock-container') as HTMLElement;
      const passInput = document.getElementById('vault-password-input') as HTMLInputElement;
      const btnUnlock = document.getElementById('btn-unlock-vault') as HTMLButtonElement;
      const historyList = document.getElementById('history-list') as HTMLElement;

      expect(unlockContainer).not.toBeNull();
      expect(passInput).not.toBeNull();
      expect(btnUnlock).not.toBeNull();
      expect(unlockContainer.style.display).not.toBe('none');

      // The history list MUST NOT show plaintext confidential content while locked
      expect(historyList.textContent).not.toContain('Agent Lazarus');
      expect(historyList.textContent).not.toContain('Recover lost form data');

      // 5. Try entering WRONG password
      passInput.value = 'WrongPassword!';
      btnUnlock.click();
      await new Promise((r) => setTimeout(r, 100));

      // Should show error and remain locked
      const errorMsg = document.getElementById('vault-unlock-error') as HTMLElement;
      expect(errorMsg).not.toBeNull();
      expect(errorMsg.textContent).toBeTruthy();
      expect(unlockContainer.style.display).not.toBe('none');
      expect(historyList.textContent).not.toContain('Agent Lazarus');

      // 6. Enter CORRECT password
      passInput.value = 'UnlockPassword789!';
      btnUnlock.click();
      await new Promise((r) => setTimeout(r, 150));

      // Unlock container should be hidden, and decrypted content rendered!
      expect(unlockContainer.style.display).toBe('none');
      expect(historyList.textContent).toContain('Agent Lazarus');
      expect(historyList.textContent).toContain('Recover lost form data');

      // 7. Advance time past auto-lock timeout (set to 1 minute)
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { settings: { autoLockMinutes: 1 } },
      });
      const futureTime = Date.now() + 65 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(futureTime);

      // Re-visit or refresh sidepanel
      await sidepanelModule.loadHistory();
      await new Promise((r) => setTimeout(r, 100));

      // Sidepanel MUST lock again and prompt for master password!
      expect(unlockContainer.style.display).not.toBe('none');
      expect(historyList.textContent).not.toContain('Agent Lazarus');
    });
  });
});
