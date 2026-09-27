import { RuntimeResponse } from '../common/types/messages';
import { ExtensionSettings, VaultStatus } from '../common/types/config';
import { getExtensionVersion } from '../common/utils/version';
import { getBrowserApi } from '../common/utils/runtime';
import {
  getMessage,
  localizeDocument,
  formatStorageFootprint,
  getUILanguage,
} from '../common/utils/i18n';

async function sendOptionsMessage<T = any>(message: any): Promise<T> {
  const api = getBrowserApi();
  return (await api.runtime.sendMessage(message)) as T;
}

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
  localizeDocument();
  const keyword = getMessage('optionsWipeConfirmKeyword', undefined, 'DELETE');
  const wipeLabel = document.getElementById('wipe-confirm-label');
  if (wipeLabel) {
    wipeLabel.textContent = getMessage('optionsLabelTypeDelete', [keyword]);
  }
  inputWipeConfirm.placeholder = keyword;

  setupTabs();
  renderDiagnostics();
  await loadSettings();
  await checkVault();
  await calculateStorage();
}

function renderDiagnostics() {
  const versionEl = document.getElementById('diagnostic-version');
  if (versionEl) {
    versionEl.textContent = `${getExtensionVersion()} (Manifest V3)`;
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
  const res: RuntimeResponse<ExtensionSettings> = await sendOptionsMessage({
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
  await sendOptionsMessage({
    type: 'UPDATE_SETTINGS',
    payload: { settings: patch },
  });
}

async function checkVault() {
  const res: RuntimeResponse<VaultStatus> = await sendOptionsMessage({
    type: 'CHECK_VAULT_STATUS',
  });
  if (res?.success && res.data) {
    currentVaultStatus = res.data;
    if (currentVaultStatus.hasMasterPassword) {
      vaultStatusDesc.textContent = currentVaultStatus.isUnlocked
        ? getMessage('optionsVaultStatusUnlocked')
        : getMessage('optionsVaultStatusLocked');
      btnConfigurePassword.textContent = getMessage('optionsBtnChangePassword');
    } else {
      vaultStatusDesc.textContent = getMessage('optionsVaultStatusUnconfigured');
      btnConfigurePassword.textContent = getMessage('optionsBtnSetPassword');
    }
  }
}

function updateModeCards(mode: string) {
  modeVault.classList.toggle('is-selected', mode === 'hybrid-aes-gcm');
  modeStandard.classList.toggle('is-selected', mode === 'none');
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
    if (confirm(getMessage('optionsConfirmSwitchStandard'))) {
      const pwd = prompt(getMessage('optionsPromptCurrentPassword'));
      if (pwd) {
        const removeRes: RuntimeResponse = await sendOptionsMessage({
          type: 'REMOVE_MASTER_PASSWORD',
          payload: { currentPassword: pwd },
        });
        if (removeRes.success) {
          updateModeCards('none');
          await checkVault();
        } else {
          alert(getMessage('optionsAlertIncorrectPassword'));
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
  passwordStrengthLabel.textContent = getMessage('optionsPasswordStrengthEmpty');
  passwordModalTitle.textContent = currentVaultStatus?.hasMasterPassword
    ? getMessage('optionsModalChangePasswordTitle')
    : getMessage('optionsModalSetPasswordTitle');
  passwordModal.classList.add('is-visible');
  inputMasterPass.focus();
}

btnCancelPasswordModal.addEventListener('click', () => {
  passwordModal.classList.remove('is-visible');
});

inputMasterPass.addEventListener('input', () => {
  const pwd = inputMasterPass.value;
  let strength = getMessage('optionsPasswordStrengthWeak');
  if (pwd.length >= 12 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[^a-zA-Z0-9]/.test(pwd)) {
    strength = getMessage('optionsPasswordStrengthStrong');
  } else if (pwd.length >= 8) {
    strength = getMessage('optionsPasswordStrengthModerate');
  }
  passwordStrengthLabel.textContent = strength;
});

btnSaveMasterPass.addEventListener('click', async () => {
  const p1 = inputMasterPass.value;
  const p2 = inputMasterPassConfirm.value;

  if (!p1) {
    alert(getMessage('optionsAlertEnterPassword'));
    return;
  }
  if (p1 !== p2) {
    alert(getMessage('optionsAlertPasswordsNoMatch'));
    return;
  }
  if (p1.length < 6) {
    alert(getMessage('optionsAlertPasswordMinLength'));
    return;
  }

  const res: RuntimeResponse = await sendOptionsMessage({
    type: 'SET_MASTER_PASSWORD',
    payload: { password: p1 },
  });

  if (res?.success) {
    passwordModal.classList.remove('is-visible');
    updateModeCards('hybrid-aes-gcm');
    await checkVault();
    alert(getMessage('optionsAlertPasswordSuccess'));
  } else {
    alert(getMessage('optionsAlertPasswordFailed', [res?.error || 'Unknown error']));
  }
});

// Disabled Domains Handlers
function renderDomainsTable(domains: string[]) {
  domainTableBody.replaceChildren();
  if (domains.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.color = 'var(--lz-text-muted)';
    td.style.textAlign = 'center';
    td.textContent = getMessage('optionsNoDisabledDomains');
    tr.appendChild(td);
    domainTableBody.appendChild(tr);
    return;
  }

  domains.forEach((domain) => {
    const tr = document.createElement('tr');

    const tdDomain = document.createElement('td');
    tdDomain.style.fontFamily = 'var(--lz-font-mono)';
    tdDomain.style.fontWeight = '500';
    tdDomain.textContent = domain;

    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'right';

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary unblock-btn';
    btn.dataset.domain = domain;
    btn.style.padding = '3px 8px';
    btn.style.fontSize = '11px';
    btn.textContent = getMessage('optionsBtnUnblock');

    btn.addEventListener('click', async () => {
      await sendOptionsMessage({
        type: 'ENABLE_DOMAIN',
        payload: { domain },
      });
      await loadSettings();
    });

    tdAction.appendChild(btn);
    tr.appendChild(tdDomain);
    tr.appendChild(tdAction);
    domainTableBody.appendChild(tr);
  });
}

btnAddDomain.addEventListener('click', async () => {
  const domain = inputNewDomain.value.trim();
  if (!domain) return;

  await sendOptionsMessage({
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
      const { formattedUsage, formattedQuota } = formatStorageFootprint(
        estimate.usage || 0,
        estimate.quota || 0
      );
      const pct = estimate.quota
        ? Math.min(100, Math.round(((estimate.usage || 0) / estimate.quota) * 100))
        : 0;

      storageProgressBar.style.width = `${pct}%`;
      storageEstimateLabel.textContent = getMessage('optionsStorageEstimate', [
        formattedUsage,
        formattedQuota,
      ]);
    } catch {
      storageEstimateLabel.textContent = getMessage('optionsStorageUnavailable');
    }
  }
}

btnExportData.addEventListener('click', async () => {
  const res: RuntimeResponse = await sendOptionsMessage({ type: 'EXPORT_DATA' });
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
  const keyword = getMessage('optionsWipeConfirmKeyword', undefined, 'DELETE');
  btnConfirmWipe.disabled = !isWipeConfirmationValid(
    inputWipeConfirm.value,
    keyword,
    getUILanguage()
  );
});

btnCancelWipeModal.addEventListener('click', () => {
  wipeModal.classList.remove('is-visible');
});

btnConfirmWipe.addEventListener('click', async () => {
  const keyword = getMessage('optionsWipeConfirmKeyword', undefined, 'DELETE');
  if (isWipeConfirmationValid(inputWipeConfirm.value, keyword, getUILanguage())) {
    await sendOptionsMessage({ type: 'CLEAR_ALL_HISTORY' });
    wipeModal.classList.remove('is-visible');
    await calculateStorage();
    alert(getMessage('optionsAlertWipeSuccess'));
  }
});

export function isWipeConfirmationValid(
  input: string,
  keyword: string,
  activeLocale: string
): boolean {
  const trimmed = input.trim().normalize('NFKC');
  const normKeyword = (keyword || '').trim().normalize('NFKC');
  if (!trimmed || !normKeyword) return false;

  const matchesLocalised =
    trimmed.toLocaleLowerCase(activeLocale) === normKeyword.toLocaleLowerCase(activeLocale);
  // Safety fallback for catalog load failure; invisible input comparison, not a displayed string
  const matchesEnglish = trimmed.toUpperCase() === 'DELETE';
  return matchesLocalised || matchesEnglish;
}

init();
