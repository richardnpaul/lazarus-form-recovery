import { describe, it, expect, beforeEach, vi } from 'vitest';

const SIDEPANEL_HTML = `
  <section id="site-banner" class="site-banner">
    <span id="site-beacon" class="site-dot"></span>
    <span id="site-domain">Checking...</span>
    <span id="site-status">Detecting...</span>
    <input type="checkbox" id="domain-toggle" checked>
  </section>
  <main id="history-list" class="history-list"></main>
  <span id="history-count">Loading...</span>
  <input type="search" id="search-input">
  <section id="diff-viewer" class="diff-viewer">
    <span id="diff-title"></span>
    <button id="close-diff-btn">Close</button>
    <div id="diff-content"></div>
  </section>
  <div class="filter-chips">
    <button class="filter-chip is-active" data-filter="this_site" id="chip-this-site">This Site</button>
    <button class="filter-chip" data-filter="all">All Sites</button>
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

    // Mock tabs API
    if (!chrome.tabs) {
      (chrome as any).tabs = {};
    }
    chrome.tabs.query = vi
      .fn()
      .mockResolvedValue([{ id: 1, url: 'https://example.com/checkout', active: true }]);
    Object.defineProperty(chrome.tabs, 'onActivated', {
      value: { addListener: vi.fn() },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(chrome.tabs, 'onUpdated', {
      value: { addListener: vi.fn() },
      configurable: true,
      writable: true,
    });

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'IS_DOMAIN_ENABLED') {
        return { success: true, data: { enabled: true } };
      }
      if (msg.type === 'GET_ALL_HISTORY' || msg.type === 'SEARCH_HISTORY') {
        return {
          success: true,
          data: [
            {
              form: {
                id: 'side_form_1',
                domainId: 'example.com',
                url: 'https://example.com/checkout',
                title: 'Example Checkout',
                lastModified: Date.now() - 1000,
                revisionNumber: 1,
                isFinalSubmit: false,
              },
              fields: [
                { name: 'subject', value: 'Draft Subject' },
                { name: 'notes', value: 'Some notes to compare and diff' },
              ],
            },
            {
              form: {
                id: 'side_form_2',
                domainId: 'other-domain.org',
                url: 'https://other-domain.org/contact',
                title: 'Other Domain Form',
                lastModified: Date.now() - 2000,
                revisionNumber: 1,
                isFinalSubmit: false,
              },
              fields: [{ name: 'message', value: 'Hello from another site' }],
            },
          ],
        };
      }
      return { success: true };
    });
  });

  it('renders history, handles diffing, copy-all, filters, and actions', async () => {
    await import('../../src/sidepanel/sidepanel');

    // Wait for initial load
    await new Promise((r) => setTimeout(r, 60));

    const historyList = document.getElementById('history-list');
    // Default filter is 'this_site' (example.com), so only 1 form matches
    expect(historyList?.querySelectorAll('.history-item').length).toBe(1);

    // Active domain banner checks
    const siteDomainEl = document.getElementById('site-domain');
    expect(siteDomainEl?.textContent).toBe('example.com');

    // Domain toggle check
    const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;
    expect(domainToggle.checked).toBe(true);

    // Test toggling off domain tracking
    globalThis.confirm = vi.fn().mockReturnValue(true);
    domainToggle.checked = false;
    domainToggle.dispatchEvent(new Event('change'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DISABLE_DOMAIN',
      payload: { domain: 'example.com', wipeExisting: false },
    });

    // Test toggling back on
    domainToggle.checked = true;
    domainToggle.dispatchEvent(new Event('change'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ENABLE_DOMAIN',
      payload: { domain: 'example.com' },
    });

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

    // 3. Copy All button
    const copyAllBtn = historyList?.querySelector('.copy-all-btn') as HTMLButtonElement;
    copyAllBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // 4. Delete form button
    const deleteBtn = historyList?.querySelector('.delete-form-btn') as HTMLButtonElement;
    deleteBtn?.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DELETE_FORM',
      payload: { formId: 'side_form_1' },
    });
    await new Promise((r) => setTimeout(r, 60));

    // 5. Filter chips: All Sites shows both forms
    const filterChips = document.querySelectorAll('.filter-chips .filter-chip');
    (filterChips[1] as HTMLButtonElement).click(); // 'all'
    await new Promise((r) => setTimeout(r, 60));
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    (filterChips[2] as HTMLButtonElement).click(); // 'today'
    await new Promise((r) => setTimeout(r, 40));
    (filterChips[3] as HTMLButtonElement).click(); // '7days'
    await new Promise((r) => setTimeout(r, 40));
    (filterChips[4] as HTMLButtonElement).click(); // '30days'
    await new Promise((r) => setTimeout(r, 40));
    (filterChips[0] as HTMLButtonElement).click(); // 'this_site'
    await new Promise((r) => setTimeout(r, 40));
    expect(historyList?.querySelectorAll('.history-item').length).toBe(1);

    // 6. Search input
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.value = 'notes';
    searchInput.dispatchEvent(new Event('input'));

    // Wait for search debounce to fire
    await new Promise((r) => setTimeout(r, 300));

    // 7. Clear all history button
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
    clearHistoryBtn.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_HISTORY' });

    // 8. Open settings button
    const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;
    openOptionsBtn.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    // 9. Background message live sync event
    const msgListeners = (chrome.runtime.onMessage.addListener as any).mock?.calls || [];
    if (msgListeners.length > 0) {
      msgListeners[0][0]({ type: 'FORM_SAVED' });
    }

    // 10. Window focus & tab activation
    window.dispatchEvent(new Event('focus'));
    const tabActivatedListeners =
      ((chrome.tabs as any)?.onActivated?.addListener as any)?.mock?.calls || [];
    if (tabActivatedListeners.length > 0) {
      tabActivatedListeners[0][0]({ tabId: 1, windowId: 1 });
    }
  });
});
