import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { formatTimeAgo, computeSimpleDiff } from '../common/utils/text';

const historyList = document.getElementById('history-list') as HTMLElement;
const historyCount = document.getElementById('history-count') as HTMLElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;

// Diff elements
const diffViewer = document.getElementById('diff-viewer') as HTMLElement;
const diffTitle = document.getElementById('diff-title') as HTMLElement;
const diffContent = document.getElementById('diff-content') as HTMLElement;
const closeDiffBtn = document.getElementById('close-diff-btn') as HTMLButtonElement;

// Playground elements
const togglePlaygroundTitle = document.getElementById('toggle-playground-title') as HTMLElement;
const playgroundForm = document.getElementById('playground-form') as HTMLFormElement;
const testTitle = document.getElementById('test-title') as HTMLInputElement;
const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
const clearPlaygroundBtn = document.getElementById('clear-playground-btn') as HTMLButtonElement;

// Footer buttons
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;

// Filter chips
const filterChips = document.querySelectorAll('.filter-chip');

let currentFilter: 'all' | 'today' | '7days' | '30days' = 'all';
let searchDebounce: any = null;
let playgroundDebounce: any = null;

async function loadHistory(query = '') {
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

  return items.filter(item => {
    const age = now - (item.form?.lastModified || 0);
    return age <= maxAgeMs;
  });
}

function renderEmpty() {
  historyCount.textContent = '0 drafts';
  historyList.innerHTML = `
    <div class="empty-history">
      <p style="margin-bottom: 6px; font-weight: 600;">No saved form data found</p>
      <p style="color: var(--lz-text-muted);">Type in the test box above or visit any webpage to see Lazarus automatically preserve your inputs.</p>
    </div>
  `;
}

function renderHistory(items: any[]) {
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
      .map((f: any) => `
        <div class="field-row">
          <span class="field-label" title="${escapeHtml(f.name)}">${escapeHtml(f.name || 'field')}:</span>
          <span class="field-value">${escapeHtml(f.value)}</span>
          <div style="display: flex; gap: 4px;">
            <button class="action-btn copy-field-btn" data-value="${escapeAttr(f.value)}">Copy</button>
            <button class="action-btn diff-field-btn" data-name="${escapeAttr(f.name)}" data-value="${escapeAttr(f.value)}">Diff</button>
          </div>
        </div>
      `).join('');

    itemEl.innerHTML = `
      <div class="item-header">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="item-domain">${escapeHtml(form?.domain || 'Unknown Domain')}</span>
            <span class="filter-chip is-active" style="padding: 1px 6px; font-size: 10px;">Rev ${form?.revisionNumber || 1}${form?.isFinalSubmit ? ' • Submitted' : ''}</span>
          </div>
          <div style="font-size: 11px; color: var(--lz-text-secondary);">${escapeHtml(form?.title || 'Form Draft')}</div>
        </div>
        <div class="item-time">${formatTimeAgo(form?.lastModified || Date.now())}</div>
      </div>
      <div class="item-field-list">
        ${fieldsHtml || '<div style="color: var(--lz-text-muted); font-size: 11px;">No non-empty fields recorded.</div>'}
      </div>
      <div class="item-actions">
        <button class="action-btn restore-playground-btn" data-formid="${escapeAttr(form?.id)}">Fill Test Box</button>
        <button class="action-btn delete delete-form-btn" data-formid="${escapeAttr(form?.id)}">Delete</button>
      </div>
    `;

    // Hook up Copy buttons
    itemEl.querySelectorAll('.copy-field-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.target as HTMLButtonElement;
        const val = target.getAttribute('data-value') || '';
        await navigator.clipboard.writeText(val);
        const originalText = target.textContent;
        target.textContent = 'Copied!';
        target.style.color = 'var(--lz-status-success)';
        setTimeout(() => {
          target.textContent = originalText;
          target.style.color = '';
        }, 1500);
      });
    });

    // Hook up Diff buttons
    itemEl.querySelectorAll('.diff-field-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const fieldName = target.getAttribute('data-name') || 'field';
        const snapshotVal = target.getAttribute('data-value') || '';
        const currentVal = fieldName === 'subject' ? testTitle.value : testBody.value;

        showDiff(fieldName, snapshotVal, currentVal);
      });
    });

    // Hook up Restore to playground button
    itemEl.querySelector('.restore-playground-btn')?.addEventListener('click', () => {
      const subjectField = fields.find((f: any) => f.name === 'subject') || fields[0];
      const notesField = fields.find((f: any) => f.name === 'notes') || fields[1];

      if (subjectField && testTitle) testTitle.value = subjectField.value;
      if (notesField && testBody) testBody.value = notesField.value;

      // Ensure playground is expanded
      playgroundForm.style.display = 'block';
    });

    // Hook up Delete button
    itemEl.querySelector('.delete-form-btn')?.addEventListener('click', async () => {
      if (!form?.id) return;
      await chrome.runtime.sendMessage({
        type: 'DELETE_FORM',
        payload: { formId: form.id },
      });
      loadHistory(searchInput.value);
    });

    historyList.appendChild(itemEl);
  });
}

function showDiff(fieldName: string, historicalText: string, currentDraft: string) {
  diffTitle.textContent = `Revision Diff: ${fieldName} (Snapshot vs Current Draft)`;
  const parts = computeSimpleDiff(historicalText, currentDraft);

  diffContent.innerHTML = parts.map(part => {
    if (part.type === 'added') {
      return `<span class="diff-added">${escapeHtml(part.value)}</span>`;
    } else if (part.type === 'removed') {
      return `<span class="diff-removed">${escapeHtml(part.value)}</span>`;
    }
    return escapeHtml(part.value);
  }).join('');

  diffViewer.classList.add('is-visible');
  if (typeof diffViewer.scrollIntoView === 'function') {
    diffViewer.scrollIntoView({ behavior: 'smooth' });
  }
}

closeDiffBtn.addEventListener('click', () => {
  diffViewer.classList.remove('is-visible');
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;');
}

// Filter chips click handling
filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    currentFilter = (chip.getAttribute('data-filter') as any) || 'all';
    loadHistory(searchInput.value);
  });
});

// Search filter with debouncing
searchInput.addEventListener('input', () => {
  if (searchDebounce) window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => {
    loadHistory(searchInput.value);
  }, 250);
});

// Interactive Playground Form Autosave
function triggerPlaygroundAutosave(isSubmit = false) {
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

  chrome.runtime.sendMessage(message).then(() => {
    loadHistory(searchInput.value);
  }).catch(() => {});
}

playgroundForm.addEventListener('input', () => {
  if (playgroundDebounce) window.clearTimeout(playgroundDebounce);
  playgroundDebounce = window.setTimeout(() => {
    triggerPlaygroundAutosave(false);
  }, 500);
});

playgroundForm.addEventListener('submit', (e) => {
  e.preventDefault();
  triggerPlaygroundAutosave(true);
});

clearPlaygroundBtn.addEventListener('click', () => {
  testTitle.value = '';
  testBody.value = '';
});

togglePlaygroundTitle.addEventListener('click', () => {
  const isHidden = playgroundForm.style.display === 'none';
  playgroundForm.style.display = isHidden ? 'block' : 'none';
});

// Clear All History
clearHistoryBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  if (confirm('Are you sure you want to clear all recovered form history?')) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY' });
    loadHistory();
  }
});

// Open Settings Page
openOptionsBtn.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Live Reactive Sync: Listen for real-time background form save broadcasts
chrome.runtime.onMessage?.addListener((message) => {
  if (message?.type === 'FORM_SAVED' || message?.type === 'REFRESH_HISTORY') {
    loadHistory(searchInput.value);
  }
});

// Auto-refresh when sidepanel window regains focus or tab activates
window.addEventListener('focus', () => {
  loadHistory(searchInput.value);
});

chrome.tabs?.onActivated?.addListener(() => {
  loadHistory(searchInput.value);
});

// Periodic sync polling heartbeat (every 2.5s) to guarantee the sidebar is never stale,
// even if broadcast messages are dropped or if the sidebar was opened after edits began
setInterval(() => {
  const activeId = document.activeElement?.id;
  // Don't interrupt user if they are currently typing in the search box or playground inputs
  if (activeId !== 'search-input' && activeId !== 'test-title' && activeId !== 'test-body') {
    loadHistory(searchInput.value);
  }
}, 2500);

// Initial load
loadHistory();
