import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { formatTimeAgo, computeSimpleDiff } from '../common/utils/text';

let currentFilter: 'all' | 'this_site' | 'today' | '7days' | '30days' = 'all';
let currentDomain = '';
let currentUrl = '';
let searchDebounce: any = null;
let heartbeatInterval: any = null;

function normalizeDomain(domain: string): string {
  return (domain || '')
    .replace(/^www\./i, '')
    .trim()
    .toLowerCase();
}

export async function resolveActiveTab(): Promise<void> {
  const siteDomainEl = document.getElementById('site-domain');
  const siteStatusEl = document.getElementById('site-status');
  const siteBeaconEl = document.getElementById('site-beacon');
  const domainToggleEl = document.getElementById('domain-toggle') as HTMLInputElement;

  try {
    let tabs = await chrome.tabs?.query?.({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs?.query?.({ active: true, lastFocusedWindow: true });
    }
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs?.query?.({ active: true });
    }

    const activeTab = tabs?.[0];
    if (activeTab?.url) {
      currentUrl = activeTab.url;
      try {
        const parsed = new URL(activeTab.url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          currentDomain = parsed.hostname;
        } else {
          currentDomain = '';
        }
      } catch {
        currentDomain = '';
      }
    } else {
      currentDomain = '';
      currentUrl = '';
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
    currentDomain = '';
    currentUrl = '';
  }

  if (siteDomainEl) {
    siteDomainEl.textContent = currentDomain || 'No active website';
    siteDomainEl.title = currentUrl || '';
  }

  if (!currentDomain) {
    if (siteStatusEl) siteStatusEl.textContent = 'Non-web page';
    if (siteBeaconEl) siteBeaconEl.classList.add('is-disabled');
    if (domainToggleEl) {
      domainToggleEl.disabled = true;
      domainToggleEl.checked = false;
    }
    return;
  }

  if (domainToggleEl) domainToggleEl.disabled = false;

  try {
    const res: RuntimeResponse = await chrome.runtime.sendMessage({
      type: 'IS_DOMAIN_ENABLED',
      payload: { domain: currentDomain },
    });
    const isEnabled = res?.success ? res.data?.enabled !== false : true;
    if (domainToggleEl) domainToggleEl.checked = isEnabled;
    if (siteBeaconEl) {
      if (isEnabled) {
        siteBeaconEl.classList.remove('is-disabled');
      } else {
        siteBeaconEl.classList.add('is-disabled');
      }
    }
    if (siteStatusEl) {
      siteStatusEl.textContent = isEnabled ? 'Tracking active' : 'Tracking paused';
    }
  } catch {
    if (siteStatusEl) siteStatusEl.textContent = 'Tracking active';
  }
}

export async function loadHistory(query = '') {
  const historyList = document.getElementById('history-list') as HTMLElement;
  const historyCount = document.getElementById('history-count') as HTMLElement;
  if (!historyList || !historyCount) return;

  const message: RuntimeMessage = query.trim()
    ? { type: 'SEARCH_HISTORY', payload: { query: query.trim() } }
    : { type: 'GET_ALL_HISTORY', payload: { limit: 50 } };

  try {
    const res: RuntimeResponse = await chrome.runtime.sendMessage(message);
    if (res?.success && Array.isArray(res.data)) {
      const filtered = applyFilter(res.data);
      renderHistory(filtered);
    } else {
      renderEmpty();
    }
  } catch (err) {
    console.error('Failed to load history:', err);
    renderEmpty();
  }
}

function applyFilter(items: any[]): any[] {
  if (currentFilter === 'all') return items;

  if (currentFilter === 'this_site') {
    if (!currentDomain) return items;
    const normCurrent = normalizeDomain(currentDomain);
    return items.filter((item) => {
      const formDomain = normalizeDomain(item.form?.domainId || '');
      const formUrl = (item.form?.url || '').toLowerCase();
      return (
        formDomain === normCurrent ||
        (formDomain &&
          normCurrent &&
          (formDomain.includes(normCurrent) || normCurrent.includes(formDomain))) ||
        (formUrl && normCurrent && formUrl.includes(normCurrent))
      );
    });
  }

  const now = Date.now();
  let maxAgeMs = 24 * 60 * 60 * 1000;
  if (currentFilter === '7days') maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  if (currentFilter === '30days') maxAgeMs = 30 * 24 * 60 * 60 * 1000;

  return items.filter((item) => {
    const age = now - (item.form?.lastModified || 0);
    return age <= maxAgeMs;
  });
}

function renderEmpty() {
  const historyList = document.getElementById('history-list') as HTMLElement;
  const historyCount = document.getElementById('history-count') as HTMLElement;
  if (!historyList || !historyCount) return;

  historyCount.textContent = '0 drafts';

  if (currentFilter === 'this_site' && currentDomain) {
    historyList.innerHTML = `
      <div class="empty-history">
        <p style="margin-bottom: 6px; font-weight: 600;">No saved form data for ${escapeHtml(currentDomain)}</p>
        <p style="color: var(--lz-text-muted); margin-bottom: 12px;">Drafts are saved as you type on this site.</p>
        <button class="action-btn" id="view-all-sites-btn" style="padding: 6px 12px; font-size: 11px;">View All Sites</button>
      </div>
    `;
    const viewAllBtn = document.getElementById('view-all-sites-btn');
    if (viewAllBtn) {
      viewAllBtn.onclick = () => {
        const chips = document.querySelectorAll<HTMLElement>('.filter-chips .filter-chip');
        chips.forEach((c) => {
          if (c.getAttribute('data-filter') === 'all') {
            c.classList.add('is-active');
          } else {
            c.classList.remove('is-active');
          }
        });
        currentFilter = 'all';
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        loadHistory(searchInput?.value || '');
      };
    }
    return;
  }

  historyList.innerHTML = `
    <div class="empty-history">
      <p style="margin-bottom: 6px; font-weight: 600;">No saved form data found</p>
      <p style="color: var(--lz-text-muted);">Visit any webpage and fill in forms to see Lazarus automatically preserve your drafts.</p>
    </div>
  `;
}

function renderHistory(items: any[]) {
  const historyList = document.getElementById('history-list') as HTMLElement;
  const historyCount = document.getElementById('history-count') as HTMLElement;
  if (!historyList || !historyCount) return;

  historyCount.textContent = `${items.length} ${items.length === 1 ? 'draft' : 'drafts'}`;

  if (items.length === 0) {
    renderEmpty();
    return;
  }

  historyList.innerHTML = '';

  items.forEach((item: any) => {
    const form = item.form;
    const fields = Array.isArray(item.fields) ? item.fields : [];

    const itemEl = document.createElement('div');
    itemEl.className = 'history-item';

    const fieldsHtml = fields
      .filter((f: any) => f.value && f.value.trim().length > 0)
      .map(
        (f: any) => `
        <div class="field-row">
          <span class="field-label" title="${escapeHtml(f.name)}">${escapeHtml(f.name || 'field')}:</span>
          <span class="field-value">${escapeHtml(f.value)}</span>
          <div style="display: flex; gap: 4px;">
            <button class="action-btn copy-field-btn" data-value="${escapeAttr(f.value)}">Copy</button>
            <button class="action-btn diff-field-btn" data-name="${escapeAttr(f.name)}" data-value="${escapeAttr(f.value)}">Diff</button>
          </div>
        </div>
      `
      )
      .join('');

    const timeAgo = form.lastModified ? formatTimeAgo(form.lastModified) : 'Unknown time';
    const domainText = form.domain || 'Direct Input';
    const titleText = form.title || 'Untitled Form';

    const revBadge = form.revisionNumber
      ? `<span class="rev-badge" style="padding: 1px 6px; font-size: 10px; background: var(--lz-accent-subtle); color: var(--lz-accent-primary); border-radius: 4px; font-weight: 600;">Rev ${form.revisionNumber}${form.isFinalSubmit ? ' • Submitted' : ''}</span>`
      : '';

    const urlDisplay = form.url
      ? `<div style="font-size: 10px; color: var(--lz-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" title="${escapeAttr(form.url)}">${escapeHtml(form.url)}</div>`
      : '';

    itemEl.innerHTML = `
      <div class="item-header">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="item-domain">${escapeHtml(domainText)}</span>
            ${revBadge}
          </div>
          <div style="font-size: 11px; color: var(--lz-text-secondary);">${escapeHtml(titleText)}</div>
          ${urlDisplay}
        </div>
        <div class="item-time">${timeAgo}</div>
      </div>
      <div class="item-field-list">
        ${fieldsHtml || '<div style="color: var(--lz-text-muted); font-size: 11px;">No visible fields</div>'}
      </div>
      <div class="item-actions">
        <button class="action-btn copy-all-btn" data-formid="${escapeAttr(form.id)}">Copy All</button>
        <button class="action-btn delete delete-form-btn" data-formid="${escapeAttr(form.id)}">Delete</button>
      </div>
    `;

    // Copy field click
    itemEl.querySelectorAll('.copy-field-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const btnEl = e.currentTarget as HTMLElement;
        const val = btnEl?.getAttribute('data-value') || '';
        const originalText = btnEl?.textContent || 'Copy';
        await navigator.clipboard.writeText(val);
        if (btnEl) {
          btnEl.textContent = 'Copied!';
          setTimeout(() => {
            btnEl.textContent = originalText;
          }, 1200);
        }
      });
    });

    // Diff field click
    itemEl.querySelectorAll('.diff-field-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const fieldName = (e.currentTarget as HTMLElement).getAttribute('data-name') || '';
        const currentVal = (e.currentTarget as HTMLElement).getAttribute('data-value') || '';
        openDiffViewer(fieldName, currentVal, items);
      });
    });

    // Copy all fields
    const copyAllBtn = itemEl.querySelector('.copy-all-btn');
    copyAllBtn?.addEventListener('click', async (e) => {
      const btnEl = e.currentTarget as HTMLElement;
      const originalText = btnEl?.textContent || 'Copy All';
      const allText = fields
        .filter((f: any) => f.value && f.value.trim().length > 0)
        .map((f: any) => `${f.name || 'field'}: ${f.value}`)
        .join('\n\n');
      await navigator.clipboard.writeText(allText);
      if (btnEl) {
        btnEl.textContent = 'Copied All!';
        setTimeout(() => {
          btnEl.textContent = originalText;
        }, 1200);
      }
    });

    // Delete single form
    const deleteBtn = itemEl.querySelector('.delete-form-btn');
    deleteBtn?.addEventListener('click', async (e) => {
      const formId = (e.currentTarget as HTMLElement).getAttribute('data-formid');
      if (formId) {
        await chrome.runtime.sendMessage({
          type: 'DELETE_FORM',
          payload: { formId },
        });
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        loadHistory(searchInput?.value || '');
      }
    });

    historyList.appendChild(itemEl);
  });
}

function openDiffViewer(fieldName: string, currentVal: string, allItems: any[]) {
  const diffViewer = document.getElementById('diff-viewer') as HTMLElement;
  const diffTitle = document.getElementById('diff-title') as HTMLElement;
  const diffContent = document.getElementById('diff-content') as HTMLElement;
  if (!diffViewer || !diffTitle || !diffContent) return;

  diffViewer.classList.add('is-visible');
  diffTitle.textContent = `Diff: ${fieldName}`;

  let prevVal = '';
  for (const item of allItems) {
    const f = (item.fields || []).find((fld: any) => fld.name === fieldName);
    if (f && f.value !== currentVal) {
      prevVal = f.value;
      break;
    }
  }

  if (!prevVal) {
    diffContent.innerHTML = `
      <div style="font-size: 11px; color: var(--lz-text-muted); padding: 8px;">
        No previous version found to compare against. Current value:<br>
        <pre style="margin-top: 6px; white-space: pre-wrap; font-family: monospace;">${escapeHtml(currentVal)}</pre>
      </div>
    `;
    return;
  }

  const diffChunks = computeSimpleDiff(prevVal, currentVal);
  diffContent.innerHTML = `
    <div style="margin-bottom: 6px; font-size: 11px; color: var(--lz-text-secondary);">
      Comparing against previous revision:
    </div>
    <div class="diff-split">
      ${diffChunks
        .map((chunk) => {
          if (chunk.type === 'added')
            return `<span class="diff-add">${escapeHtml(chunk.value)}</span>`;
          if (chunk.type === 'removed')
            return `<span class="diff-del">${escapeHtml(chunk.value)}</span>`;
          return escapeHtml(chunk.value);
        })
        .join('')}
    </div>
  `;
}

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

export function initSidepanel() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const closeDiffBtn = document.getElementById('close-diff-btn') as HTMLButtonElement;
  const diffViewer = document.getElementById('diff-viewer') as HTMLElement;
  const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
  const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;
  const filterChips = document.querySelectorAll<HTMLElement>('.filter-chips .filter-chip');

  if (closeDiffBtn && diffViewer) {
    closeDiffBtn.onclick = () => diffViewer.classList.remove('is-visible');
  }

  filterChips.forEach((chip) => {
    chip.onclick = () => {
      filterChips.forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      currentFilter = (chip.getAttribute('data-filter') as any) || 'all';
      loadHistory(searchInput?.value || '');
    };
  });

  if (searchInput) {
    searchInput.oninput = () => {
      if (searchDebounce) window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        loadHistory(searchInput.value);
      }, 250);
    };
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.onclick = async (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to clear all recovered form history?')) {
        await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY' });
        loadHistory();
      }
    };
  }

  if (openOptionsBtn) {
    openOptionsBtn.onclick = (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    };
  }

  const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;
  if (domainToggle) {
    domainToggle.onchange = async () => {
      if (!currentDomain) return;
      const willEnable = domainToggle.checked;
      if (!willEnable) {
        const confirmed = confirm(`Pause Lazarus form recovery on ${currentDomain}?`);
        if (!confirmed) {
          domainToggle.checked = true;
          return;
        }
        await chrome.runtime.sendMessage({
          type: 'DISABLE_DOMAIN',
          payload: { domain: currentDomain, wipeExisting: false },
        });
      } else {
        await chrome.runtime.sendMessage({
          type: 'ENABLE_DOMAIN',
          payload: { domain: currentDomain },
        });
      }
      await resolveActiveTab();
    };
  }

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    await resolveActiveTab();
    const activeId = document.activeElement?.id;
    if (activeId !== 'search-input') {
      loadHistory(searchInput?.value || '');
    }
  }, 2500);

  // Initialize active tab domain and load drafts
  resolveActiveTab().finally(() => {
    loadHistory();
  });
}

// Active Tab Listeners: detect active tab navigation and tab switching
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onActivated?.addListener?.(async (activeInfo) => {
    if (activeInfo?.tabId) {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab?.url) {
          try {
            const parsed = new URL(tab.url);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              currentDomain = parsed.hostname;
              currentUrl = tab.url;
            }
          } catch {}
        }
      } catch {}
    }
    await resolveActiveTab();
    if (currentFilter === 'this_site') {
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      loadHistory(searchInput?.value || '');
    }
  });

  chrome.tabs.onUpdated?.addListener?.(async (_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete' || (tab && tab.url)) {
      if (tab?.url && tab.active) {
        try {
          const parsed = new URL(tab.url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            currentDomain = parsed.hostname;
            currentUrl = tab.url;
          }
        } catch {}
      }
      await resolveActiveTab();
      if (currentFilter === 'this_site') {
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        loadHistory(searchInput?.value || '');
      }
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', async () => {
    await resolveActiveTab();
    if (currentFilter === 'this_site') {
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      loadHistory(searchInput?.value || '');
    }
  });
}

// Live Reactive Sync listener (registers once)
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FORM_SAVED' || message?.type === 'REFRESH_HISTORY') {
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      loadHistory(searchInput?.value || '');
    }
  });
}

// Auto-boot in browser sidepanel window
if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  initSidepanel();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initSidepanel);
}
