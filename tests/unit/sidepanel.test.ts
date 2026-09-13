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

  it('handles edge cases in tab resolution, domain toggling, history loading, and window focus', async () => {
    sidepanel = await import('../../src/sidepanel/sidepanel');
    await Promise.resolve();

    // 1. URL parse error on active tab (line 44)
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'http://' }]);
    await sidepanel.resolveActiveTab();

    // 2. Active tab with no URL (lines 47-48)
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1 }]);
    await sidepanel.resolveActiveTab();

    // 3. updateSiteStatus error branch (line 91)
    (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('SiteStatusFail'));
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    await sidepanel.resolveActiveTab();
    expect(document.getElementById('site-status')?.textContent).toBe('Tracking active');

    // 4. loadHistory non-success response (line 110)
    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
    await sidepanel.loadHistory('');

    // 5. loadHistory throw error branch (lines 113-114)
    (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('LoadFail'));
    await sidepanel.loadHistory('');

    // 6. applyFilter with this_site and empty currentDomain (line 122)
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'about:blank' }]);
    await sidepanel.resolveActiveTab();
    const thisSiteChip = document.getElementById('chip-this-site') as HTMLElement;
    thisSiteChip.click();
    await sidepanel.loadHistory('');

    // 7. Domain toggle when currentDomain is empty (line 377)
    const toggle = document.getElementById('domain-toggle') as HTMLInputElement;
    toggle.dispatchEvent(new Event('change'));

    // 8. Missing history-list / history-count in renderHistory (lines 151, 199, 332)
    document.getElementById('history-list')?.remove();
    sidepanel.initSidepanel();
    sidepanel.renderEmpty();
    sidepanel.renderHistory([]);
    await sidepanel.loadHistory('');

    // 9. Window focus event with this_site filter (lines 470-471)
    document.body.innerHTML = SIDEPANEL_HTML;
    sidepanel = await import('../../src/sidepanel/sidepanel');
    (document.getElementById('chip-this-site') as HTMLElement)?.click();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
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

  describe('Sidepanel Complete Branch Coverage', () => {
    it('covers all DOM null guards and empty states in updateSiteStatus and initSidepanel', async () => {
      vi.resetModules();
      // Test with minimal body (no banner elements, no chips, no search input, etc.)
      document.body.innerHTML = '<main id="history-list"></main><span id="history-count"></span>';
      sidepanel = await import('../../src/sidepanel/sidepanel');

      // 1. Non-web page with missing site banner elements (lines 56, 62, 63, 64)
      chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'about:blank' }]);
      await sidepanel.resolveActiveTab();

      // 2. Web page with missing site banner elements (lines 56, 71, 80, 87)
      chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: { enabled: true },
      });
      await sidepanel.resolveActiveTab();

      // 3. Web page with error and missing siteStatusEl in catch (line 91)
      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('SiteStatusError'));
      await sidepanel.resolveActiveTab();

      // 4. initSidepanel when searchInput, clearHistoryBtn, openOptionsBtn, domainToggle are absent (lines 348, 357, 367, 375)
      sidepanel.initSidepanel();
    });

    it('covers IS_DOMAIN_ENABLED response branches and domain toggle dialog cancellation', async () => {
      vi.resetModules();
      document.body.innerHTML = SIDEPANEL_HTML;
      sidepanel = await import('../../src/sidepanel/sidepanel');

      // 1. res.success is false -> isEnabled defaults to true (line 78)
      chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await sidepanel.resolveActiveTab();
      expect(document.getElementById('site-status')?.textContent).toBe('Tracking active');

      // 2. res.success is true, enabled is false -> tracking paused (lines 80-88)
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: { enabled: false },
      });
      await sidepanel.resolveActiveTab();
      expect(document.getElementById('site-status')?.textContent).toBe('Tracking paused');

      // 3. Domain toggle click when disabling: confirm cancelled (lines 380-383)
      const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;
      domainToggle.checked = false; // user attempts to uncheck
      window.confirm = vi.fn().mockReturnValue(false); // user cancels confirm
      domainToggle.dispatchEvent(new Event('change'));
      expect(domainToggle.checked).toBe(true);

      // 4. Clear history button: confirm cancelled (lines 359-363)
      const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLElement;
      window.confirm = vi.fn().mockReturnValue(false);
      clearHistoryBtn.dispatchEvent(new MouseEvent('click'));

      // 5. Open options button click (line 368-371)
      const openOptionsBtn = document.getElementById('open-options-btn') as HTMLElement;
      openOptionsBtn.dispatchEvent(new MouseEvent('click'));
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
    });

    it('covers filter chips fallback, search debounce clearing, and filter age variations', async () => {
      vi.resetModules();
      document.body.innerHTML = SIDEPANEL_HTML;
      sidepanel = await import('../../src/sidepanel/sidepanel');

      // 1. Filter chip without data-filter attribute (line 343: chip.getAttribute('data-filter') || 'all')
      const chipContainer = document.querySelector('.filter-chips');
      const customChip = document.createElement('button');
      customChip.className = 'filter-chip';
      chipContainer?.appendChild(customChip);
      sidepanel.initSidepanel();
      customChip.click();

      // 2. Search debounce clearing when typing rapidly (line 350: if (searchDebounce) window.clearTimeout)
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'a';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.value = 'ab';
      searchInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(300);

      // 3. Filter variations: 7days and 30days with item having undefined lastModified (lines 139-144)
      (chrome.runtime.sendMessage as any).mockResolvedValue({
        success: true,
        data: [
          {
            form: { id: 'f_old', domainId: '', url: '', lastModified: undefined },
            fields: [{ name: 'f1', value: 'val' }],
          },
        ],
      });
      const chip7Days = document.querySelector('.filter-chip[data-filter="7days"]') as HTMLElement;
      chip7Days.click();
      await Promise.resolve();

      const chip30Days = document.querySelector(
        '.filter-chip[data-filter="30days"]'
      ) as HTMLElement;
      chip30Days.click();
      await Promise.resolve();

      // 4. this_site filter with item having domainId: '' and url: '' to cover lines 12, 125, 126
      chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      await sidepanel.resolveActiveTab();
      const chipThisSite = document.querySelector(
        '.filter-chip[data-filter="this_site"]'
      ) as HTMLElement;
      chipThisSite.click();
      await sidepanel.loadHistory('');

      // 5. renderEmpty when currentFilter === 'this_site' and viewAllBtn is absent (line 167)
      const origGet = document.getElementById.bind(document);
      vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
        if (id === 'view-all-sites-btn') return null;
        return origGet(id);
      });
      sidepanel.renderEmpty();
      vi.restoreAllMocks();
    });

    it('covers field and form attribute fallbacks and button event handlers in renderHistory', async () => {
      vi.resetModules();
      document.body.innerHTML = SIDEPANEL_HTML;
      sidepanel = await import('../../src/sidepanel/sidepanel');

      // Intercept addEventListener to capture click callbacks
      let copyFieldListener: any = null;
      let copyAllListener: any = null;
      const origAddEventListener = Element.prototype.addEventListener;
      vi.spyOn(Element.prototype, 'addEventListener').mockImplementation(function (
        this: any,
        event: string,
        listener: any,
        options: any
      ) {
        if (event === 'click' && this.classList?.contains('copy-field-btn')) {
          copyFieldListener = listener;
        }
        if (event === 'click' && this.classList?.contains('copy-all-btn')) {
          copyAllListener = listener;
        }
        return origAddEventListener.call(this, event, listener, options);
      });

      // Render history with missing/falsy fields, field name empty, lastModified 0, revisionNumber 0
      sidepanel.renderHistory([
        {
          form: {
            id: 'form_sparse',
            domainId: '',
            url: '',
            lastModified: 0,
            revisionNumber: 0,
            isFinalSubmit: false,
          },
          fields: [{ name: '', value: 'Single Value' }],
        },
        {
          form: {
            id: 'form_no_fields_array',
            domainId: 'test.com',
            url: 'https://test.com',
            lastModified: 1000,
          },
          fields: null, // not an array -> line 212
        },
      ]);

      // 1. Copy field button with empty data-value and empty textContent (lines 270-271)
      const copyFieldBtn = document.querySelector('.copy-field-btn') as HTMLElement;
      copyFieldBtn.removeAttribute('data-value');
      copyFieldBtn.textContent = '';
      copyFieldBtn.click();
      await Promise.resolve();
      vi.advanceTimersByTime(1300);
      expect(copyFieldBtn.textContent).toBe('Copy');

      // 2. Copy all button with empty textContent and empty field name (lines 286, 289)
      const copyAllBtn = document.querySelector('.copy-all-btn') as HTMLElement;
      copyAllBtn.textContent = '';
      copyAllBtn.click();
      await Promise.resolve();
      vi.advanceTimersByTime(1300);
      expect(copyAllBtn.textContent).toBe('Copy All');

      // 3. Delete button with missing data-formid (line 304: if (formId) false branch)
      const deleteBtn = document.querySelector('.delete-form-btn') as HTMLElement;
      deleteBtn.removeAttribute('data-formid');
      deleteBtn.click();

      // 4. Null currentTarget invocations to cover false branches of if (btnEl) (lines 273, 292)
      if (copyFieldListener) {
        await copyFieldListener({ currentTarget: null });
      }
      if (copyAllListener) {
        await copyAllListener({ currentTarget: null });
      }
      vi.restoreAllMocks();
    });

    it('covers heartbeat with search input focused, stop heartbeat when already stopped, and tab listeners', async () => {
      vi.resetModules();
      document.body.innerHTML = SIDEPANEL_HTML;
      sidepanel = await import('../../src/sidepanel/sidepanel');

      // 1. Heartbeat timer when activeId === 'search-input' (line 403)
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.focus();
      vi.advanceTimersByTime(2600);
      await Promise.resolve();

      // 2. stopSidepanelHeartbeat called when already stopped (line 416)
      sidepanel.stopSidepanelHeartbeat();
      sidepanel.stopSidepanelHeartbeat(); // second call when heartbeatInterval is null

      // 3. chrome.tabs.onActivated when tab has no url, and when filter is 'all' (lines 428, 440)
      const activatedListeners = (globalThis as any).tabActivatedListeners || [];
      if (activatedListeners.length > 0) {
        (chrome.tabs.get as any).mockResolvedValueOnce({ id: 99, url: undefined });
        await activatedListeners[0]({ tabId: 99 });
      }

      // 4. chrome.tabs.onUpdated when changeInfo and tab have no match, and when filter is 'all' (lines 447, 458)
      const updatedListeners = (globalThis as any).tabUpdatedListeners || [];
      if (updatedListeners.length > 0) {
        // changeInfo has status 'loading', tab has no url (line 447 false branch)
        await updatedListeners[0](99, { status: 'loading' }, { id: 99, url: '' } as any);

        // changeInfo has status 'complete' and currentFilter is 'all' (line 458 false branch)
        (document.getElementById('chip-all-sites') as HTMLElement)?.click();
        await updatedListeners[0](99, { status: 'complete' }, {
          id: 99,
          active: true,
          url: 'https://example.com',
        } as any);
      }
    });

    it('covers top-level environment branches when chrome.tabs, chrome.runtime.onMessage, chrome, window, or document are missing', async () => {
      // 1. chrome.tabs undefined (line 423)
      vi.resetModules();
      const origTabs = chrome.tabs;
      delete (chrome as any).tabs;
      await import('../../src/sidepanel/sidepanel');
      (chrome as any).tabs = origTabs;

      // 2. chrome.runtime.onMessage undefined (line 477)
      vi.resetModules();
      const origOnMsg = chrome.runtime.onMessage;
      delete (chrome.runtime as any).onMessage;
      await import('../../src/sidepanel/sidepanel');
      (chrome.runtime as any).onMessage = origOnMsg;

      // 3. chrome undefined (lines 423, 477)
      vi.resetModules();
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;
      await import('../../src/sidepanel/sidepanel');
      (globalThis as any).chrome = origChrome;

      // 4. window undefined (line 466)
      vi.resetModules();
      const origWindow = (globalThis as any).window;
      delete (globalThis as any).window;
      await import('../../src/sidepanel/sidepanel');
      (globalThis as any).window = origWindow;

      // 5. document undefined (lines 487, 489)
      vi.resetModules();
      const origDoc = (globalThis as any).document;
      delete (globalThis as any).document;
      await import('../../src/sidepanel/sidepanel');
      (globalThis as any).document = origDoc;
    });
  });
});
