import { RuntimeResponse } from '../common/types/messages';
import { ExtensionSettings, VaultStatus } from '../common/types/config';

// Tab Elements
const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.tab-panel');

// General Tab Elements
const prefSavePasswords = document.getElementById('pref-save-passwords') as HTMLInputElement;
const passwordsWarning = document.getElementById('passwords-warning') as HTMLElement;
const prefFilterCards = document.getElementById('pref-filter-cards') as HTMLInputElement;
const prefRetentionSlider = document.getElementById('pref-retention-slider') as HTMLInputElement;
const retentionChip = document.getElementById('retention-chip') as HTMLElement;

// Security Tab Elements
const modeStandard = document.getElementById('mode-standard') as HTMLElement;
const modeVault = document.getElementById('mode-vault') as HTMLElement;
const vaultStatusDesc = document.getElementById('vault-status-desc') as HTMLElement;
const btnConfigurePassword = document.getElementById('btn-configure-password') as HTMLButtonElement;
const prefAutolockSelect = document.getElementById('pref-autolock-select') as HTMLSelectElement;

// Password Modal Elements
const passwordModal = document.getElementById('password-modal') as HTMLElement;
const passwordModalTitle = document.getElementById('password-modal-title') as HTMLElement;
const inputMasterPass = document.getElementById('input-master-pass') as HTMLInputElement;
const inputMasterPassConfirm = document.getElementById(
  'input-master-pass-confirm'
) as HTMLInputElement;
const passwordStrengthLabel = document.getElementById('password-strength-label') as HTMLElement;
const btnCancelPasswordModal = document.getElementById(
  'btn-cancel-password-modal'
) as HTMLButtonElement;
const btnSaveMasterPass = document.getElementById('btn-save-master-pass') as HTMLButtonElement;

// Domains Tab Elements
const inputNewDomain = document.getElementById('input-new-domain') as HTMLInputElement;
const btnAddDomain = document.getElementById('btn-add-domain') as HTMLButtonElement;
const domainTableBody = document.getElementById('domain-table-body') as HTMLElement;

// Storage Tab Elements
const storageProgressBar = document.getElementById('storage-progress-bar') as HTMLElement;
const storageEstimateLabel = document.getElementById('storage-estimate-label') as HTMLElement;
const btnExportData = document.getElementById('btn-export-data') as HTMLButtonElement;
const btnWipeHistory = document.getElementById('btn-wipe-history') as HTMLButtonElement;

// Wipe Modal Elements
const wipeModal = document.getElementById('wipe-modal') as HTMLElement;
const inputWipeConfirm = document.getElementById('input-wipe-confirm') as HTMLInputElement;
const btnCancelWipeModal = document.getElementById('btn-cancel-wipe-modal') as HTMLButtonElement;
const btnConfirmWipe = document.getElementById('btn-confirm-wipe') as HTMLButtonElement;

let currentSettings: ExtensionSettings | null = null;
let currentVaultStatus: VaultStatus | null = null;

export async function init() {
  setupTabs();
  renderDiagnostics();
  await loadSettings();
  await checkVault();
  await calculateStorage();
}

function renderDiagnostics() {
  const versionEl = document.getElementById('diagnostic-version');
  if (versionEl) {
    const version =
      typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest()?.version || '0.0.1'
        : '0.0.1';
    versionEl.textContent = `${version} (Manifest V3)`;
  }
}

function setupTabs() {
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      navItems.forEach((i) => i.classList.remove('is-active'));
      panels.forEach((p) => p.classList.remove('is-active'));

      item.classList.add('is-active');
      document.getElementById(`panel-${tab}`)?.classList.add('is-active');
    });
  });
}

async function loadSettings() {
  const res: RuntimeResponse<ExtensionSettings> = await chrome.runtime.sendMessage({
    type: 'GET_SETTINGS',
  });
  if (res?.success && res.data) {
    currentSettings = res.data;

    // General Preferences
    prefSavePasswords.checked = currentSettings.savePasswords;
    passwordsWarning.style.display = currentSettings.savePasswords ? 'flex' : 'none';

    prefFilterCards.checked = currentSettings.filterCreditCards;

    prefRetentionSlider.value = String(currentSettings.expireFormsInterval || 10);
    retentionChip.textContent = `${prefRetentionSlider.value} days`;

    // Security
    prefAutolockSelect.value = String(currentSettings.autoLockMinutes ?? 15);
    updateModeCards(currentSettings.encryptionMode);

    // Domains
    renderDomainsTable(currentSettings.disabledDomains || []);
  }
}

async function saveSettings(patch: Partial<ExtensionSettings>) {
  const res: RuntimeResponse<ExtensionSettings> = await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    payload: { settings: patch },
  });
  if (res?.success && res.data) {
    currentSettings = res.data;
  }
}

async function checkVault() {
  const res: RuntimeResponse<VaultStatus> = await chrome.runtime.sendMessage({
    type: 'CHECK_VAULT_STATUS',
  });
  if (res?.success && res.data) {
    currentVaultStatus = res.data;
    if (currentVaultStatus.hasMasterPassword) {
      vaultStatusDesc.textContent = currentVaultStatus.isUnlocked
        ? 'Vault is currently unlocked in memory.'
        : 'Vault is configured and locked.';
      btnConfigurePassword.textContent = 'Change Master Password';
    } else {
      vaultStatusDesc.textContent = 'Master Password is not configured.';
      btnConfigurePassword.textContent = 'Set Master Password';
    }
  }
}

function updateModeCards(mode: string) {
  if (mode === 'hybrid-aes-gcm') {
    modeVault.classList.add('is-selected');
    modeStandard.classList.remove('is-selected');
  } else {
    modeStandard.classList.add('is-selected');
    modeVault.classList.remove('is-selected');
  }
}

// General Tab Event Handlers
prefSavePasswords.addEventListener('change', async () => {
  const enabled = prefSavePasswords.checked;
  passwordsWarning.style.display = enabled ? 'flex' : 'none';
  await saveSettings({ savePasswords: enabled });
});

prefFilterCards.addEventListener('change', async () => {
  await saveSettings({ filterCreditCards: prefFilterCards.checked });
});

prefRetentionSlider.addEventListener('input', async () => {
  const days = parseInt(prefRetentionSlider.value, 10);
  retentionChip.textContent = `${days} days`;
  await saveSettings({ expireFormsInterval: days });
});

// Security Tab Event Handlers
modeStandard.addEventListener('click', async () => {
  if (currentVaultStatus?.hasMasterPassword) {
    if (confirm('Switching to Standard Mode will remove Master Password encryption. Continue?')) {
      const pwd = prompt('Enter your current Master Password to confirm:');
      if (pwd) {
        const removeRes: RuntimeResponse = await chrome.runtime.sendMessage({
          type: 'REMOVE_MASTER_PASSWORD',
          payload: { currentPassword: pwd },
        });
        if (removeRes?.success) {
          updateModeCards('none');
          await checkVault();
        } else {
          alert('Incorrect Master Password.');
        }
      }
    }
  } else {
    updateModeCards('none');
    await saveSettings({ encryptionMode: 'none' });
  }
});

modeVault.addEventListener('click', () => {
  if (!currentVaultStatus?.hasMasterPassword) {
    openPasswordModal();
  } else {
    updateModeCards('hybrid-aes-gcm');
    saveSettings({ encryptionMode: 'hybrid-aes-gcm' });
  }
});

btnConfigurePassword.addEventListener('click', () => {
  openPasswordModal();
});

prefAutolockSelect.addEventListener('change', async () => {
  const minutes = parseInt(prefAutolockSelect.value, 10);
  await saveSettings({ autoLockMinutes: minutes });
});

// Master Password Modal Handlers
function openPasswordModal() {
  inputMasterPass.value = '';
  inputMasterPassConfirm.value = '';
  passwordStrengthLabel.textContent = 'Password strength: Empty';
  passwordModalTitle.textContent = currentVaultStatus?.hasMasterPassword
    ? 'Change Master Password'
    : 'Set Master Password';
  passwordModal.classList.add('is-visible');
  inputMasterPass.focus();
}

btnCancelPasswordModal.addEventListener('click', () => {
  passwordModal.classList.remove('is-visible');
});

inputMasterPass.addEventListener('input', () => {
  const pwd = inputMasterPass.value;
  let strength = 'Weak';
  if (pwd.length >= 12 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[^a-zA-Z0-9]/.test(pwd)) {
    strength = 'Strong (PBKDF2-SHA256, 100k iterations)';
  } else if (pwd.length >= 8) {
    strength = 'Moderate';
  }
  passwordStrengthLabel.textContent = `Password strength: ${strength}`;
});

btnSaveMasterPass.addEventListener('click', async () => {
  const p1 = inputMasterPass.value;
  const p2 = inputMasterPassConfirm.value;

  if (!p1) {
    alert('Please enter a password.');
    return;
  }
  if (p1 !== p2) {
    alert('Passwords do not match.');
    return;
  }
  if (p1.length < 6) {
    alert('Password must be at least 6 characters long.');
    return;
  }

  const res: RuntimeResponse = await chrome.runtime.sendMessage({
    type: 'SET_MASTER_PASSWORD',
    payload: { password: p1 },
  });

  if (res?.success) {
    passwordModal.classList.remove('is-visible');
    updateModeCards('hybrid-aes-gcm');
    await checkVault();
    alert('Master Password has been configured successfully.');
  } else {
    alert(`Failed to set password: ${res?.error}`);
  }
});

// Disabled Domains Handlers
function renderDomainsTable(domains: string[]) {
  domainTableBody.innerHTML = '';
  if (domains.length === 0) {
    domainTableBody.innerHTML =
      '<tr><td colspan="2" style="color: var(--lz-text-muted); text-align: center;">No disabled domains yet.</td></tr>';
    return;
  }

  domains.forEach((domain) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family: var(--lz-font-mono); font-weight: 500;">${escapeHtml(domain)}</td>
      <td style="text-align: right;">
        <button class="btn btn-secondary unblock-btn" data-domain="${escapeAttr(domain)}" style="padding: 3px 8px; font-size: 11px;">Unblock</button>
      </td>
    `;

    tr.querySelector('.unblock-btn')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'ENABLE_DOMAIN',
        payload: { domain },
      });
      await loadSettings();
    });

    domainTableBody.appendChild(tr);
  });
}

btnAddDomain.addEventListener('click', async () => {
  const domain = inputNewDomain.value.trim();
  if (!domain) return;

  await chrome.runtime.sendMessage({
    type: 'DISABLE_DOMAIN',
    payload: { domain, wipeExisting: false },
  });

  inputNewDomain.value = '';
  await loadSettings();
});

// Storage & Maintenance Handlers
async function calculateStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usageMb = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
      const quotaMb = ((estimate.quota || 0) / (1024 * 1024)).toFixed(0);
      const pct = estimate.quota
        ? Math.min(100, Math.round(((estimate.usage || 0) / estimate.quota) * 100))
        : 0;

      storageProgressBar.style.width = `${pct}%`;
      storageEstimateLabel.textContent = `Using ~${usageMb} MB of ${quotaMb} MB available storage quota.`;
    } catch {
      storageEstimateLabel.textContent = 'Storage estimate unavailable.';
    }
  }
}

btnExportData.addEventListener('click', async () => {
  const res: RuntimeResponse = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
  if (res?.success && res.data) {
    const jsonStr = JSON.stringify(res.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lazarus-recovery-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
});

btnWipeHistory.addEventListener('click', () => {
  inputWipeConfirm.value = '';
  btnConfirmWipe.disabled = true;
  wipeModal.classList.add('is-visible');
  inputWipeConfirm.focus();
});

inputWipeConfirm.addEventListener('input', () => {
  btnConfirmWipe.disabled = inputWipeConfirm.value.trim() !== 'DELETE';
});

btnCancelWipeModal.addEventListener('click', () => {
  wipeModal.classList.remove('is-visible');
});

btnConfirmWipe.addEventListener('click', async () => {
  if (inputWipeConfirm.value.trim() === 'DELETE') {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY' });
    wipeModal.classList.remove('is-visible');
    await calculateStorage();
    alert('All recorded history and drafts have been wiped.');
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}

init();
