import { describe, it, expect, beforeEach, vi } from 'vitest';

const OPTIONS_HTML = `
  <nav class="sidebar-nav">
    <button class="nav-item is-active" data-tab="general">General</button>
    <button class="nav-item" data-tab="security">Security</button>
    <button class="nav-item" data-tab="domains">Domains</button>
    <button class="nav-item" data-tab="storage">Storage</button>
    <button class="nav-item" data-tab="about">About</button>
  </nav>
  <div id="diagnostic-version"></div>
  <div id="diagnostic-platform"></div>
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
    <select id="pref-autolock-select">
      <option value="15">15</option>
      <option value="30">30</option>
      <option value="60">60</option>
    </select>
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
  let sentMessages: any[] = [];

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = OPTIONS_HTML;
    vi.clearAllMocks();
    sentMessages = [];

    globalThis.alert = vi.fn();
    globalThis.confirm = vi.fn().mockReturnValue(true);
    globalThis.prompt = vi.fn().mockReturnValue('MyPass123!');

    // Mock storage estimate: 2MB used of 100MB
    Object.assign(navigator, {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 2 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      },
    });

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      sentMessages.push(msg);
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
      if (msg.type === 'UPDATE_SETTINGS') {
        return {
          success: true,
          data: {
            savePasswords: true,
            filterCreditCards: true,
            expireFormsInterval: 14,
            autoLockMinutes: 15,
            encryptionMode: 'hybrid-aes-gcm',
            disabledDomains: ['blocked.com'],
            ...msg.payload.settings,
          },
        };
      }
      if (msg.type === 'EXPORT_DATA') {
        return {
          success: true,
          data: { version: '4.0.0', forms: [{ id: 'f1' }], fields: [], domains: [] },
        };
      }
      if (msg.type === 'SET_MASTER_PASSWORD' || msg.type === 'REMOVE_MASTER_PASSWORD') {
        return { success: true };
      }
      return { success: true };
    });
  });

  describe('Initialization & Diagnostics', () => {
    it('initializes tabs, renders manifest version, and loads current settings', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 50));

      const versionEl = document.getElementById('diagnostic-version');
      expect(versionEl?.textContent).toBe('0.0.1 (Manifest V3)');

      const prefSavePasswords = document.getElementById('pref-save-passwords') as HTMLInputElement;
      expect(prefSavePasswords.checked).toBe(true);

      const passwordsWarning = document.getElementById('passwords-warning') as HTMLElement;
      expect(passwordsWarning.style.display).toBe('flex');

      const prefFilterCards = document.getElementById('pref-filter-cards') as HTMLInputElement;
      expect(prefFilterCards.checked).toBe(true);

      const prefRetentionSlider = document.getElementById(
        'pref-retention-slider'
      ) as HTMLInputElement;
      expect(prefRetentionSlider.value).toBe('14');

      const retentionChip = document.getElementById('retention-chip') as HTMLElement;
      expect(retentionChip.textContent).toBe('14 days');

      const prefAutolockSelect = document.getElementById(
        'pref-autolock-select'
      ) as HTMLSelectElement;
      expect(prefAutolockSelect.value).toBe('15');

      const modeVault = document.getElementById('mode-vault');
      expect(modeVault?.classList.contains('is-selected')).toBe(true);

      const vaultStatusDesc = document.getElementById('vault-status-desc');
      expect(vaultStatusDesc?.textContent).toBe('Vault is currently unlocked in memory.');

      const btnConfigure = document.getElementById('btn-configure-password');
      expect(btnConfigure?.textContent).toBe('Change Master Password');

      const tableBody = document.getElementById('domain-table-body');
      expect(tableBody?.textContent).toContain('blocked.com');
    });

    it('handles fallback manifest version when chrome.runtime.getManifest is undefined', async () => {
      const origGetManifest = chrome.runtime.getManifest;
      Object.defineProperty(chrome.runtime, 'getManifest', {
        value: undefined,
        configurable: true,
      });

      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 30));

      const versionEl = document.getElementById('diagnostic-version');
      expect(versionEl?.textContent).toBe('0.0.1 (Manifest V3)');

      Object.defineProperty(chrome.runtime, 'getManifest', {
        value: origGetManifest,
        configurable: true,
      });
    });

    it('renders correct vault status description when vault is locked or unconfigured', async () => {
      // Locked vault
      (chrome.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            success: true,
            data: {
              savePasswords: false,
              filterCreditCards: false,
              expireFormsInterval: 10,
              autoLockMinutes: 15,
              encryptionMode: 'hybrid-aes-gcm',
              disabledDomains: [],
            },
          };
        }
        if (msg.type === 'CHECK_VAULT_STATUS') {
          return { success: true, data: { hasMasterPassword: true, isUnlocked: false } };
        }
        return { success: true };
      });

      const { init } = await import('../../src/options/options');
      await init();

      const vaultDesc = document.getElementById('vault-status-desc');
      expect(vaultDesc?.textContent).toBe('Vault is configured and locked.');
      expect(document.getElementById('btn-configure-password')?.textContent).toBe(
        'Change Master Password'
      );

      // Unconfigured vault
      (chrome.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            success: true,
            data: {
              savePasswords: false,
              filterCreditCards: false,
              expireFormsInterval: 0,
              autoLockMinutes: 15,
              encryptionMode: 'none',
              disabledDomains: [],
            },
          };
        }
        if (msg.type === 'CHECK_VAULT_STATUS') {
          return { success: true, data: { hasMasterPassword: false, isUnlocked: false } };
        }
        return { success: true };
      });

      await init();
      expect(vaultDesc?.textContent).toBe('Master Password is not configured.');
      expect(document.getElementById('btn-configure-password')?.textContent).toBe(
        'Set Master Password'
      );
      expect(document.getElementById('mode-standard')?.classList.contains('is-selected')).toBe(
        true
      );
      expect(document.getElementById('mode-vault')?.classList.contains('is-selected')).toBe(false);
    });
  });

  describe('Tab Navigation', () => {
    it('switches active tabs and tab panels when clicking nav items', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const navItems = document.querySelectorAll('.nav-item');
      const panelGeneral = document.getElementById('panel-general');
      const panelSecurity = document.getElementById('panel-security');
      const panelDomains = document.getElementById('panel-domains');
      const panelStorage = document.getElementById('panel-storage');

      expect(navItems[0].classList.contains('is-active')).toBe(true);
      expect(panelGeneral?.classList.contains('is-active')).toBe(true);

      // Click Security
      (navItems[1] as HTMLElement).click();
      expect(navItems[1].classList.contains('is-active')).toBe(true);
      expect(navItems[0].classList.contains('is-active')).toBe(false);
      expect(panelSecurity?.classList.contains('is-active')).toBe(true);
      expect(panelGeneral?.classList.contains('is-active')).toBe(false);

      // Click Domains
      (navItems[2] as HTMLElement).click();
      expect(navItems[2].classList.contains('is-active')).toBe(true);
      expect(panelDomains?.classList.contains('is-active')).toBe(true);
      expect(panelSecurity?.classList.contains('is-active')).toBe(false);

      // Click Storage
      (navItems[3] as HTMLElement).click();
      expect(navItems[3].classList.contains('is-active')).toBe(true);
      expect(panelStorage?.classList.contains('is-active')).toBe(true);
      expect(panelDomains?.classList.contains('is-active')).toBe(false);

      // Click back to General
      (navItems[0] as HTMLElement).click();
      expect(navItems[0].classList.contains('is-active')).toBe(true);
      expect(panelGeneral?.classList.contains('is-active')).toBe(true);
      expect(panelStorage?.classList.contains('is-active')).toBe(false);
    });
  });

  describe('General Preferences', () => {
    it('updates savePasswords preference and toggles the security warning display', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const prefSavePasswords = document.getElementById('pref-save-passwords') as HTMLInputElement;
      const passwordsWarning = document.getElementById('passwords-warning') as HTMLElement;

      // Uncheck
      prefSavePasswords.checked = false;
      prefSavePasswords.dispatchEvent(new Event('change'));

      expect(passwordsWarning.style.display).toBe('none');
      const uncheckMsg = sentMessages.find(
        (m) => m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.savePasswords === false
      );
      expect(uncheckMsg).toBeDefined();

      // Check back
      prefSavePasswords.checked = true;
      prefSavePasswords.dispatchEvent(new Event('change'));

      expect(passwordsWarning.style.display).toBe('flex');
      const checkMsg = sentMessages.find(
        (m) => m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.savePasswords === true
      );
      expect(checkMsg).toBeDefined();
    });

    it('updates filterCreditCards preference', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const prefFilterCards = document.getElementById('pref-filter-cards') as HTMLInputElement;

      prefFilterCards.checked = false;
      prefFilterCards.dispatchEvent(new Event('change'));

      const msg = sentMessages.find(
        (m) => m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.filterCreditCards === false
      );
      expect(msg).toBeDefined();
    });

    it('updates retention interval slider and chip label', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const prefRetentionSlider = document.getElementById(
        'pref-retention-slider'
      ) as HTMLInputElement;
      const retentionChip = document.getElementById('retention-chip') as HTMLElement;

      prefRetentionSlider.value = '60';
      prefRetentionSlider.dispatchEvent(new Event('input'));

      expect(retentionChip.textContent).toBe('60 days');
      const msg = sentMessages.find(
        (m) => m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.expireFormsInterval === 60
      );
      expect(msg).toBeDefined();
    });
  });

  describe('Security & Encryption Modes', () => {
    it('updates autolock select setting', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const prefAutolockSelect = document.getElementById(
        'pref-autolock-select'
      ) as HTMLSelectElement;
      prefAutolockSelect.value = '60';
      prefAutolockSelect.dispatchEvent(new Event('change'));

      const msg = sentMessages.find(
        (m) => m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.autoLockMinutes === 60
      );
      expect(msg).toBeDefined();
    });

    it('switches to standard mode when master password is confirmed and removed', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const modeStandard = document.getElementById('mode-standard') as HTMLElement;
      const modeVault = document.getElementById('mode-vault') as HTMLElement;

      globalThis.confirm = vi.fn().mockReturnValue(true);
      globalThis.prompt = vi.fn().mockReturnValue('CorrectPassword123');

      modeStandard.click();
      await new Promise((r) => setTimeout(r, 40));

      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Switching to Standard Mode will remove Master Password encryption. Continue?'
      );
      expect(globalThis.prompt).toHaveBeenCalledWith(
        'Enter your current Master Password to confirm:'
      );

      const removeMsg = sentMessages.find(
        (m) =>
          m.type === 'REMOVE_MASTER_PASSWORD' && m.payload?.currentPassword === 'CorrectPassword123'
      );
      expect(removeMsg).toBeDefined();
      expect(modeStandard.classList.contains('is-selected')).toBe(true);
      expect(modeVault.classList.contains('is-selected')).toBe(false);
    });

    it('alerts error when master password removal fails due to incorrect password', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      (chrome.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
        if (msg.type === 'REMOVE_MASTER_PASSWORD') {
          return { success: false, error: 'BadPass' };
        }
        return { success: true };
      });

      globalThis.confirm = vi.fn().mockReturnValue(true);
      globalThis.prompt = vi.fn().mockReturnValue('WrongPassword');

      const modeStandard = document.getElementById('mode-standard') as HTMLElement;
      modeStandard.click();
      await new Promise((r) => setTimeout(r, 40));

      expect(globalThis.alert).toHaveBeenCalledWith('Incorrect Master Password.');
      expect(modeStandard.classList.contains('is-selected')).toBe(false);
    });

    it('cancels standard mode switch when confirm dialog or prompt is cancelled', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const modeStandard = document.getElementById('mode-standard') as HTMLElement;

      // 1. Cancel confirm
      globalThis.confirm = vi.fn().mockReturnValue(false);
      modeStandard.click();
      expect(globalThis.prompt).not.toHaveBeenCalled();

      // 2. Cancel prompt
      globalThis.confirm = vi.fn().mockReturnValue(true);
      globalThis.prompt = vi.fn().mockReturnValue(null);
      modeStandard.click();

      const removeMsg = sentMessages.find((m) => m.type === 'REMOVE_MASTER_PASSWORD');
      expect(removeMsg).toBeUndefined();
    });

    it('switches directly to vault mode when master password is already configured', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const modeVault = document.getElementById('mode-vault') as HTMLElement;
      const modeStandard = document.getElementById('mode-standard') as HTMLElement;

      modeVault.click();

      expect(modeVault.classList.contains('is-selected')).toBe(true);
      expect(modeStandard.classList.contains('is-selected')).toBe(false);
      const msg = sentMessages.find(
        (m) =>
          m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.encryptionMode === 'hybrid-aes-gcm'
      );
      expect(msg).toBeDefined();

      // Also test clicking modeVault when master password is true
      (chrome.runtime.sendMessage as any).mockImplementation(async (m: any) => {
        if (m.type === 'CHECK_VAULT_STATUS')
          return { success: true, data: { hasMasterPassword: true, isUnlocked: true } };
        if (m.type === 'UPDATE_SETTINGS') return { success: true, data: { ...m.payload.settings } };
        return { success: true };
      });
      // Click modeVault with master password configured
      modeVault.click();
      await new Promise((r) => setTimeout(r, 40));
      const msg2 = sentMessages.find(
        (m) =>
          m.type === 'UPDATE_SETTINGS' && m.payload?.settings?.encryptionMode === 'hybrid-aes-gcm'
      );
      expect(msg2).toBeDefined();
    });
  });

  describe('Master Password Modal & Strength Meter', () => {
    it('evaluates password strength across weak, moderate, and strong thresholds', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const btnConfigure = document.getElementById('btn-configure-password') as HTMLButtonElement;
      btnConfigure.click();

      const modal = document.getElementById('password-modal') as HTMLElement;
      const modalTitle = document.getElementById('password-modal-title') as HTMLElement;
      const inputPass = document.getElementById('input-master-pass') as HTMLInputElement;
      const strengthLabel = document.getElementById('password-strength-label') as HTMLElement;

      expect(modal.classList.contains('is-visible')).toBe(true);
      expect(modalTitle.textContent).toBe('Change Master Password');
      expect(strengthLabel.textContent).toBe('Password strength: Empty');

      // 1. Weak (< 8 chars)
      inputPass.value = 'short';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe('Password strength: Weak');

      // 2. Moderate (8+ chars, but lacking combination)
      inputPass.value = 'password123';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe('Password strength: Moderate');

      // 3. 12+ chars but missing symbols
      inputPass.value = 'Password12345';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe('Password strength: Moderate');

      // 4. 12+ chars but missing numbers
      inputPass.value = 'PasswordLongText!';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe('Password strength: Moderate');

      // 5. 12+ chars but missing uppercase
      inputPass.value = 'password12345!';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe('Password strength: Moderate');

      // 6. Strong (>=12, uppercase, number, symbol)
      inputPass.value = 'ValidP@ssw0rd123!';
      inputPass.dispatchEvent(new Event('input'));
      expect(strengthLabel.textContent).toBe(
        'Password strength: Strong (PBKDF2-SHA256, 100k iterations)'
      );

      // Cancel button closes modal
      const btnCancel = document.getElementById('btn-cancel-password-modal') as HTMLButtonElement;
      btnCancel.click();
      expect(modal.classList.contains('is-visible')).toBe(false);
    });

    it('validates required fields, matching passwords, and minimum length on save', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const btnConfigure = document.getElementById('btn-configure-password') as HTMLButtonElement;
      btnConfigure.click();

      const inputPass = document.getElementById('input-master-pass') as HTMLInputElement;
      const inputConfirm = document.getElementById('input-master-pass-confirm') as HTMLInputElement;
      const btnSave = document.getElementById('btn-save-master-pass') as HTMLButtonElement;
      const modal = document.getElementById('password-modal') as HTMLElement;

      // 1. Empty password
      inputPass.value = '';
      inputConfirm.value = '';
      btnSave.click();
      expect(globalThis.alert).toHaveBeenCalledWith('Please enter a password.');

      // 2. Passwords mismatch
      inputPass.value = 'Password123';
      inputConfirm.value = 'DifferentPass';
      btnSave.click();
      expect(globalThis.alert).toHaveBeenCalledWith('Passwords do not match.');

      // 3. Password length < 6
      inputPass.value = '12345';
      inputConfirm.value = '12345';
      btnSave.click();
      expect(globalThis.alert).toHaveBeenCalledWith('Password must be at least 6 characters long.');

      // 4. Successful save
      inputPass.value = 'ValidPass123!';
      inputConfirm.value = 'ValidPass123!';
      btnSave.click();
      await new Promise((r) => setTimeout(r, 40));

      const setMsg = sentMessages.find(
        (m) => m.type === 'SET_MASTER_PASSWORD' && m.payload?.password === 'ValidPass123!'
      );
      expect(setMsg).toBeDefined();
      expect(modal.classList.contains('is-visible')).toBe(false);
      expect(globalThis.alert).toHaveBeenCalledWith(
        'Master Password has been configured successfully.'
      );

      // 5. Failed save (backend rejects)
      (chrome.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
        if (msg.type === 'SET_MASTER_PASSWORD') {
          return { success: false, error: 'EntropyInsufficient' };
        }
        return { success: true };
      });

      btnConfigure.click();
      inputPass.value = 'ValidPass123!';
      inputConfirm.value = 'ValidPass123!';
      btnSave.click();
      await new Promise((r) => setTimeout(r, 40));

      expect(globalThis.alert).toHaveBeenCalledWith('Failed to set password: EntropyInsufficient');
    });
  });

  describe('Domain Blocklist Management', () => {
    it('adds new disabled domain and trims whitespace', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const inputNewDomain = document.getElementById('input-new-domain') as HTMLInputElement;
      const btnAddDomain = document.getElementById('btn-add-domain') as HTMLButtonElement;

      // Empty does nothing
      inputNewDomain.value = '   ';
      btnAddDomain.click();
      let addMsg = sentMessages.find((m) => m.type === 'DISABLE_DOMAIN');
      expect(addMsg).toBeUndefined();

      // Valid domain
      inputNewDomain.value = '  sub.example.com  ';
      btnAddDomain.click();
      await new Promise((r) => setTimeout(r, 40));

      addMsg = sentMessages.find(
        (m) =>
          m.type === 'DISABLE_DOMAIN' &&
          m.payload?.domain === 'sub.example.com' &&
          m.payload?.wipeExisting === false
      );
      expect(addMsg).toBeDefined();
      expect(inputNewDomain.value).toBe('');
    });

    it('unblocks domain and reloads settings', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const unblockBtn = document.querySelector('.unblock-btn') as HTMLButtonElement;
      expect(unblockBtn).not.toBeNull();
      expect(unblockBtn.getAttribute('data-domain')).toBe('blocked.com');

      unblockBtn.click();
      await new Promise((r) => setTimeout(r, 40));

      const enableMsg = sentMessages.find(
        (m) => m.type === 'ENABLE_DOMAIN' && m.payload?.domain === 'blocked.com'
      );
      expect(enableMsg).toBeDefined();
    });

    it('renders empty table notice when no domains are disabled', async () => {
      (chrome.runtime.sendMessage as any).mockImplementation(async (msg: any) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            success: true,
            data: {
              savePasswords: false,
              filterCreditCards: false,
              expireFormsInterval: 10,
              autoLockMinutes: 15,
              encryptionMode: 'none',
              disabledDomains: [],
            },
          };
        }
        return { success: true };
      });

      const { init } = await import('../../src/options/options');
      await init();

      const tableBody = document.getElementById('domain-table-body');
      expect(tableBody?.textContent).toContain('No disabled domains yet.');
    });
  });

  describe('Storage, Export & Wipe Data', () => {
    it('calculates storage estimates and updates progress bar', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const progressBar = document.getElementById('storage-progress-bar') as HTMLElement;
      const estimateLabel = document.getElementById('storage-estimate-label') as HTMLElement;

      // 2MB / 100MB = 2%
      expect(progressBar.style.width).toBe('2%');
      expect(estimateLabel.textContent).toBe('Using ~2.00 MB of 100 MB available storage quota.');
    });

    it('handles storage estimate error gracefully', async () => {
      (navigator.storage.estimate as any).mockRejectedValue(new Error('QuotaFail'));

      const { init } = await import('../../src/options/options');
      await init();

      const estimateLabel = document.getElementById('storage-estimate-label') as HTMLElement;
      expect(estimateLabel.textContent).toBe('Storage estimate unavailable.');
    });

    it('exports all recovery data as a JSON file download', async () => {
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-export');
      globalThis.URL.revokeObjectURL = vi.fn();

      let clickedDownload = false;
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'a') {
          el.click = () => {
            clickedDownload = true;
          };
        }
        return el;
      });

      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const btnExport = document.getElementById('btn-export-data') as HTMLButtonElement;
      btnExport.click();
      await new Promise((r) => setTimeout(r, 40));

      const exportMsg = sentMessages.find((m) => m.type === 'EXPORT_DATA');
      expect(exportMsg).toBeDefined();
      expect(clickedDownload).toBe(true);
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-export');
    });

    it('opens wipe modal, requires exact DELETE input, and wipes history', async () => {
      await import('../../src/options/options');
      await new Promise((r) => setTimeout(r, 40));

      const btnWipe = document.getElementById('btn-wipe-history') as HTMLButtonElement;
      const wipeModal = document.getElementById('wipe-modal') as HTMLElement;
      const inputConfirm = document.getElementById('input-wipe-confirm') as HTMLInputElement;
      const btnConfirm = document.getElementById('btn-confirm-wipe') as HTMLButtonElement;
      const btnCancel = document.getElementById('btn-cancel-wipe-modal') as HTMLButtonElement;

      // 1. Open wipe modal
      btnWipe.click();
      expect(wipeModal.classList.contains('is-visible')).toBe(true);
      expect(inputConfirm.value).toBe('');
      expect(btnConfirm.disabled).toBe(true);

      // 2. Partial input keeps disabled
      inputConfirm.value = 'DEL';
      inputConfirm.dispatchEvent(new Event('input'));
      expect(btnConfirm.disabled).toBe(true);

      // 3. Exact DELETE enables confirm
      inputConfirm.value = 'DELETE';
      inputConfirm.dispatchEvent(new Event('input'));
      expect(btnConfirm.disabled).toBe(false);

      // 4. Confirm wipe
      btnConfirm.click();
      await new Promise((r) => setTimeout(r, 40));

      const clearMsg = sentMessages.find((m) => m.type === 'CLEAR_ALL_HISTORY');
      expect(clearMsg).toBeDefined();
      expect(wipeModal.classList.contains('is-visible')).toBe(false);
      expect(globalThis.alert).toHaveBeenCalledWith(
        'All recorded history and drafts have been wiped.'
      );

      // 5. Cancel button hides modal
      btnWipe.click();
      expect(wipeModal.classList.contains('is-visible')).toBe(true);
      btnCancel.click();
      expect(wipeModal.classList.contains('is-visible')).toBe(false);
    });
  });
});
