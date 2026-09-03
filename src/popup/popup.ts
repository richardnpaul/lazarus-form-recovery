import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { formatTimeAgo, computeWordCount, sanitizePreview } from '../common/utils/text';

// DOM Elements
const statusBeacon = document.getElementById('status-beacon') as HTMLElement;
const activeDomainText = document.getElementById('active-domain-text') as HTMLElement;
const domainDisplay = document.getElementById('domain-display') as HTMLElement;
const domainStats = document.getElementById('domain-stats') as HTMLElement;
const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;

const tabCurrent = document.getElementById('tab-current') as HTMLButtonElement;
const tabSearch = document.getElementById('tab-search') as HTMLButtonElement;
const searchContainer = document.getElementById('search-container') as HTMLElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const feedContainer = document.getElementById('feed-container') as HTMLElement;

const vaultBtn = document.getElementById('vault-btn') as HTMLButtonElement;
const vaultIcon = document.getElementById('vault-icon') as HTMLElement;
const vaultLabel = document.getElementById('vault-label') as HTMLElement;
const openSidepanelLink = document.getElementById('open-sidepanel-link') as HTMLAnchorElement;
const openOptionsLink = document.getElementById('open-options-link') as HTMLAnchorElement;

let currentHostname = '';
let currentMode: 'current' | 'search' = 'current';
let searchDebounceTimer: any = null;

async function init() {
  // 1. Get active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
      activeDomainText.textContent = currentHostname;
      domainDisplay.textContent = currentHostname;
    } else {
      currentHostname = 'localhost';
      activeDomainText.textContent = 'Active Tab';
      domainDisplay.textContent = 'Active Page';
    }
  } catch {
    currentHostname = 'localhost';
    activeDomainText.textContent = 'Web Page';
    domainDisplay.textContent = 'Current Page';
  }

  // 2. Check domain status
  await checkDomainStatus();

  // 3. Check vault status
  await checkVaultStatus();

  // 4. Load initial feed
  await loadFeed();
}

async function checkDomainStatus() {
  if (!currentHostname) return;
  const msg: RuntimeMessage = {
    type: 'IS_DOMAIN_ENABLED',
    payload: { domain: currentHostname },
  };

  try {
    const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
    const enabled = res?.success ? res.data?.enabled !== false : true;
    domainToggle.checked = enabled;
    if (enabled) {
      statusBeacon.className = 'status-beacon';
      domainStats.textContent = 'Recording active';
    } else {
      statusBeacon.className = 'status-beacon is-disabled';
      domainStats.textContent = 'Disabled on this domain';
    }
  } catch {
    domainToggle.checked = true;
  }
}

async function checkVaultStatus() {
  const msg: RuntimeMessage = { type: 'CHECK_VAULT_STATUS' };
  try {
    const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
    if (res?.success && res.data) {
      const { hasMasterPassword, isUnlocked } = res.data;
      if (!hasMasterPassword) {
        vaultIcon.textContent = '🔓';
        vaultLabel.textContent = 'Vault: Off';
      } else if (isUnlocked) {
        vaultIcon.textContent = '🔓';
        vaultLabel.textContent = 'Vault: Open';
        statusBeacon.classList.remove('is-locked');
      } else {
        vaultIcon.textContent = '🔒';
        vaultLabel.textContent = 'Vault: Locked';
        statusBeacon.classList.add('is-locked');
      }
    }
  } catch {
    // Keep default
  }
}

async function loadFeed() {
  feedContainer.innerHTML = '<div class="empty-state">Loading forms...</div>';

  try {
    let items: any[] = [];

    if (currentMode === 'current' && currentHostname) {
      const msg: RuntimeMessage = {
        type: 'GET_DOMAIN_HISTORY',
        payload: { domain: currentHostname, limit: 15 },
      };
      const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
      if (res?.success && Array.isArray(res.data)) {
        items = res.data;
      }
    } else {
      const query = searchInput.value.trim();
      const msg: RuntimeMessage = query
        ? { type: 'SEARCH_HISTORY', payload: { query, limit: 15 } }
        : { type: 'GET_ALL_HISTORY', payload: { limit: 15 } };

      const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
      if (res?.success && Array.isArray(res.data)) {
        items = res.data;
      }
    }

    renderFeed(items);
  } catch (err) {
    feedContainer.innerHTML = `<div class="empty-state">Unable to load form history: ${(err as Error).message}</div>`;
  }
}

function renderFeed(items: any[]) {
  feedContainer.innerHTML = '';

  if (items.length === 0) {
    const msg = currentMode === 'current'
      ? `No form saves recorded for ${currentHostname} yet.<br>Drafts are automatically saved as you type!`
      : 'No matching form saves found.';
    feedContainer.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  items.forEach((item: any) => {
    const form = item.form;
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const firstField = fields.find((f: any) => f.value && f.value.trim().length > 0);
    const firstVal = firstField?.value || '';
    const wordCount = computeWordCount(firstVal);
    const snippet = sanitizePreview(firstVal, 80);

    const card = document.createElement('div');
    card.className = 'form-card';

    card.innerHTML = `
      <div class="card-top">
        <span class="form-title" title="${escapeHtml(form?.title || 'Form Draft')}">
          ${escapeHtml(form?.title || 'Form Draft')}
          <span style="font-size: 10px; font-weight: normal; color: var(--lz-accent-primary); background: var(--lz-accent-subtle); padding: 1px 5px; border-radius: 4px; margin-left: 4px;">Rev ${form?.revisionNumber || 1}${form?.isFinalSubmit ? ' • Submitted' : ''}</span>
        </span>
        <span class="form-time">${formatTimeAgo(form?.lastModified || Date.now())}</span>
      </div>
      <div class="form-snippet">"${escapeHtml(snippet || 'Draft saved')}"</div>
      <div class="card-actions">
        <span class="badge-info">${fields.length} ${fields.length === 1 ? 'field' : 'fields'} • ${wordCount} words</span>
        <div class="btn-group">
          <button class="action-btn toggle-accordion-btn">Fields ▾</button>
          <button class="action-btn primary copy-all-btn">Copy Text</button>
        </div>
      </div>
      <div class="accordion-fields">
        ${fields.map((f: any) => `
          <div class="field-item">
            <span class="field-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name || 'field')}:</span>
            <span class="field-val-preview">${escapeHtml(f.value)}</span>
            <button class="copy-mini-btn" data-val="${escapeAttr(f.value)}">Copy</button>
          </div>
        `).join('')}
      </div>
    `;

    // Hook up Accordion toggle
    const accordion = card.querySelector('.accordion-fields') as HTMLElement;
    const toggleBtn = card.querySelector('.toggle-accordion-btn') as HTMLButtonElement;
    toggleBtn.addEventListener('click', () => {
      const isOpen = accordion.classList.toggle('is-open');
      toggleBtn.textContent = isOpen ? 'Fields ▴' : 'Fields ▾';
    });

    // Hook up Copy Text button
    const copyAllBtn = card.querySelector('.copy-all-btn') as HTMLButtonElement;
    copyAllBtn.addEventListener('click', async () => {
      const combined = fields.map((f: any) => `${f.name}: ${f.value}`).join('\n\n') || firstVal;
      await navigator.clipboard.writeText(combined);
      copyAllBtn.textContent = 'Copied!';
      setTimeout(() => { copyAllBtn.textContent = 'Copy Text'; }, 1500);
    });

    // Hook up Mini Copy buttons
    card.querySelectorAll('.copy-mini-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.target as HTMLButtonElement;
        const val = target.getAttribute('data-val') || '';
        await navigator.clipboard.writeText(val);
        const prev = target.textContent;
        target.textContent = '✓';
        setTimeout(() => { target.textContent = prev; }, 1200);
      });
    });

    feedContainer.appendChild(card);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}

// Domain Toggle Event
domainToggle.addEventListener('change', async () => {
  if (!currentHostname) return;
  if (domainToggle.checked) {
    await chrome.runtime.sendMessage({
      type: 'ENABLE_DOMAIN',
      payload: { domain: currentHostname },
    });
    statusBeacon.className = 'status-beacon';
    domainStats.textContent = 'Recording active';
  } else {
    await chrome.runtime.sendMessage({
      type: 'DISABLE_DOMAIN',
      payload: { domain: currentHostname, wipeExisting: false },
    });
    statusBeacon.className = 'status-beacon is-disabled';
    domainStats.textContent = 'Disabled on this domain';
  }
});

// Tab Switch Events
tabCurrent.addEventListener('click', () => {
  currentMode = 'current';
  tabCurrent.classList.add('is-active');
  tabSearch.classList.remove('is-active');
  searchContainer.classList.remove('is-visible');
  loadFeed();
});

tabSearch.addEventListener('click', () => {
  currentMode = 'search';
  tabSearch.classList.add('is-active');
  tabCurrent.classList.remove('is-active');
  searchContainer.classList.add('is-visible');
  searchInput.focus();
  loadFeed();
});

// Search Input with Debounce
searchInput.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadFeed();
  }, 200);
});

// Vault Lock / Unlock Click
vaultBtn.addEventListener('click', async () => {
  const statusRes: RuntimeResponse = await chrome.runtime.sendMessage({ type: 'CHECK_VAULT_STATUS' });
  if (!statusRes?.success || !statusRes.data) return;

  const { hasMasterPassword, isUnlocked } = statusRes.data;

  if (!hasMasterPassword) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (isUnlocked) {
    if (confirm('Lock the vault now? Master Password will be required to decrypt.')) {
      await chrome.runtime.sendMessage({ type: 'LOCK_VAULT' });
      await checkVaultStatus();
      await loadFeed();
    }
  } else {
    const password = prompt('Enter your Master Password to unlock:');
    if (password) {
      const unlockRes: RuntimeResponse = await chrome.runtime.sendMessage({
        type: 'UNLOCK_VAULT',
        payload: { password },
      });
      if (unlockRes?.success) {
        await checkVaultStatus();
        await loadFeed();
      } else {
        alert('Incorrect Master Password.');
      }
    }
  }
});

// Open Side Panel
openSidepanelLink.addEventListener('click', async (e) => {
  e.preventDefault();
  if (typeof chrome !== 'undefined' && chrome.sidePanel?.open) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } else if (typeof (chrome as any)?.sidebarAction?.open === 'function') {
    (chrome as any).sidebarAction.open();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/sidepanel.html') });
  }
});

// Open Options Page
openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Start initialization
init();
