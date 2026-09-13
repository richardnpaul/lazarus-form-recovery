import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecoveryButton } from '../../src/content/shadow-ui/recovery-button';
import { RecoveryMenu } from '../../src/content/shadow-ui/recovery-menu';
import { LivePreviewManager } from '../../src/content/shadow-ui/live-preview';
import {
  attachRecoveryUI,
  LazarusRecoveryHost,
  defineRecoveryHostElement,
} from '../../src/content/shadow-ui/shadow-host';
import * as runtimeUtils from '../../src/common/utils/runtime';

describe('Shadow UI Components (src/content/shadow-ui/)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      if (msg.type === 'GET_RECOVERABLE_TEXT') {
        return {
          success: true,
          data: [
            { value: 'Recovered Note 1', lastModified: Date.now() - 5000 },
            { value: 'Recovered Note 2', lastModified: Date.now() - 10000 },
          ],
        };
      }
      if (msg.type === 'GET_DOMAIN_HISTORY') {
        return {
          success: true,
          data: [
            {
              form: { id: 'f_latest' },
              fields: [
                { name: 'full_name', value: 'Restored John' },
                { name: 'bio', value: 'Restored Bio' },
              ],
            },
          ],
        };
      }
      return { success: true };
    });
  });

  describe('LivePreviewManager', () => {
    it('previews, reverts, and commits values on input and contenteditable targets', () => {
      const input = document.createElement('input');
      input.value = 'Initial Input';
      document.body.appendChild(input);

      const manager = new LivePreviewManager();
      manager.setTarget(input);

      // Preview
      manager.preview('Previewed Text');
      expect(input.value).toBe('Previewed Text');

      // Revert
      manager.revert();
      expect(input.value).toBe('Initial Input');

      // Commit
      let inputFired = false;
      input.addEventListener('input', () => {
        inputFired = true;
      });
      manager.commit('Committed Text');
      expect(input.value).toBe('Committed Text');
      expect(inputFired).toBe(true);

      // Revert when target is null does nothing
      manager.setTarget(null);
      manager.preview('noop');
      manager.revert();
      manager.commit('noop');
    });

    it('handles contenteditable elements and textContent fallbacks', () => {
      const div = document.createElement('div');
      div.textContent = 'Original Div Text';
      document.body.appendChild(div);

      const manager = new LivePreviewManager();
      manager.setTarget(div);

      manager.preview('New Div Text');
      expect(div.textContent).toBe('New Div Text');

      manager.revert();
      expect(div.textContent).toBe('Original Div Text');
    });

    it('automatically reverts preview when switching targets', () => {
      const el1 = document.createElement('input');
      el1.value = 'Original 1';
      const el2 = document.createElement('input');
      el2.value = 'Original 2';
      document.body.appendChild(el1);
      document.body.appendChild(el2);

      const manager = new LivePreviewManager();
      manager.setTarget(el1);
      manager.preview('Previewed 1');
      expect(el1.value).toBe('Previewed 1');

      // Setting new target should revert el1 to Original 1
      manager.setTarget(el2);
      expect(el1.value).toBe('Original 1');
    });

    it('previews and applies values via rich text adapters', () => {
      const ce = document.createElement('div');
      ce.setAttribute('contenteditable', 'true');
      ce.innerHTML = '<p>Initial Rich</p>';
      document.body.appendChild(ce);

      const manager = new LivePreviewManager();
      manager.setTarget(ce);
      manager.preview('<p>Previewed Rich</p>');
      expect(ce.innerHTML).toBe('<p>Previewed Rich</p>');

      manager.revert();
      expect(ce.innerHTML).toBe('<p>Initial Rich</p>');

      manager.preview('<p>Previewed Rich 2</p>');
      manager.commit('<p>Committed Rich</p>');
      expect(ce.innerHTML).toBe('<p>Committed Rich</p>');
    });

    it('handles empty textContent element correctly', () => {
      const span = document.createElement('span');
      document.body.appendChild(span);

      const manager = new LivePreviewManager();
      manager.setTarget(span);
      manager.preview('Span Preview');
      expect(span.textContent).toBe('Span Preview');
      manager.revert();
      expect(span.textContent).toBe('');
    });

    it('executes flashConfirmation background restoration after 150ms timeout', () => {
      vi.useFakeTimers();
      const input = document.createElement('input');
      input.value = 'Flash Test';
      input.style.backgroundColor = 'white';
      document.body.appendChild(input);

      const manager = new LivePreviewManager();
      manager.setTarget(input);
      manager.commit('New Val');
      expect(input.style.backgroundColor).toBe('rgba(33, 196, 93, 0.2)');

      vi.advanceTimersByTime(150);
      expect(input.style.backgroundColor).toBe('');
      vi.useRealTimers();
    });

    it('handles styling and value helpers when target is null', () => {
      const manager = new LivePreviewManager();
      (manager as any).stashOriginal();
      (manager as any).applyValue('test');
      (manager as any).applyPreviewStyles();
      (manager as any).revertStyles();
      (manager as any).flashConfirmation();
    });
  });

  describe('RecoveryButton', () => {
    it('creates, positions, activates, and handles clicks', () => {
      const btn = new RecoveryButton();
      const el = btn.getElement();
      expect(el).toBeInstanceOf(HTMLButtonElement);
      expect(el.getAttribute('aria-label')).toBe('Lazarus Form Recovery');
      expect(el.getAttribute('title')).toBe('Recover form drafts (Lazarus)');
      expect(el.classList.contains('lz-trigger-btn')).toBe(true);

      let clicked = false;
      btn.onClick(() => {
        clicked = true;
      });

      // Verify stopPropagation: document click listener should not receive event
      let docClicked = false;
      const docListener = () => {
        docClicked = true;
      };
      document.addEventListener('click', docListener);
      el.click();
      document.removeEventListener('click', docListener);

      expect(clicked).toBe(true);
      expect(docClicked).toBe(false);

      btn.setActive(true);
      expect(el.classList.contains('is-active')).toBe(true);
      btn.setActive(false);
      expect(el.classList.contains('is-active')).toBe(false);

      // Attach to element
      const target = document.createElement('textarea');
      target.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 100,
        top: 200,
        width: 300,
        height: 80,
        right: 400,
        bottom: 280,
      });
      document.body.appendChild(target);
      btn.attachTo(target);
      expect(el.style.display).toBe('flex');
      expect(el.style.left).toBeDefined();
      expect(el.style.top).toBeDefined();

      // Switch to another target
      const target2 = document.createElement('input');
      target2.getBoundingClientRect = vi.fn().mockReturnValue({
        left: 50,
        top: 60,
        width: 150,
        height: 30,
        right: 200,
        bottom: 90,
      });
      document.body.appendChild(target2);
      btn.attachTo(target2);
      expect(el.style.display).toBe('flex');

      // Window scroll event triggers updatePosition
      window.dispatchEvent(new Event('scroll'));

      // Disconnect target hides button
      target2.remove();
      btn.updatePosition();
      expect(el.style.display).toBe('none');

      btn.hide();
      expect(el.style.display).toBe('none');
    });
  });

  describe('RecoveryMenu', () => {
    it('renders empty states, filters items, and handles clicks & keyboards', () => {
      const previewManager = new LivePreviewManager();
      const menu = new RecoveryMenu(previewManager);
      const container = menu.getElement();

      const target = document.createElement('input');
      target.value = 'current';
      document.body.appendChild(target);

      const items = [
        { value: 'First draft note', lastModified: Date.now() - 10000 },
        { value: 'Second draft note', lastModified: Date.now() - 60000 },
      ];

      menu.show(target, items, 100, 100);
      expect(menu.isOpen()).toBe(true);

      // Check item rendering
      const renderedItems = container.querySelectorAll('.lz-snippet-item');
      expect(renderedItems.length).toBe(2);

      // Hover preview and mouseleave revert
      Element.prototype.scrollIntoView = vi.fn();
      renderedItems[0].dispatchEvent(new MouseEvent('mouseenter'));
      expect(target.value).toBe('First draft note');
      renderedItems[0].dispatchEvent(new MouseEvent('mouseleave'));
      expect(target.value).toBe('current');

      // Keyboard navigation: from index 0 -> ArrowDown to index 1 -> ArrowUp to index 0
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(target.value).toBe('Second draft note');
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(target.value).toBe('First draft note');

      let committedVal = '';
      menu.onCommit((val) => {
        committedVal = val;
      });
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(committedVal).toBe('First draft note');

      // Test Escape
      menu.show(target, items, 100, 100);
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(menu.isOpen()).toBe(false);

      // Test Search filtering
      menu.show(target, items, 100, 100);
      const searchInput = container.querySelector('.lz-search-input') as HTMLInputElement;
      searchInput.value = 'Second';
      searchInput.dispatchEvent(new Event('input'));
      const filtered = container.querySelectorAll('.lz-snippet-item');
      expect(filtered.length).toBe(1);

      // Search with no results
      searchInput.value = 'Nonexistent string';
      searchInput.dispatchEvent(new Event('input'));
      expect(container.querySelector('.lz-empty-state')).not.toBeNull();

      // Keydown on empty filtered items
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      // Reset search
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));

      // Click item directly to commit
      const itemEl = container.querySelector('.lz-snippet-item') as HTMLElement;
      itemEl.scrollIntoView = vi.fn();
      itemEl.click();
      expect(committedVal).toBe('First draft note');

      // Test Enter with focusedIndex = -1 commits item 0
      menu.show(target, items, 100, 100);
      let defaultCommitted = '';
      menu.onCommit((v) => {
        defaultCommitted = v;
      });
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(defaultCommitted).toBe('First draft note');

      // Click footer actions: restore entire form
      let restoreAllFired = false;
      menu.onRestoreEntireForm(() => {
        restoreAllFired = true;
      });
      (container.querySelector('.lz-restore-all-btn') as HTMLButtonElement)?.dispatchEvent(
        new Event('click')
      );
      expect(restoreAllFired).toBe(true);

      // Settings button
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      (container.querySelector('.lz-settings-btn') as HTMLButtonElement)?.dispatchEvent(
        new Event('click')
      );
      expect(openSpy).toHaveBeenCalled();
      openSpy.mockRestore();

      // Disable domain button: confirmed
      globalThis.confirm = vi.fn().mockReturnValue(true);
      (container.querySelector('.lz-disable-btn') as HTMLButtonElement)?.dispatchEvent(
        new Event('click')
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'DISABLE_DOMAIN',
        payload: { domain: window.location.hostname, wipeExisting: false },
      });

      // Disable domain button: cancelled
      (chrome.runtime.sendMessage as any).mockClear();
      globalThis.confirm = vi.fn().mockReturnValue(false);
      (container.querySelector('.lz-disable-btn') as HTMLButtonElement)?.dispatchEvent(
        new Event('click')
      );
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

      // Positioning clamps: left < 10 and right edge overflow
      menu.show(target, items, 20, 100);
      expect(container.style.left).toBe('10px');

      menu.show(target, items, 5000, 100);
      const expectedRightClamp =
        (window.innerWidth || document.documentElement.clientWidth) - 320 - 10;
      expect(container.style.left).toBe(`${expectedRightClamp}px`);

      menu.hide();
      expect(menu.isOpen()).toBe(false);
    });

    it('handles renderList when snippet list element is missing', () => {
      const menu = new RecoveryMenu(new LivePreviewManager());
      const list = menu.getElement().querySelector('.lz-snippet-list');
      list?.remove();
      (menu as any).renderList();
    });
  });

  describe('LazarusRecoveryHost & attachRecoveryUI', () => {
    it('creates and attaches host element, positions near target, and handles button clicks', async () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'full_name';
      input.id = 'full_name_id';
      const textarea = document.createElement('textarea');
      textarea.name = 'bio';
      form.appendChild(input);
      form.appendChild(textarea);

      document.body.appendChild(form);

      const host = attachRecoveryUI(input)!;
      expect(host).toBeInstanceOf(LazarusRecoveryHost);

      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.id = 'rich_notes';
      form.appendChild(ceDiv);

      expect(host).toBeInstanceOf(LazarusRecoveryHost);

      // Second call returns existing host
      const host2 = attachRecoveryUI(input);
      expect(host2).toBe(host);

      // Click trigger button inside shadow root
      const triggerBtn = (host as any).button.getElement();
      await triggerBtn.click();

      // Click again toggles closed
      await triggerBtn.click();

      // Click open again
      await triggerBtn.click();

      // Reposition while menu is open closes it
      host.positionNear(textarea);
      expect((host as any).menu.isOpen()).toBe(false);

      // Open for element with no name or id
      const anonInput = document.createElement('input');
      document.body.appendChild(anonInput);
      host.positionNear(anonInput);
      await (host as any).openMenuForTarget(anonInput);

      // Open when GET_RECOVERABLE_TEXT fails
      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('NetworkFail'));
      await (host as any).openMenuForTarget(anonInput);

      // Click document outside closes menu
      await (host as any).openMenuForTarget(input);
      document.dispatchEvent(new MouseEvent('click'));
      expect((host as any).menu.isOpen()).toBe(false);

      // Test restoreEntireForm execution with standard input and rich-text input
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [
          {
            fields: [
              { name: 'full_name', value: 'Restored John' },
              { name: 'bio', value: 'Restored Bio' },
              { name: 'rich_notes', value: '<p>Restored HTML</p>' },
            ],
          },
        ],
      });
      await (host as any).restoreEntireForm(input);
      expect(input.value).toBe('Restored John');
      expect(textarea.value).toBe('Restored Bio');

      // Test restoreEntireForm when element is not inside a form
      const standalone = document.createElement('input');
      document.body.appendChild(standalone);
      await (host as any).restoreEntireForm(standalone);

      // Test restoreEntireForm when sendMessage throws error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('DBFail'));
      await (host as any).restoreEntireForm(input);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to restore entire form:', expect.any(Error));
      consoleSpy.mockRestore();

      // Test host onRestoreEntireForm callback with currentTarget set and null
      (host as any).currentTarget = input;
      const hostMenu = (host as any).menu;
      await (hostMenu as any).onRestoreEntireFormCallback?.();

      (host as any).currentTarget = null;
      await (hostMenu as any).onRestoreEntireFormCallback?.();
    });

    it('toggles menu closed when clicking trigger button while menu is open', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const host = attachRecoveryUI(input)!;
      await (host as any).openMenuForTarget(input);
      expect((host as any).menu.isOpen()).toBe(true);

      const triggerBtn = (host as any).button.getElement();
      await triggerBtn.click();
      expect((host as any).menu.isOpen()).toBe(false);
    });

    it('returns null in attachRecoveryUI when customElements is unavailable or documentElement is missing', () => {
      const input = document.createElement('input');
      const origCE = (window as any).customElements;

      Object.defineProperty(window, 'customElements', { value: null, configurable: true });
      expect(attachRecoveryUI(input)).toBeNull();

      Object.defineProperty(window, 'customElements', {
        value: { get: undefined },
        configurable: true,
      });
      expect(attachRecoveryUI(input)).toBeNull();

      Object.defineProperty(window, 'customElements', { value: origCE, configurable: true });
    });

    it('catches and logs error when attachRecoveryUI fails to append host', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      document.documentElement
        .querySelectorAll('lazarus-recovery-host')
        .forEach((el) => el.remove());

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const appendSpy = vi.spyOn(document.documentElement, 'appendChild').mockImplementation(() => {
        throw new Error('AppendError');
      });

      expect(attachRecoveryUI(input)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Failed to attach recovery UI:', expect.any(Error));

      appendSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('defines customElement if not already defined when attaching recovery UI', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      document.documentElement
        .querySelectorAll('lazarus-recovery-host')
        .forEach((el) => el.remove());

      const defineSpy = vi.spyOn(customElements, 'define').mockImplementation(() => {});
      const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);

      const host = attachRecoveryUI(input);
      expect(defineSpy).toHaveBeenCalledWith('lazarus-recovery-host', expect.any(Function));
      expect(host).not.toBeNull();

      defineSpy.mockRestore();
      getSpy.mockRestore();
    });
  });

  describe('Comprehensive Shadow UI Branch Coverage', () => {
    it('covers RecoveryButton click without handler and missing ResizeObserver', () => {
      const origRO = globalThis.ResizeObserver;
      try {
        delete (globalThis as any).ResizeObserver;
        const btn = new RecoveryButton();
        // Line 36: click when onClickHandler is null
        btn.getElement().click();

        // Line 71: attachTo when resizeObserver is null
        const input = document.createElement('input');
        document.body.appendChild(input);
        btn.attachTo(input);
      } finally {
        globalThis.ResizeObserver = origRO;
      }
    });

    it('covers RecoveryMenu window.innerWidth=0, empty previewText, and footer callbacks null', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const menu = new RecoveryMenu(new LivePreviewManager());
      const origWidth = window.innerWidth;
      try {
        Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
        Object.defineProperty(document.documentElement, 'clientWidth', {
          value: 1024,
          configurable: true,
        });

        // Line 57: viewportWidth fallback, Line 219: empty previewText
        menu.show(input, [{ value: '   ', lastModified: 0 }], 100, 100);
      } finally {
        Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
      }

      // Line 200: index === focusedIndex during renderList
      (menu as any).focusedIndex = 0;
      (menu as any).renderList();
      const itemEl = menu.getElement().querySelector('.lz-snippet-item');
      expect(itemEl?.classList.contains('is-focused')).toBe(true);

      // Line 258: scrollIntoView missing or not a function
      const firstItem = menu.getElement().querySelector('.lz-snippet-item') as any;
      if (firstItem) {
        firstItem.scrollIntoView = undefined;
        (menu as any).updateFocusedItemClass();
      }

      // Line 143: click restore-all button when onRestoreEntireFormCallback is null
      (menu as any).onRestoreEntireFormCallback = null;
      const restoreAllBtn = menu.getElement().querySelector('.lz-restore-all-btn') as HTMLElement;
      restoreAllBtn?.click();

      // Line 154: click settings button when safeGetURL returns empty string
      const urlSpy = vi.spyOn(runtimeUtils, 'safeGetURL').mockReturnValue('');
      const settingsBtn = menu.getElement().querySelector('.lz-settings-btn') as HTMLElement;
      settingsBtn?.click();
      urlSpy.mockRestore();

      // Line 247: commitItem without onCommitCallback
      (menu as any).onCommitCallback = null;
      (menu as any).commitItem('val');
    });

    it('covers RecoveryMenu handleKeyDown keys and fallback enter', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const menu = new RecoveryMenu(new LivePreviewManager());
      menu.show(
        input,
        [
          { value: 'item1', lastModified: 0 },
          { value: 'item2', lastModified: 0 },
        ],
        100,
        100
      );

      // Line 290: key !== ArrowDown, ArrowUp, Enter
      (menu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }));

      // Line 282, 289: ArrowDown and ArrowUp
      (menu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      (menu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      // Line 294: Enter when focusedIndex is -1 (takes else if filteredItems.length > 0)
      (menu as any).focusedIndex = -1;
      (menu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    it('covers LazarusRecoveryHost click outside when menu is closed and button click with null currentTarget', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const host = attachRecoveryUI(input)!;

      // Line 40: button click when menu is closed and currentTarget is null
      (host as any).menu.hide();
      (host as any).currentTarget = null;
      const btn = (host as any).button.getElement();
      await btn.click();

      // Line 58: document click when menu is closed
      expect((host as any).menu.isOpen()).toBe(false);
      document.body.click();
      expect((host as any).menu.isOpen()).toBe(false);

      // Lines 77, 79: openMenuForTarget with rich text adapter (ql-editor)
      const quill = document.createElement('div');
      quill.className = 'ql-editor';
      quill.id = 'ql_host';
      document.body.appendChild(quill);
      await (host as any).openMenuForTarget(quill);

      // Line 93: openMenuForTarget when response is unsuccessful
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await (host as any).openMenuForTarget(input);

      // Lines 101, 102: btnLeft and btnTop when style.left and style.top are empty
      (host as any).button.getElement().style.left = '';
      (host as any).button.getElement().style.top = '';
      await (host as any).openMenuForTarget(input);

      // Line 119: restoreEntireForm when res.success is false or data is empty
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await (host as any).restoreEntireForm(input);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: [] });
      await (host as any).restoreEntireForm(input);

      // Line 121: restoreEntireForm when latestForm.fields is null
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ form: { id: 'f1' }, fields: null }],
      });
      await (host as any).restoreEntireForm(input);

      // Line 128, 132: restoreEntireForm when field input not found, or input is a div (not 'value' in input)
      const form = document.createElement('form');
      const divField = document.createElement('div');
      divField.setAttribute('name', 'div_field');
      form.appendChild(divField);
      document.body.appendChild(form);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [
          {
            form: { id: 'f2' },
            fields: [
              { name: 'missing_field', value: '1' },
              { name: 'div_field', value: '2' },
            ],
          },
        ],
      });
      await (host as any).restoreEntireForm(divField);
    });

    it('covers defineRecoveryHostElement when already defined, missing customElements, or error thrown', () => {
      // 1. When already defined (!customElements.get is false)
      defineRecoveryHostElement();

      // 2. When customElements is undefined
      const origCE = (globalThis as any).customElements;
      try {
        delete (globalThis as any).customElements;
        defineRecoveryHostElement();
      } finally {
        (globalThis as any).customElements = origCE;
      }

      // 3. When customElements.define throws
      const defineSpy = vi.spyOn(customElements, 'define').mockImplementation(() => {
        throw new Error('AlreadyRegistered');
      });
      const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
      defineRecoveryHostElement();
      defineSpy.mockRestore();
      getSpy.mockRestore();
    });
  });
});
