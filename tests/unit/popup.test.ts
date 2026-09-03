import { describe, it, expect, beforeEach, vi } from 'vitest';

const POPUP_HTML = `
  <span id="status-beacon" class="status-beacon"></span>
  <span id="active-domain-text">current site</span>
  <span id="domain-display">Checking site...</span>
  <span id="domain-stats">Tracking enabled</span>
  <input type="checkbox" id="domain-toggle" checked>
  <button id="tab-current" class="tab-btn is-active">Current Tab</button>
  <button id="tab-search" class="tab-btn">Global Search</button>
  <div id="search-container" class="search-container">
    <input type="search" id="search-input" class="search-input">
  </div>
  <main id="feed-container" class="content-area"></main>
  <button id="vault-btn" class="vault-status-btn">
    <span id="vault-icon">🔓</span>
    <span id="vault-label">Vault: Off</span>
  </button>
  <a id="open-sidepanel-link">Side Panel</a>
  <a id="open-options-link">Options</a>
`;

describe('Popup UI Controller (src/popup/popup.ts)', () => {
  beforeEach(() => {
    document.body.innerHTML = POPUP_HTML;
    vi.clearAllMocks();

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Mock runtime responses
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'IS_DOMAIN_ENABLED') {
        return { success: true, data: { enabled: true } };
      }
      if (msg.type === 'CHECK_VAULT_STATUS') {
        return { success: true, data: { hasMasterPassword: false, isUnlocked: false } };
      }
      if (msg.type === 'GET_DOMAIN_HISTORY' || msg.type === 'GET_ALL_HISTORY' || msg.type === 'SEARCH_HISTORY') {
        return {
          success: true,
          data: [
            {
              form: { id: 'f1', title: 'Test Form', lastModified: Date.now() - 5000, revisionNumber: 1, isFinalSubmit: true },
              fields: [
                { name: 'username', value: 'alice' },
                { name: 'bio', value: 'A short bio snippet' },
              ],
            },
          ],
        };
      }
      return { success: true };
    });
  });

  it('initializes and renders popup feed, toggles domain, and switches tabs', async () => {
    await import('../../src/popup/popup');

    // Wait for async init
    await new Promise((r) => setTimeout(r, 100));

    const domainDisplay = document.getElementById('domain-display');
    expect(domainDisplay?.textContent).toBeDefined();

    const feed = document.getElementById('feed-container');
    expect(feed?.querySelectorAll('.form-card').length).toBe(1);

    // Toggle accordion
    const toggleBtn = feed?.querySelector('.toggle-accordion-btn') as HTMLButtonElement;
    toggleBtn?.click();
    expect(toggleBtn?.textContent).toBe('Fields ▴');
    toggleBtn?.click();
    expect(toggleBtn?.textContent).toBe('Fields ▾');

    // Copy All button
    const copyAllBtn = feed?.querySelector('.copy-all-btn') as HTMLButtonElement;
    copyAllBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // Mini copy button
    const miniCopyBtn = feed?.querySelector('.copy-mini-btn') as HTMLButtonElement;
    miniCopyBtn?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // Toggle domain switch (disable)
    const domainToggle = document.getElementById('domain-toggle') as HTMLInputElement;
    domainToggle.checked = false;
    domainToggle.dispatchEvent(new Event('change'));

    // Toggle domain switch (enable)
    domainToggle.checked = true;
    domainToggle.dispatchEvent(new Event('change'));

    // Switch to search tab
    const tabSearch = document.getElementById('tab-search') as HTMLButtonElement;
    tabSearch.click();
    expect(tabSearch.classList.contains('is-active')).toBe(true);

    // Search input typing
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    searchInput.value = 'test search';
    searchInput.dispatchEvent(new Event('input'));

    // Switch back to current tab
    const tabCurrent = document.getElementById('tab-current') as HTMLButtonElement;
    tabCurrent.click();
    expect(tabCurrent.classList.contains('is-active')).toBe(true);

    // Click links
    const openOptionsLink = document.getElementById('open-options-link') as HTMLAnchorElement;
    openOptionsLink.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    const openSidepanelLink = document.getElementById('open-sidepanel-link') as HTMLAnchorElement;
    openSidepanelLink.click();
    // Vault interactions
    const vaultBtn = document.getElementById('vault-btn') as HTMLButtonElement;

    // 1. Vault not configured -> opens options page
    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
      success: true,
      data: { hasMasterPassword: false, isUnlocked: false },
    });
    vaultBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    // 2. Vault configured and unlocked -> prompts to lock
    globalThis.confirm = vi.fn().mockReturnValue(true);
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'CHECK_VAULT_STATUS') {
        return { success: true, data: { hasMasterPassword: true, isUnlocked: true } };
      }
      return { success: true };
    });
    vaultBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(confirm).toHaveBeenCalled();

    // 3. Vault configured and locked -> prompts for password to unlock (failure case)
    globalThis.alert = vi.fn();
    globalThis.prompt = vi.fn().mockReturnValue('WrongPass');
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'CHECK_VAULT_STATUS') {
        return { success: true, data: { hasMasterPassword: true, isUnlocked: false } };
      }
      if (msg.type === 'UNLOCK_VAULT') {
        return { success: false };
      }
      return { success: true };
    });
    vaultBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(alert).toHaveBeenCalledWith('Incorrect Master Password.');

    // 4. Vault configured and locked -> success unlock
    globalThis.prompt = vi.fn().mockReturnValue('MasterPass123!');
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'CHECK_VAULT_STATUS') {
        return { success: true, data: { hasMasterPassword: true, isUnlocked: false } };
      }
      if (msg.type === 'UNLOCK_VAULT') {
        return { success: true };
      }
      return { success: true };
    });
    vaultBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    // Sidepanel open fallbacks
    delete (chrome as any).sidePanel;
    (chrome as any).sidebarAction = { open: vi.fn() };
    openSidepanelLink.click();
    expect((chrome as any).sidebarAction.open).toHaveBeenCalled();

    delete (chrome as any).sidebarAction;
    openSidepanelLink.click();
    expect(chrome.tabs.create).toHaveBeenCalled();
  });
});
