import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { formatTimeAgo, computeSimpleDiff } from '../common/utils/text';

let currentFilter: 'all' | 'today' | '7days' | '30days' = 'all';
let searchDebounce: any = null;
let playgroundDebounce: any = null;
let heartbeatInterval: any = null;

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
      const filtered = applyDateFilter(res.data);
      renderHistory(filtered);
    } else {
      renderEmpty();
    }
  } catch (err) {
    console.error('Failed to load history:', err);
    renderEmpty();
  }
}

function applyDateFilter(items: any[]): any[] {
  if (currentFilter === 'all') return items;

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
  historyList.innerHTML = `
    <div class="empty-history">
      <p style="margin-bottom: 6px; font-weight: 600;">No saved form data found</p>
      <p style="color: var(--lz-text-muted);">Type in the test box above or visit any webpage to see Lazarus automatically preserve your inputs.</p>
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
      ? `<span class="filter-chip is-active" style="padding: 1px 6px; font-size: 10px;">Rev ${form.revisionNumber}${form.isFinalSubmit ? ' • Submitted' : ''}</span>`
      : '';

    itemEl.innerHTML = `
      <div class="item-header">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="item-domain">${escapeHtml(domainText)}</span>
            ${revBadge}
          </div>
          <div style="font-size: 11px; color: var(--lz-text-secondary);">${escapeHtml(titleText)}</div>
        </div>
        <div class="item-time">${timeAgo}</div>
      </div>
      <div class="item-field-list">
        ${fieldsHtml || '<div style="color: var(--lz-text-muted); font-size: 11px;">No visible fields</div>'}
      </div>
      <div class="item-actions">
        <button class="action-btn restore-playground-btn" data-formid="${escapeAttr(form.id)}">Fill Test Box</button>
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

    // Restore to Playground
    const restoreBtn = itemEl.querySelector('.restore-playground-btn');
    restoreBtn?.addEventListener('click', () => {
      const testTitle = document.getElementById('test-title') as HTMLInputElement;
      const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
      if (testTitle && testBody) {
        fields.forEach((f: any) => {
          if (f.name === 'subject' || f.name?.toLowerCase().includes('title')) {
            testTitle.value = f.value;
          } else if (
            f.name === 'notes' ||
            f.type === 'textarea' ||
            f.name?.toLowerCase().includes('body')
          ) {
            testBody.value = f.value;
          } else if (!testTitle.value) {
            testTitle.value = f.value;
          } else {
            testBody.value += (testBody.value ? '\n' : '') + f.value;
          }
        });
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

export function triggerPlaygroundAutosave(isSubmit = false) {
  const testTitle = document.getElementById('test-title') as HTMLInputElement;
  const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (!testTitle || !testBody) return;

  const titleVal = testTitle.value;
  const bodyVal = testBody.value;

  if (!titleVal.trim() && !bodyVal.trim()) return;

  const message: RuntimeMessage = {
    type: isSubmit ? 'SUBMIT_FORM' : 'SAVE_AUTOSAVE',
    payload: {
      form: {
        formInstanceId: 'sidepanel-playground',
        url: window.location.href,
        domain: 'sidepanel.lazarus',
        title: 'Sidepanel Playground Form',
        editingTime: 10,
        fields: [
          { name: 'subject', type: 'text', value: titleVal },
          { name: 'notes', type: 'textarea', value: bodyVal },
        ],
      },
    },
  };

  chrome.runtime
    .sendMessage(message)
    .then(() => {
      loadHistory(searchInput?.value || '');
    })
    .catch(() => {});
}

export function initSidepanel() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const closeDiffBtn = document.getElementById('close-diff-btn') as HTMLButtonElement;
  const diffViewer = document.getElementById('diff-viewer') as HTMLElement;
  const togglePlaygroundTitle = document.getElementById('toggle-playground-title') as HTMLElement;
  const playgroundForm = document.getElementById('playground-form') as HTMLFormElement;
  const testTitle = document.getElementById('test-title') as HTMLInputElement;
  const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
  const clearPlaygroundBtn = document.getElementById('clear-playground-btn') as HTMLButtonElement;
  const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
  const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;
  const filterChips = document.querySelectorAll<HTMLElement>('.filter-chip');

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

  if (playgroundForm) {
    playgroundForm.oninput = () => {
      if (playgroundDebounce) window.clearTimeout(playgroundDebounce);
      playgroundDebounce = window.setTimeout(() => {
        triggerPlaygroundAutosave(false);
      }, 500);
    };

    playgroundForm.onsubmit = (e) => {
      e.preventDefault();
      triggerPlaygroundAutosave(true);
    };
  }

  if (clearPlaygroundBtn && testTitle && testBody) {
    clearPlaygroundBtn.onclick = () => {
      testTitle.value = '';
      testBody.value = '';
    };
  }

  if (togglePlaygroundTitle && playgroundForm) {
    togglePlaygroundTitle.onclick = () => {
      const isHidden = playgroundForm.style.display === 'none';
      playgroundForm.style.display = isHidden ? 'block' : 'none';
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

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    const activeId = document.activeElement?.id;
    if (activeId !== 'search-input' && activeId !== 'test-title' && activeId !== 'test-body') {
      loadHistory(searchInput?.value || '');
    }
  }, 2500);

  loadHistory();
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
