import { describe, it, expect, beforeEach, vi } from 'vitest';

const SIDEPANEL_HTML = `
  <main id="history-list" class="history-list"></main>
  <span id="history-count">Loading...</span>
  <input type="search" id="search-input">
  <section id="diff-viewer" class="diff-viewer">
    <span id="diff-title"></span>
    <button id="close-diff-btn">Close</button>
    <div id="diff-content"></div>
  </section>
  <div id="toggle-playground-title">Playground</div>
  <form id="playground-form">
    <input type="text" id="test-title" name="subject">
    <textarea id="test-body" name="notes"></textarea>
    <button type="submit">Save Now</button>
    <button type="button" id="clear-playground-btn">Clear Inputs</button>
  </form>
  <div class="filter-chips">
    <button class="filter-chip is-active" data-filter="all">All</button>
    <button class="filter-chip" data-filter="today">Today</button>
    <button class="filter-chip" data-filter="7days">Last 7 Days</button>
    <button class="filter-chip" data-filter="30days">Last 30 Days</button>
  </div>
  <a id="clear-history-btn">Clear All</a>
  <a id="open-options-btn">Settings</a>
`;

describe('Sidepanel UI Controller (src/sidepanel/sidepanel.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = SIDEPANEL_HTML;
    vi.clearAllMocks();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'GET_ALL_HISTORY' || msg.type === 'SEARCH_HISTORY') {
        return {
          success: true,
          data: [
            {
              form: {
                id: 'side_form_1',
                domain: 'example.com',
                title: 'Example Page',
                lastModified: Date.now() - 1000,
                revisionNumber: 1,
                isFinalSubmit: false,
              },
              fields: [
                { name: 'subject', value: 'Draft Subject' },
                { name: 'notes', value: 'Some notes to compare and diff' },
              ],
            },
          ],
        };
      }
      return { success: true };
    });
  });

  it('renders history, handles diffing, playground autosaves, filters, and actions', async () => {
    await import('../../src/sidepanel/sidepanel');

    // Wait for initial load
    await new Promise((r) => setTimeout(r, 60));

    const historyList = document.getElementById('history-list');
    expect(historyList?.querySelectorAll('.history-item').length).toBe(1);

    // 1. Copy field button
    const copyBtn = historyList?.querySelector('.copy-field-btn') as HTMLButtonElement;
    copyBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // 2. Diff button
    const diffBtn = historyList?.querySelector('.diff-field-btn') as HTMLButtonElement;
    diffBtn?.click();
    const diffViewer = document.getElementById('diff-viewer');
    expect(diffViewer?.classList.contains('is-visible')).toBe(true);

    // Close diff viewer
    const closeDiffBtn = document.getElementById('close-diff-btn') as HTMLButtonElement;
    closeDiffBtn?.click();
    expect(diffViewer?.classList.contains('is-visible')).toBe(false);

    // 3. Fill playground / test box button
    const fillBtn = historyList?.querySelector('.restore-playground-btn') as HTMLButtonElement;
    fillBtn?.click();
    const testTitle = document.getElementById('test-title') as HTMLInputElement;
    expect(testTitle.value).toBe('Draft Subject');

    // 4. Delete form button
    const deleteBtn = historyList?.querySelector('.delete-form-btn') as HTMLButtonElement;
    deleteBtn?.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DELETE_FORM',
      payload: { formId: 'side_form_1' },
    });

    // 5. Filter chips
    const filterChips = document.querySelectorAll('.filter-chip');
    (filterChips[1] as HTMLButtonElement).click(); // 'today'
    (filterChips[2] as HTMLButtonElement).click(); // '7days'
    (filterChips[3] as HTMLButtonElement).click(); // '30days'
    (filterChips[0] as HTMLButtonElement).click(); // 'all'

    // 6. Search input
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.value = 'notes';
    searchInput.dispatchEvent(new Event('input'));

    // 7. Playground form typing & submit & toggle & clear
    const playgroundForm = document.getElementById('playground-form') as HTMLFormElement;
    testTitle.value = 'New Playground Title';
    playgroundForm.dispatchEvent(new Event('input'));

    // Wait for search & playground debounce to fire
    await new Promise((r) => setTimeout(r, 600));

    playgroundForm.dispatchEvent(new Event('submit'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();

    const clearPlaygroundBtn = document.getElementById('clear-playground-btn') as HTMLButtonElement;
    clearPlaygroundBtn.click();
    expect(testTitle.value).toBe('');

    const toggleTitle = document.getElementById('toggle-playground-title') as HTMLElement;
    toggleTitle.click();
    toggleTitle.click();

    // 8. Clear all history button
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
    clearHistoryBtn.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_HISTORY' });

    // 9. Open settings button
    const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;
    openOptionsBtn.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    // 10. Background message live sync event
    const msgListeners = (chrome.runtime.onMessage.addListener as any).mock?.calls || [];
    if (msgListeners.length > 0) {
      msgListeners[0][0]({ type: 'FORM_SAVED' });
    }

    // 11. Window focus & tab activation
    window.dispatchEvent(new Event('focus'));
    const tabActivatedListeners =
      ((chrome.tabs as any)?.onActivated?.addListener as any)?.mock?.calls || [];
    if (tabActivatedListeners.length > 0) {
      tabActivatedListeners[0][0]({ tabId: 1, windowId: 1 });
    }
  });
});
