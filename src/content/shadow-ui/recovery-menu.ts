import { formatTimeAgo, computeWordCount, sanitizePreview } from '../../common/utils/text';
import { LivePreviewManager } from './live-preview';
import { RuntimeMessage } from '../../common/types/messages';

export class RecoveryMenu {
  private container: HTMLDivElement;
  private previewManager: LivePreviewManager;
  private currentItems: any[] = [];
  private filteredItems: any[] = [];
  private focusedIndex = -1;
  private currentTarget: HTMLElement | null = null;
  private onCommitCallback: ((val: string) => void) | null = null;
  private onDismissCallback: (() => void) | null = null;
  private onRestoreEntireFormCallback: (() => void) | null = null;

  constructor(previewManager: LivePreviewManager) {
    this.previewManager = previewManager;
    this.container = document.createElement('div');
    this.container.className = 'lz-menu-card';
    this.container.style.display = 'none';

    this.container.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  public getElement(): HTMLDivElement {
    return this.container;
  }

  public isOpen(): boolean {
    return this.container.style.display === 'flex';
  }

  public onCommit(fn: (val: string) => void) {
    this.onCommitCallback = fn;
  }

  public onDismiss(fn: () => void) {
    this.onDismissCallback = fn;
  }

  public onRestoreEntireForm(fn: () => void) {
    this.onRestoreEntireFormCallback = fn;
  }

  public show(target: HTMLElement, items: any[], buttonLeft: number, buttonTop: number) {
    this.currentTarget = target;
    this.currentItems = items;
    this.filteredItems = [...items];
    this.focusedIndex = -1;
    this.previewManager.setTarget(target);

    this.render();

    // Position menu card below or near the button
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const menuWidth = 320;
    let menuLeft = buttonLeft - menuWidth + 24;
    if (menuLeft < 10) menuLeft = 10;
    if (menuLeft + menuWidth > viewportWidth - 10) {
      menuLeft = viewportWidth - menuWidth - 10;
    }

    this.container.style.left = `${menuLeft}px`;
    this.container.style.top = `${buttonTop + 28}px`;
    this.container.style.display = 'flex';

    // Focus search input
    setTimeout(() => {
      const search = this.container.querySelector('.lz-search-input') as HTMLInputElement;
      search?.focus();
    }, 50);
  }

  public hide() {
    if (this.isOpen()) {
      this.previewManager.revert();
      this.container.style.display = 'none';
      if (this.onDismissCallback) {
        this.onDismissCallback();
      }
    }
  }

  private render() {
    this.container.innerHTML = `
      <div class="lz-menu-header">
        <div class="lz-menu-title">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span>Lazarus Recovery</span>
        </div>
        <span class="lz-item-counter">${this.filteredItems.length} drafts</span>
      </div>
      <div class="lz-search-box">
        <input type="search" class="lz-search-input" placeholder="Search field history..." />
      </div>
      <ul class="lz-snippet-list" role="listbox">
        <!-- Rendered by renderList -->
      </ul>
      <div class="lz-menu-footer">
        <button class="lz-restore-all-btn">Recover entire form</button>
        <div class="lz-footer-links">
          <button class="lz-icon-link lz-settings-btn" title="Extension Settings">⚙️</button>
          <button class="lz-icon-link lz-disable-btn" title="Disable on this domain">🚫</button>
        </div>
      </div>
    `;

    // Bind Search
    const searchInput = this.container.querySelector('.lz-search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      this.filteredItems = q
        ? this.currentItems.filter((item) => item.value.toLowerCase().includes(q))
        : [...this.currentItems];
      this.renderList();
    });

    // Bind Footer Actions
    this.container.querySelector('.lz-restore-all-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onRestoreEntireFormCallback) {
        this.onRestoreEntireFormCallback();
      }
      this.hide();
    });

    this.container.querySelector('.lz-settings-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'CHECK_VAULT_STATUS' });
      // Can't directly open options page from content script without message or openOptionsPage
      window.open(chrome.runtime.getURL('src/options/options.html'), '_blank');
      this.hide();
    });

    this.container.querySelector('.lz-disable-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Disable Lazarus on ${window.location.hostname}?`)) {
        const msg: RuntimeMessage = {
          type: 'DISABLE_DOMAIN',
          payload: { domain: window.location.hostname, wipeExisting: false },
        };
        chrome.runtime.sendMessage(msg);
        this.hide();
      }
    });

    this.renderList();
  }

  private renderList() {
    const list = this.container.querySelector('.lz-snippet-list') as HTMLUListElement;
    if (!list) return;

    list.innerHTML = '';

    if (this.filteredItems.length === 0) {
      list.innerHTML = `
        <div class="lz-empty-state">
          No saved drafts matching this search.<br>
          Drafts are automatically saved as you type!
        </div>
      `;
      return;
    }

    this.filteredItems.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `lz-snippet-item ${index === this.focusedIndex ? 'is-focused' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '0');

      const wordCount = computeWordCount(item.value);
      const previewText = sanitizePreview(item.value, 70);

      li.innerHTML = `
        <div class="lz-snippet-meta">
          <span>${formatTimeAgo(item.lastModified)}</span>
          <span class="lz-badge">${wordCount} words</span>
        </div>
        <p class="lz-snippet-preview">${escapeHtml(previewText || '(empty)')}</p>
      `;

      // Live Hover Preview
      li.addEventListener('mouseenter', () => {
        this.focusedIndex = index;
        this.updateFocusedItemClass();
        this.previewManager.preview(item.value);
      });

      li.addEventListener('mouseleave', () => {
        this.previewManager.revert();
      });

      // Commit on click
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        this.commitItem(item.value);
      });

      list.appendChild(li);
    });
  }

  private commitItem(value: string) {
    this.previewManager.commit(value);
    if (this.onCommitCallback) {
      this.onCommitCallback(value);
    }
    this.hide();
  }

  private updateFocusedItemClass() {
    const items = this.container.querySelectorAll('.lz-snippet-item');
    items.forEach((el, idx) => {
      if (idx === this.focusedIndex) {
        el.classList.add('is-focused');
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' });
        }
      } else {
        el.classList.remove('is-focused');
      }
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      this.currentTarget?.focus();
      return;
    }

    if (this.filteredItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.focusedIndex = (this.focusedIndex + 1) % this.filteredItems.length;
      this.updateFocusedItemClass();
      const current = this.filteredItems[this.focusedIndex];
      if (current) this.previewManager.preview(current.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.focusedIndex =
        (this.focusedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
      this.updateFocusedItemClass();
      const current = this.filteredItems[this.focusedIndex];
      if (current) this.previewManager.preview(current.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.focusedIndex >= 0 && this.focusedIndex < this.filteredItems.length) {
        this.commitItem(this.filteredItems[this.focusedIndex].value);
      } else if (this.filteredItems.length > 0) {
        this.commitItem(this.filteredItems[0].value);
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
