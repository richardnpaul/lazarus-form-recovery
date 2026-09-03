import { describe, it, expect, beforeEach, vi } from 'vitest';

const OPTIONS_HTML = `
  <nav class="sidebar-nav">
    <button class="nav-item is-active" data-tab="general">General</button>
    <button class="nav-item" data-tab="security">Security</button>
    <button class="nav-item" data-tab="domains">Domains</button>
    <button class="nav-item" data-tab="storage">Storage</button>
    <button class="nav-item" data-tab="about">About</button>
  </nav>
  <div id="panel-general" class="tab-panel is-active">
    <input type="checkbox" id="pref-save-passwords">
    <div id="passwords-warning" style="display: none;"></div>
    <input type="checkbox" id="pref-filter-cards" checked>
    <input type="range" id="pref-retention-slider" value="10">
    <span id="retention-chip">10 days</span>
  </div>
  <div id="panel-security" class="tab-panel">
    <div id="mode-standard"></div>
    <div id="mode-vault"></div>
    <span id="vault-status-desc"></span>
    <button id="btn-configure-password">Set Password</button>
    <select id="pref-autolock-select"><option value="15">15</option></select>
  </div>
  <div id="password-modal">
    <span id="password-modal-title"></span>
    <input type="password" id="input-master-pass">
    <input type="password" id="input-master-pass-confirm">
    <span id="password-strength-label"></span>
    <button id="btn-cancel-password-modal">Cancel</button>
    <button id="btn-save-master-pass">Save</button>
  </div>
  <div id="panel-domains" class="tab-panel">
    <input type="text" id="input-new-domain">
    <button id="btn-add-domain">Add</button>
    <table><tbody id="domain-table-body"></tbody></table>
  </div>
  <div id="panel-storage" class="tab-panel">
    <div id="storage-progress-bar"></div>
    <span id="storage-estimate-label"></span>
    <button id="btn-export-data">Export</button>
    <button id="btn-wipe-history">Wipe</button>
  </div>
  <div id="wipe-modal">
    <input type="text" id="input-wipe-confirm">
    <button id="btn-cancel-wipe-modal">Cancel</button>
    <button id="btn-confirm-wipe" disabled>Confirm</button>
  </div>
`;

describe('Options Page Controller (src/options/options.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = OPTIONS_HTML;
    vi.clearAllMocks();

    globalThis.alert = vi.fn();
    globalThis.confirm = vi.fn().mockReturnValue(true);
    globalThis.prompt = vi.fn().mockReturnValue('MyPass123!');

    // Mock storage estimate
    Object.assign(navigator, {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 1048576, quota: 104857600 }),
      },
    });

    // Mock runtime responses
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'GET_SETTINGS') {
        return {
          success: true,
          data: {
            savePasswords: true,
            filterCreditCards: true,
            expireFormsInterval: 14,
            autoLockMinutes: 15,
            encryptionMode: 'hybrid-aes-gcm',
            disabledDomains: ['blocked.com'],
          },
        };
      }
      if (msg.type === 'CHECK_VAULT_STATUS') {
        return {
          success: true,
          data: { hasMasterPassword: true, isUnlocked: true },
        };
      }
      if (msg.type === 'EXPORT_DATA') {
        return {
          success: true,
          data: { version: '4.0.0', forms: [], fields: [], domains: [] },
        };
      }
      return { success: true };
    });
  });

  it('manages tabs, settings toggles, password strength, domains, export, and wipe', async () => {
    await import('../../src/options/options');

    // Wait for async init
    await new Promise((r) => setTimeout(r, 60));

    // 1. Tab switching
    const navItems = document.querySelectorAll('.nav-item');
    (navItems[1] as HTMLElement).click(); // Security
    (navItems[2] as HTMLElement).click(); // Domains
    (navItems[3] as HTMLElement).click(); // Storage
    (navItems[0] as HTMLElement).click(); // General

    // 2. General Tab Settings
    const prefSavePasswords = document.getElementById('pref-save-passwords') as HTMLInputElement;
    prefSavePasswords.checked = false;
    prefSavePasswords.dispatchEvent(new Event('change'));
    prefSavePasswords.checked = true;
    prefSavePasswords.dispatchEvent(new Event('change'));

    const prefFilterCards = document.getElementById('pref-filter-cards') as HTMLInputElement;
    prefFilterCards.checked = false;
    prefFilterCards.dispatchEvent(new Event('change'));

    const prefRetentionSlider = document.getElementById(
      'pref-retention-slider'
    ) as HTMLInputElement;
    prefRetentionSlider.value = '30';
    prefRetentionSlider.dispatchEvent(new Event('input'));

    // 3. Security Tab Settings & Password Modal
    const modeStandard = document.getElementById('mode-standard') as HTMLElement;
    modeStandard.click();

    const modeVault = document.getElementById('mode-vault') as HTMLElement;
    modeVault.click();

    const btnConfigure = document.getElementById('btn-configure-password') as HTMLButtonElement;
    btnConfigure.click();

    // Test password strength meter
    const inputMasterPass = document.getElementById('input-master-pass') as HTMLInputElement;
    const inputMasterPassConfirm = document.getElementById(
      'input-master-pass-confirm'
    ) as HTMLInputElement;

    inputMasterPass.value = '123';
    inputMasterPass.dispatchEvent(new Event('input'));

    inputMasterPass.value = 'Password123';
    inputMasterPass.dispatchEvent(new Event('input'));

    inputMasterPass.value = 'VeryStrongP@ssw0rd!';
    inputMasterPass.dispatchEvent(new Event('input'));

    // Test save master pass validations
    const btnSavePass = document.getElementById('btn-save-master-pass') as HTMLButtonElement;

    // Empty
    inputMasterPass.value = '';
    btnSavePass.click();
    expect(globalThis.alert).toHaveBeenCalled();

    // Mismatch
    inputMasterPass.value = 'Pass123';
    inputMasterPassConfirm.value = 'Different';
    btnSavePass.click();

    // Too short
    inputMasterPass.value = '123';
    inputMasterPassConfirm.value = '123';
    btnSavePass.click();

    // Valid save
    inputMasterPass.value = 'ValidPass123!';
    inputMasterPassConfirm.value = 'ValidPass123!';
    btnSavePass.click();

    // Cancel modal
    const btnCancelModal = document.getElementById(
      'btn-cancel-password-modal'
    ) as HTMLButtonElement;
    btnCancelModal.click();

    // 4. Domains Tab: Add domain & Unblock
    const inputNewDomain = document.getElementById('input-new-domain') as HTMLInputElement;
    const btnAddDomain = document.getElementById('btn-add-domain') as HTMLButtonElement;
    inputNewDomain.value = 'newsite.com';
    btnAddDomain.click();

    // Empty add domain does nothing
    inputNewDomain.value = '';
    btnAddDomain.click();

    const unblockBtn = document.querySelector('.unblock-btn') as HTMLButtonElement;
    unblockBtn?.click();

    // 5. Storage Tab: Export Data & Wipe History
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();

    const btnExport = document.getElementById('btn-export-data') as HTMLButtonElement;
    btnExport.click();

    const btnWipe = document.getElementById('btn-wipe-history') as HTMLButtonElement;
    btnWipe.click();

    const inputWipeConfirm = document.getElementById('input-wipe-confirm') as HTMLInputElement;
    const btnConfirmWipe = document.getElementById('btn-confirm-wipe') as HTMLButtonElement;

    inputWipeConfirm.value = 'WRONG';
    inputWipeConfirm.dispatchEvent(new Event('input'));
    expect(btnConfirmWipe.disabled).toBe(true);

    inputWipeConfirm.value = 'DELETE';
    inputWipeConfirm.dispatchEvent(new Event('input'));
    expect(btnConfirmWipe.disabled).toBe(false);

    // Failed master pass setting
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'SET_MASTER_PASSWORD') {
        return { success: false, error: 'Weak key error' };
      }
      return { success: true };
    });
    inputMasterPass.value = 'FailedPass123!';
    inputMasterPassConfirm.value = 'FailedPass123!';
    btnSavePass.click();

    // Storage estimate rejection
    (navigator.storage.estimate as any).mockRejectedValueOnce(new Error('StorageUnavailable'));
    btnConfirmWipe.click();

    // Empty domains list reload
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'GET_SETTINGS') {
        return { success: true, data: { disabledDomains: [] } };
      }
      return { success: true };
    });
    unblockBtn?.click();

    const btnCancelWipe = document.getElementById('btn-cancel-wipe-modal') as HTMLButtonElement;
    btnCancelWipe.click();
  });
});
