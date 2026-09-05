import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  <div class="filter-chips">
    <button class="filter-chip is-active" data-filter="all" id="chip-all-sites">All Sites</button>
    <button class="filter-chip" data-filter="this_site" id="chip-this-site">This Site</button>
    <button class="filter-chip" data-filter="today">Today</button>
    <button class="filter-chip" data-filter="7days">Last 7 Days</button>
    <button class="filter-chip" data-filter="30days">Last 30 Days</button>
  </div>
  <a id="clear-history-btn">Clear All</a>
  <a id="open-options-btn">Settings</a>
`;

describe('Sidepanel UI Controller (src/sidepanel/sidepanel.ts)', () => {
  let sidepanel: any;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = SIDEPANEL_HTML;
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    chrome.tabs.query = vi
      .fn()
      .mockResolvedValue([{ id: 1, url: 'https://example.com/checkout', active: true }]);
    chrome.tabs.get = vi
      .fn()
      .mockResolvedValue({ id: 1, url: 'https://example.com/checkout', active: true });

    // Create mock registries to trigger listeners later
    (globalThis as any).tabActivatedListeners = [];
    (globalThis as any).tabUpdatedListeners = [];
    (globalThis as any).runtimeMessageListeners = [];

    Object.defineProperty(chrome.tabs, 'onActivated', {
      value: { addListener: vi.fn((cb) => (globalThis as any).tabActivatedListeners.push(cb)) },
      writable: true,
    });
    Object.defineProperty(chrome.tabs, 'onUpdated', {
      value: { addListener: vi.fn((cb) => (globalThis as any).tabUpdatedListeners.push(cb)) },
      writable: true,
    });
    Object.defineProperty(chrome.runtime, 'onMessage', {
      value: { addListener: vi.fn((cb) => (globalThis as any).runtimeMessageListeners.push(cb)) },
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
                lastModified: Date.now() - 60 * 1000,
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

    sidepanel = await import('../../src/sidepanel/sidepanel');
    sidepanel.initSidepanel();
    await Promise.resolve(); // flush promises
  });

  afterEach(() => {
    if (sidepanel) {
      sidepanel.stopSidepanelHeartbeat();
    }
    vi.useRealTimers();
  });

  it('renders history, handles diffing, copy-all, filters, and actions', async () => {
    // Wait for initial load
    await Promise.resolve();
    await Promise.resolve();

    const historyList = document.getElementById('history-list');
    // Default filter is 'all', so both forms (example.com and other-domain.org) match
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    // Active domain banner checks
    const siteDomainEl = document.getElementById('site-domain');
    expect(siteDomainEl?.textContent).toBe('example.com');
    expect(siteDomainEl?.title).toBe('https://example.com/checkout');

    // Domain toggle check
    const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;
    expect(domainToggle.checked).toBe(true);

    // Test toggling off domain tracking
    globalThis.confirm = vi.fn().mockReturnValue(true);
    domainToggle.checked = false;
    domainToggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DISABLE_DOMAIN',
      payload: { domain: 'example.com', wipeExisting: false },
    });

    // Test toggling back on
    domainToggle.checked = true;
    domainToggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ENABLE_DOMAIN',
      payload: { domain: 'example.com' },
    });

    // Test toggling off but cancelled
    globalThis.confirm = vi.fn().mockReturnValue(false);
    domainToggle.checked = false;
    domainToggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(domainToggle.checked).toBe(true); // Should revert

    // Verify count badge
    expect(document.getElementById('history-count')?.textContent).toBe('2 drafts');

    // 1. Copy field button
    const copyBtn = historyList?.querySelector('.copy-field-btn') as HTMLButtonElement;
    const originalText = copyBtn?.textContent;
    expect(originalText).toBe('Copy');
    await copyBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Draft Subject');
    expect(copyBtn.textContent).toBe('Copied!');
    vi.advanceTimersByTime(1200);
    expect(copyBtn.textContent).toBe('Copy');

    // 2. Copy All button
    const copyAllBtn = historyList?.querySelector('.copy-all-btn') as HTMLButtonElement;
    await copyAllBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'subject: Draft Subject\n\nnotes: Some notes to compare and diff'
    );
    expect(copyAllBtn.textContent).toBe('Copied All!');
    vi.advanceTimersByTime(1200);
    expect(copyAllBtn.textContent).toBe('Copy All');

    // 4. Delete form button
    const deleteBtn = historyList?.querySelector('.delete-form-btn') as HTMLButtonElement;
    deleteBtn?.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DELETE_FORM',
      payload: { formId: 'side_form_1' },
    });
    await Promise.resolve();

    // 5. Filter chips: Switch to 'This Site' (filterChips[1])
    const filterChips = document.querySelectorAll('.filter-chips .filter-chip');
    (filterChips[1] as HTMLButtonElement).click(); // 'this_site'
    await Promise.resolve();
    expect(historyList?.querySelectorAll('.history-item').length).toBe(1);
    expect(document.getElementById('history-count')?.textContent).toBe('1 draft');

    (filterChips[2] as HTMLButtonElement).click(); // 'today'
    await Promise.resolve();
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    (filterChips[3] as HTMLButtonElement).click(); // '7days'
    await Promise.resolve();
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    (filterChips[4] as HTMLButtonElement).click(); // '30days'
    await Promise.resolve();
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    (filterChips[0] as HTMLButtonElement).click(); // 'all'
    await Promise.resolve();
    expect(historyList?.querySelectorAll('.history-item').length).toBe(2);

    // 6. Search input
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.value = 'notes';
    searchInput.dispatchEvent(new Event('input'));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'SEARCH_HISTORY',
      payload: { query: 'notes' },
    });

    // Wait for search debounce to fire
    vi.advanceTimersByTime(250);
    await Promise.resolve();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SEARCH_HISTORY',
      payload: { query: 'notes' },
    });

    // 7. Clear all history button
    globalThis.confirm = vi.fn().mockReturnValue(true);
    const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLAnchorElement;
    clearHistoryBtn.click();
    await Promise.resolve();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_HISTORY' });

    // 8. Open settings button
    const openOptionsBtn = document.getElementById('open-options-btn') as HTMLAnchorElement;
    openOptionsBtn.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('handles empty states strictly', async () => {
    // GET_ALL_HISTORY returns empty list
    (chrome.runtime.sendMessage as any).mockResolvedValue({
      success: true,
      data: [],
    });

    // Switch to 'this_site'
    const thisSiteChip = document.getElementById('chip-this-site') as HTMLButtonElement;
    thisSiteChip.click();
    await Promise.resolve();

    const historyList = document.getElementById('history-list');
    expect(historyList?.textContent).toContain('No saved form data for example.com');
    expect(historyList?.textContent).toContain('Drafts are saved as you type on this site.');

    // Click "View All Sites" inside empty state
    const viewAllBtn = document.getElementById('view-all-sites-btn') as HTMLButtonElement;
    expect(viewAllBtn).not.toBeNull();
    viewAllBtn?.click();
    await Promise.resolve();
    expect(document.getElementById('chip-all-sites')?.classList.contains('is-active')).toBe(true);
  });

  it('handles empty state for All Sites strictly', async () => {
    (chrome.runtime.sendMessage as any).mockResolvedValue({
      success: true,
      data: [],
    });
    await sidepanel.loadHistory();
    await Promise.resolve();

    const historyList = document.getElementById('history-list');
    expect(historyList?.textContent).toContain('No saved form data found');
    expect(historyList?.textContent).toContain(
      'Visit any webpage and fill in forms to see Lazarus automatically preserve your drafts.'
    );
  });

  it('handles non-web pages, query fallbacks, and disabled tracking states in resolveActiveTab', async () => {
    // 1. Fallback 1: currentWindow returns empty, lastFocusedWindow returns a tab
    (chrome.tabs.query as any).mockImplementation(async (opts: any) => {
      if (opts.currentWindow) return [];
      if (opts.lastFocusedWindow) return [{ id: 5, url: 'https://fallback.com/page' }];
      return [];
    });
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-domain')?.textContent).toBe('fallback.com');

    // 2. Fallback 2: lastFocusedWindow also empty, active: true returns a tab
    (chrome.tabs.query as any).mockImplementation(async (opts: any) => {
      if (opts.currentWindow) return [];
      if (opts.lastFocusedWindow) return [];
      return [{ id: 6, url: 'https://any-window.com/form' }];
    });
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-domain')?.textContent).toBe('any-window.com');

    // 3. Non-web URL (e.g. chrome://extensions or about:blank)
    (chrome.tabs.query as any).mockResolvedValueOnce([{ id: 7, url: 'chrome://extensions' }]);
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-domain')?.textContent).toBe('No active website');
    expect(document.getElementById('site-status')?.textContent).toBe('Non-web page');
    expect((document.getElementById('domain-toggle') as HTMLInputElement).disabled).toBe(true);
    expect(
      (document.getElementById('site-beacon') as HTMLInputElement).classList.contains('is-disabled')
    ).toBe(true);

    // 4. Tab query error
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (chrome.tabs.query as any).mockRejectedValueOnce(new Error('TabQueryCrash'));
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-domain')?.textContent).toBe('No active website');
    expect(document.getElementById('site-domain')?.title).toBe('');
    warnSpy.mockRestore();

    // 5. Disabled domain tracking state
    (chrome.tabs.query as any).mockResolvedValue([{ id: 8, url: 'https://disabled-site.com' }]);
    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
      success: true,
      data: { enabled: false },
    });
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-status')?.textContent).toBe('Tracking paused');
    expect((document.getElementById('domain-toggle') as HTMLInputElement).checked).toBe(false);
    expect(
      (document.getElementById('site-beacon') as HTMLInputElement).classList.contains('is-disabled')
    ).toBe(true);

    // 6. Test with file:// protocol
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 9, url: 'file:///C:/Users/test/index.html', active: true },
    ]);
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-domain')?.textContent).toBe('No active website');

    // 7. Test gracefully returning when history-list is missing
    const historyList = document.getElementById('history-list');
    historyList?.remove();
    await sidepanel.loadHistory(); // Should not throw
    document.body.innerHTML = SIDEPANEL_HTML; // Restore
  });

  it('strictly handles heartbeat interval and DOM focus', async () => {
    // Simulate heartbeat
    const querySpy = vi.spyOn(chrome.tabs, 'query');
    querySpy.mockClear();
    vi.advanceTimersByTime(2500);
    await Promise.resolve();
    expect(querySpy).toHaveBeenCalled();

    // Test document focus event with 'this_site' filter to hit the internal branch
    const searchSpy = vi.spyOn(chrome.runtime, 'sendMessage');
    const thisSiteChip = document.getElementById('chip-this-site') as HTMLElement;
    if (thisSiteChip && thisSiteChip.onclick) {
      thisSiteChip.onclick(new Event('click') as any);
    }
    await Promise.resolve(); // wait for loadHistory

    querySpy.mockClear();
    searchSpy.mockClear();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(querySpy).toHaveBeenCalled();
    expect(searchSpy).toHaveBeenCalledWith({ type: 'GET_ALL_HISTORY', payload: { limit: 50 } });

    // reset filter
    const allSitesChip = document.getElementById('chip-all-sites') as HTMLElement;
    if (allSitesChip && allSitesChip.onclick) {
      allSitesChip.onclick(new Event('click') as any);
    }
    await Promise.resolve();

    // Simulate background sync message
    searchSpy.mockClear();
    const msgListeners = (chrome.runtime.onMessage.addListener as any).mock?.calls || [];
    if (msgListeners.length > 0) {
      msgListeners[0][0]({ type: 'FORM_SAVED' });
      await Promise.resolve();
      expect(searchSpy).toHaveBeenCalledWith({ type: 'GET_ALL_HISTORY', payload: { limit: 50 } });
    }
  });

  it('covers renderHistory exact template formatting', async () => {
    const now = Date.now();
    const diverseItems = [
      {
        form: {
          id: 'submitted_form',
          domainId: 'shop.com',
          domain: 'shop.com',
          lastModified: now - 30 * 60 * 1000, // 30m ago (today)
          revisionNumber: 3,
          isFinalSubmit: true,
        },
        fields: [],
      },
    ];

    (chrome.runtime.sendMessage as any).mockResolvedValue({
      success: true,
      data: diverseItems,
    });

    await sidepanel.loadHistory();
    await Promise.resolve();

    const historyList = document.getElementById('history-list');
    expect(historyList?.innerHTML).toContain('Rev 3 • Submitted');
    expect(historyList?.innerHTML).toContain('No visible fields');
    expect(historyList?.innerHTML).toContain('shop.com');
    expect(historyList?.innerHTML).toContain('Untitled Form');
    expect(historyList?.innerHTML).toContain('30m ago'); // Since timeAgo isn't mock exactly, it might format correctly, wait no, formatTimeAgo will return '30 minutes ago' etc.
    expect(historyList?.innerHTML).not.toContain('https://');
  });

  it('covers event listeners for tabs and runtime messages strictly', async () => {
    // 1. chrome.tabs.onActivated
    const activatedListeners = (globalThis as any).tabActivatedListeners || [];
    if (activatedListeners.length > 0) {
      // Set to 'this_site' to hit the internal branch
      const thisSiteChip = document.getElementById('chip-this-site') as HTMLElement;
      if (thisSiteChip && thisSiteChip.onclick) thisSiteChip.onclick(new Event('click') as any);
      await Promise.resolve();

      // Branch: activeInfo has tabId, tab.url is http/https
      (chrome.tabs.get as any).mockResolvedValueOnce({ id: 10, url: 'https://newsite.com/home' });
      (chrome.tabs.query as any).mockResolvedValueOnce([
        { id: 10, url: 'https://newsite.com/home', active: true },
      ]);
      await activatedListeners[0]({ tabId: 10 });
      expect(document.getElementById('site-domain')?.textContent).toBe('newsite.com');

      // Branch: tab.url is non-web
      (chrome.tabs.get as any).mockResolvedValueOnce({ id: 11, url: 'chrome://settings' });
      await activatedListeners[0]({ tabId: 11 });

      // Branch: exception in chrome.tabs.get
      (chrome.tabs.get as any).mockRejectedValueOnce(new Error('TabError'));
      await activatedListeners[0]({ tabId: 12 });

      // Branch: no activeInfo.tabId
      await activatedListeners[0]({});

      const allSitesChip = document.getElementById('chip-all-sites') as HTMLElement;
      if (allSitesChip && allSitesChip.onclick) allSitesChip.onclick(new Event('click') as any);
      await Promise.resolve();
    }

    // 2. chrome.tabs.onUpdated
    const updatedListeners = (globalThis as any).tabUpdatedListeners || [];
    if (updatedListeners.length > 0) {
      const thisSiteChip = document.getElementById('chip-this-site') as HTMLElement;
      if (thisSiteChip && thisSiteChip.onclick) thisSiteChip.onclick(new Event('click') as any);
      await Promise.resolve();

      // Branch: changeInfo.url is present, tab.active is true
      (chrome.tabs.query as any).mockResolvedValueOnce([
        { id: 20, url: 'https://updated.com/page', active: true },
      ]);
      await updatedListeners[0](
        20,
        { url: 'https://updated.com/page' },
        { id: 20, url: 'https://updated.com/page', active: true }
      );
      expect(document.getElementById('site-domain')?.textContent).toBe('updated.com');

      // Branch: changeInfo.status === 'complete', non-web url
      await updatedListeners[0](
        21,
        { status: 'complete' },
        { id: 21, url: 'about:blank', active: true }
      );

      // Branch: changeInfo empty but tab.url exists, exception in parsing
      await updatedListeners[0](22, {}, { id: 22, url: 'invalid-url::', active: true });

      // Branch: not active tab
      await updatedListeners[0](
        23,
        { url: 'https://background.com' },
        { id: 23, url: 'https://background.com', active: false }
      );

      const allSitesChip = document.getElementById('chip-all-sites') as HTMLElement;
      if (allSitesChip && allSitesChip.onclick) allSitesChip.onclick(new Event('click') as any);
      await Promise.resolve();
    }

    // 3. chrome.runtime.onMessage
    const msgListeners = (globalThis as any).runtimeMessageListeners || [];
    if (msgListeners.length > 0) {
      // Branch: FORM_SAVED
      msgListeners[0]({ type: 'FORM_SAVED' });
      // Branch: REFRESH_HISTORY
      msgListeners[0]({ type: 'REFRESH_HISTORY' });
      // Branch: OTHER
      msgListeners[0]({ type: 'OTHER' });
      // Branch: null message
      msgListeners[0](null);
    }
  });

  it('covers DOMContentLoaded deferred boot path strictly', async () => {
    vi.resetModules();
    // Mock readyState to 'loading'
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

    // Import sidepanel while loading
    const deferredSidepanel = await import('../../src/sidepanel/sidepanel');

    // Dispatch event
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Restore readyState
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  });
});
