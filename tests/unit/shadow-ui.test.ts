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
    document.querySelectorAll('lazarus-recovery-host').forEach((el) => el.remove());
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

  it('registers lazarus-recovery-host custom element on module load', () => {
    expect(customElements.get('lazarus-recovery-host')).toBe(LazarusRecoveryHost);
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

      // Preview again to verify commit reverts preview outline style
      manager.preview('Previewed Before Commit');
      expect(input.style.outline).not.toBe('');

      // Commit
      let inputFired = false;
      input.addEventListener('input', () => {
        inputFired = true;
      });
      manager.commit('Committed Text');
      expect(input.value).toBe('Committed Text');
      expect(inputFired).toBe(true);
      expect(input.style.outline).toBe('');

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
      expect(input.style.backgroundColor).toBe('white');
      vi.useRealTimers();
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
      const formEl = document.createElement('form');
      const input = document.createElement('input');
      formEl.appendChild(input);
      document.body.appendChild(formEl);
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

    it('kills surviving mutants in LivePreviewManager, RecoveryButton, RecoveryMenu, and ShadowHost', async () => {
      // --- 1. LivePreviewManager ---
      const lp = new LivePreviewManager();
      const testInp = document.createElement('input');
      testInp.value = 'initial';
      testInp.style.backgroundColor = 'rgb(10, 20, 30)';
      testInp.style.outline = '1px solid rgb(40, 50, 60)';
      testInp.style.outlineOffset = '2px';
      document.body.appendChild(testInp);

      lp.setTarget(testInp);

      // Verify preview styles & priority via spy
      const setPropSpy = vi.spyOn(testInp.style, 'setProperty');
      lp.preview('preview_1');
      expect(testInp.value).toBe('preview_1');
      expect(setPropSpy).toHaveBeenCalledWith(
        'background-color',
        'var(--lz-preview-bg, #FFF9D2)',
        'important'
      );
      expect(setPropSpy).toHaveBeenCalledWith(
        'outline',
        '2px dashed var(--lz-preview-outline, #E5A500)',
        'important'
      );
      expect(setPropSpy).toHaveBeenCalledWith('outline-offset', '-1px', 'important');
      setPropSpy.mockRestore();

      // Double preview should preserve initial original value
      lp.preview('preview_2');
      expect(testInp.value).toBe('preview_2');
      lp.revert();
      expect(testInp.value).toBe('initial');
      expect(testInp.style.backgroundColor).toBe('rgb(10, 20, 30)');
      expect(testInp.style.outline).toBe('1px solid rgb(40, 50, 60)');
      expect(testInp.style.outlineOffset).toBe('2px');

      // Test plain input with empty outline reverts to empty string
      const plainInp = document.createElement('input');
      document.body.appendChild(plainInp);
      lp.setTarget(plainInp);
      lp.preview('preview_plain');
      lp.revert();
      expect(plainInp.style.outline).toBe('');
      expect(plainInp.style.outlineOffset).toBe('');

      // Commit event flags
      let inputEv: any = null;
      let changeEv: any = null;
      testInp.addEventListener('input', (e) => {
        inputEv = e;
      });
      testInp.addEventListener('change', (e) => {
        changeEv = e;
      });
      lp.setTarget(testInp);
      lp.commit('committed_val');
      expect(inputEv?.bubbles).toBe(true);
      expect(inputEv?.composed).toBe(true);
      expect(changeEv?.bubbles).toBe(true);

      // --- 2. RecoveryButton ---
      const rb = new RecoveryButton();
      const svg = rb.getElement().querySelector('svg')!;
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('width')).toBe('13');
      expect(svg.getAttribute('height')).toBe('13');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('2.2');
      expect(svg.getAttribute('stroke-linecap')).toBe('round');
      expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      const path = svg.querySelector('path')!;
      expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(path.getAttribute('d')).toContain('M12 2v4');

      // StopPropagation on click
      let parentClicked = false;
      const parentDiv = document.createElement('div');
      parentDiv.appendChild(rb.getElement());
      parentDiv.addEventListener('click', () => {
        parentClicked = true;
      });
      rb.getElement().click();
      expect(parentClicked).toBe(false);

      // ResizeObserver and scroll listener
      let roCb: any = null;
      const unobserveSpy = vi.fn();
      const observeSpy = vi.fn();
      const origRO = globalThis.ResizeObserver;
      (globalThis as any).ResizeObserver = class {
        constructor(cb: any) {
          roCb = cb;
        }
        observe = observeSpy;
        unobserve = unobserveSpy;
        disconnect = vi.fn();
      };
      const addSpy = vi.spyOn(window, 'addEventListener');
      const remSpy = vi.spyOn(window, 'removeEventListener');

      const rb2 = new RecoveryButton();
      const inpA = document.createElement('input');
      inpA.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ left: 300, top: 400, width: 50, height: 20, right: 350, bottom: 420 });
      document.body.appendChild(inpA);
      rb2.attachTo(inpA);

      expect(observeSpy).toHaveBeenCalledWith(inpA);
      expect(remSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true });
      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), {
        capture: true,
        passive: true,
      });
      expect(rb2.getElement().style.left).toContain('px');
      expect(rb2.getElement().style.top).toContain('px');

      // Trigger resize callback and verify position updates
      rb2.getElement().style.left = '0px';
      if (roCb) roCb([{ target: inpA }]);
      expect(rb2.getElement().style.left).not.toBe('0px');

      // Switch target
      const inpB = document.createElement('input');
      inpB.getBoundingClientRect = vi
        .fn()
        .mockReturnValue({ left: 100, top: 200, width: 50, height: 20, right: 150, bottom: 220 });
      document.body.appendChild(inpB);
      rb2.attachTo(inpB);
      expect(unobserveSpy).toHaveBeenCalledWith(inpA);
      expect(observeSpy).toHaveBeenCalledWith(inpB);

      rb2.hide();
      expect(unobserveSpy).toHaveBeenCalledWith(inpB);
      expect(unobserveSpy).toHaveBeenCalledTimes(2);
      expect(remSpy).toHaveBeenLastCalledWith('scroll', expect.any(Function), { capture: true });

      // Connected element keeps display flex on updatePosition
      rb2.attachTo(inpB);
      rb2.updatePosition();
      expect(rb2.getElement().style.display).toBe('flex');

      globalThis.ResizeObserver = origRO;
      addSpy.mockRestore();
      remSpy.mockRestore();

      // --- 3. RecoveryMenu ---
      const freshMenu = new RecoveryMenu(new LivePreviewManager());
      expect(freshMenu.getElement().className).toBe('lz-menu-card');
      expect(freshMenu.getElement().style.display).toBe('none');

      // Keydown before show() does nothing
      const pSpy = vi.spyOn(lp, 'preview');
      freshMenu.getElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(pSpy).not.toHaveBeenCalled();
      pSpy.mockRestore();

      // Dismiss callback
      let dCalled = false;
      freshMenu.onDismiss(() => {
        dCalled = true;
      });
      const menuTarget = document.createElement('input');
      document.body.appendChild(menuTarget);
      const items3 = [
        { value: 'Item Alpha', lastModified: Date.now() },
        { value: 'Item Beta', lastModified: Date.now() - 5000 },
        { value: 'Item Gamma', lastModified: Date.now() - 10000 },
      ];
      freshMenu.show(menuTarget, items3, 500, 100);
      freshMenu.hide();
      expect(dCalled).toBe(true);
      dCalled = false;
      freshMenu.hide();
      expect(dCalled).toBe(false);

      // Search input focus with timer
      vi.useFakeTimers();
      const rmTimers = new RecoveryMenu(new LivePreviewManager());
      rmTimers.show(menuTarget, items3, 500, 100);
      const sInp = rmTimers.getElement().querySelector('.lz-search-input') as HTMLInputElement;
      const fSpy = vi.spyOn(sInp, 'focus');
      vi.advanceTimersByTime(50);
      expect(fSpy).toHaveBeenCalled();
      vi.useRealTimers();

      // Unclamped positioning: buttonLeft = 500, buttonTop = 100
      // menuLeft = 500 - 320 + 24 = 204px; top = 100 + 28 = 128px
      const rm = new RecoveryMenu(new LivePreviewManager());
      rm.show(menuTarget, items3, 500, 100);
      expect(rm.getElement().style.left).toBe('204px');
      expect(rm.getElement().style.top).toBe('128px');

      const menuCard = rm.getElement();
      const renderedList = menuCard.querySelectorAll('.lz-snippet-item');
      expect(renderedList.length).toBe(3);

      // Check item metadata
      expect(renderedList[0].getAttribute('role')).toBe('option');
      expect(renderedList[0].getAttribute('tabindex')).toBe('0');
      expect(renderedList[0].querySelector('.lz-snippet-meta')?.children.length).toBe(2);
      expect(renderedList[0].querySelector('.lz-badge')?.textContent).toBe('2 words');

      // Keyboard navigation with 3 items & preventDefault
      Element.prototype.scrollIntoView = vi.fn();
      const kdDown = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
      menuCard.dispatchEvent(kdDown);
      expect(kdDown.defaultPrevented).toBe(true);
      expect(renderedList[0].classList.contains('is-focused')).toBe(true);
      expect(renderedList[1].classList.contains('is-focused')).toBe(false);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

      // ArrowDown -> index 1
      menuCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(renderedList[1].classList.contains('is-focused')).toBe(true);

      // ArrowUp from index 1 MUST go to index 0
      const kdUp = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
      menuCard.dispatchEvent(kdUp);
      expect(kdUp.defaultPrevented).toBe(true);
      expect(renderedList[0].classList.contains('is-focused')).toBe(true);
      expect(renderedList[1].classList.contains('is-focused')).toBe(false);

      // Enter on index 0 commits Item Alpha
      let committedText = '';
      rm.onCommit((val) => {
        committedText = val;
      });
      const kdEnter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      menuCard.dispatchEvent(kdEnter);
      expect(kdEnter.defaultPrevented).toBe(true);
      expect(committedText).toBe('Item Alpha');

      // Escape key preventDefault
      rm.show(menuTarget, items3, 500, 100);
      const kdEsc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      menuCard.dispatchEvent(kdEsc);
      expect(kdEsc.defaultPrevented).toBe(true);

      // Re-show, arrow down twice to index 1, Enter commits Item Beta
      rm.show(menuTarget, items3, 500, 100);
      menuCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      menuCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      menuCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(committedText).toBe('Item Beta');

      // Mouseenter updates focused item class
      rm.show(menuTarget, items3, 500, 100);
      const allItems = menuCard.querySelectorAll('.lz-snippet-item');
      allItems[1].dispatchEvent(new MouseEvent('mouseenter'));
      expect(allItems[1].classList.contains('is-focused')).toBe(true);

      // Click snippet item with parent stopPropagation
      let snippetParentClicked = false;
      menuCard.addEventListener('click', () => {
        snippetParentClicked = true;
      });
      (allItems[2] as HTMLElement).click();
      expect(committedText).toBe('Item Gamma');
      expect(snippetParentClicked).toBe(false);
      expect(rm.isOpen()).toBe(false);

      // Search with trailing whitespace (tests .trim())
      rm.show(menuTarget, items3, 500, 100);
      const searchEl = rm.getElement().querySelector('.lz-search-input') as HTMLInputElement;
      searchEl.value = 'Alpha   ';
      searchEl.dispatchEvent(new Event('input'));
      expect(rm.getElement().querySelectorAll('.lz-snippet-item').length).toBe(1);

      // Empty item preview text
      rm.show(menuTarget, [{ value: '', lastModified: Date.now() }], 500, 100);
      const previewP = menuCard.querySelector('.lz-snippet-preview');
      expect(previewP?.textContent).toBe('(empty)');

      // Empty state text & styles
      rm.show(menuTarget, [], 500, 100);
      expect(menuCard.textContent).toContain('No drafts found');
      expect(menuCard.textContent).toContain('Try typing to save one');
      const emptyContainer = menuCard.querySelector('.lz-empty-state')!;
      const l1 = emptyContainer.children[0] as HTMLElement;
      const l2 = emptyContainer.children[1] as HTMLElement;
      expect(l1.style.fontWeight).toBe('500');
      expect(l1.style.marginBottom).toBe('4px');
      expect(l2.style.fontSize).toBe('11px');
      expect(l2.style.opacity).toBe('0.8');

      // Footer buttons stopPropagation & actions
      let footerParentClicked = false;
      menuCard.addEventListener('click', () => {
        footerParentClicked = true;
      });

      // Restore button
      let restoreFormCalled = false;
      rm.onRestoreEntireForm(() => {
        restoreFormCalled = true;
      });
      const restoreBtn = menuCard.querySelector('.lz-restore-all-btn') as HTMLElement;
      restoreBtn.click();
      expect(restoreFormCalled).toBe(true);
      expect(footerParentClicked).toBe(false);
      expect(rm.isOpen()).toBe(false);

      // Settings button
      rm.show(menuTarget, items3, 500, 100);
      footerParentClicked = false;
      const settingsBtn = menuCard.querySelector('.lz-settings-btn') as HTMLElement;
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      settingsBtn?.click();
      expect(openSpy).toHaveBeenCalled();
      expect(footerParentClicked).toBe(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CHECK_VAULT_STATUS' });
      openSpy.mockRestore();

      // Disable button
      rm.show(menuTarget, items3, 500, 100);
      footerParentClicked = false;
      const disableBtn = menuCard.querySelector('.lz-disable-btn') as HTMLElement;
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      disableBtn?.click();
      expect(confirmSpy).toHaveBeenCalledWith(`Disable Lazarus on ${window.location.hostname}?`);
      expect(footerParentClicked).toBe(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'DISABLE_DOMAIN',
        payload: { domain: window.location.hostname, wipeExisting: false },
      });
      confirmSpy.mockRestore();

      // --- 4. ShadowHost ---
      const hostTarget = document.createElement('input');
      document.body.appendChild(hostTarget);
      const host = attachRecoveryUI(hostTarget)!;
      const hostShadow = (host as any).shadow as ShadowRoot;
      expect(hostShadow.querySelector('style')?.textContent).toBe('\n');
      expect(hostShadow.contains((host as any).button.getElement())).toBe(true);
      expect(hostShadow.contains((host as any).menu.getElement())).toBe(true);

      const hostBtnEl = (host as any).button.getElement();
      hostBtnEl.style.left = '400px';
      hostBtnEl.style.top = '100px';

      // Button click sets active and opens menu; second click closes menu
      (host as any).menu.hide();
      hostBtnEl.click();
      await new Promise((r) => setTimeout(r, 10));
      expect(hostBtnEl.classList.contains('is-active')).toBe(true);
      expect(host.getMenu().isOpen()).toBe(true);
      expect(host.getMenu().getElement().style.left).toBe('104px');
      expect(host.getMenu().getElement().style.top).toBe('128px');

      // Dismiss resets active
      (host as any).menu.hide();
      expect(hostBtnEl.classList.contains('is-active')).toBe(false);

      // Document click when menu is closed does not throw or trigger dismiss
      let dismissRan = false;
      (host as any).menu.onDismiss(() => {
        dismissRan = true;
      });
      dismissRan = false;
      document.dispatchEvent(new MouseEvent('click'));
      expect(dismissRan).toBe(false);

      // positionNear attaches to element
      const targetC = document.createElement('input');
      document.body.appendChild(targetC);
      host.positionNear(targetC);
      expect((host as any).currentTarget).toBe(targetC);

      // openMenuForTarget field names and fieldType casing
      const inpNameOnly = document.createElement('input');
      inpNameOnly.name = 'user_login';
      document.body.appendChild(inpNameOnly);
      await (host as any).openMenuForTarget(inpNameOnly);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GET_RECOVERABLE_TEXT',
          payload: expect.objectContaining({
            fieldName: 'user_login',
            fieldType: 'input',
          }),
        })
      );

      const inpIdOnly = document.createElement('input');
      inpIdOnly.id = 'user_id_field';
      document.body.appendChild(inpIdOnly);
      await (host as any).openMenuForTarget(inpIdOnly);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ fieldName: 'user_id_field' }),
        })
      );

      const inpNeither = document.createElement('input');
      document.body.appendChild(inpNeither);
      await (host as any).openMenuForTarget(inpNeither);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ fieldName: '' }),
        })
      );

      // When style.left and style.top are empty
      hostBtnEl.style.left = '';
      hostBtnEl.style.top = '';
      await (host as any).openMenuForTarget(inpNameOnly);
      expect(host.getMenu().getElement().style.left).not.toContain('NaN');
      expect(host.getMenu().getElement().style.top).not.toContain('NaN');

      // defineRecoveryHostElement when already defined
      const defSpy = vi.spyOn(globalThis.customElements, 'define');
      defineRecoveryHostElement();
      expect(defSpy).not.toHaveBeenCalled();
      defSpy.mockRestore();

      // attachRecoveryUI guards
      const validSpy = vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
      expect(attachRecoveryUI(inpNameOnly)).toBeNull();
      validSpy.mockRestore();

      // restoreEntireForm with rich text adapter and event flags
      const formEl = document.createElement('form');
      const richEditor = document.createElement('div');
      richEditor.className = 'ql-editor';
      richEditor.setAttribute('name', 'rich_field');
      formEl.appendChild(richEditor);
      document.body.appendChild(formEl);

      let rInputFired = false;
      let rChangeFired = false;
      richEditor.addEventListener('input', (e) => {
        expect(e.bubbles).toBe(true);
        expect(e.composed).toBe(true);
        rInputFired = true;
      });
      richEditor.addEventListener('change', (e) => {
        expect(e.bubbles).toBe(true);
        rChangeFired = true;
      });

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [
          {
            fields: [{ name: 'rich_field', value: 'Recovered rich content' }],
          },
        ],
      });
      await (host as any).restoreEntireForm(richEditor);
      expect(rInputFired).toBe(true);
      expect(rChangeFired).toBe(true);
      expect(richEditor.innerHTML).toBe('Recovered rich content');

      // onRestoreEntireForm callback restores form when currentTarget is set
      const formCallbackInp = document.createElement('input');
      formCallbackInp.name = 'callback_field';
      formEl.appendChild(formCallbackInp);
      host.positionNear(formCallbackInp);
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ fields: [{ name: 'callback_field', value: 'Restored via callback' }] }],
      });
      await (host.getMenu() as any).onRestoreEntireFormCallback?.();
      expect(formCallbackInp.value).toBe('Restored via callback');

      // Document click when menu is open vs closed
      const menuHideSpy = vi.spyOn(host.getMenu(), 'hide');
      document.dispatchEvent(new MouseEvent('click'));
      expect(menuHideSpy).not.toHaveBeenCalled();

      host.getMenu().show(formCallbackInp, [{ value: 'v1' }], 0, 0);
      expect(host.getMenu().isOpen()).toBe(true);
      document.dispatchEvent(new MouseEvent('click'));
      expect(menuHideSpy).toHaveBeenCalledTimes(1);
      menuHideSpy.mockRestore();

      // positionNear when menu is open vs closed
      const attachBtnSpy = vi.spyOn((host as any).button, 'attachTo');
      const hideOnPosSpy = vi.spyOn(host.getMenu(), 'hide');
      host.positionNear(formCallbackInp);
      expect(attachBtnSpy).toHaveBeenCalledWith(formCallbackInp);
      expect(hideOnPosSpy).not.toHaveBeenCalled();

      host.getMenu().show(formCallbackInp, [{ value: 'v1' }], 0, 0);
      host.positionNear(formCallbackInp);
      expect(hideOnPosSpy).toHaveBeenCalledTimes(1);
      attachBtnSpy.mockRestore();
      hideOnPosSpy.mockRestore();

      // safeSendMessage in openMenuForTarget
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: false,
        data: [{ value: 'bad' }],
      });
      await (host as any).openMenuForTarget(formCallbackInp);
      expect(host.getMenu().getElement().querySelectorAll('.lz-snippet-item').length).toBe(0);

      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('fail'));
      await (host as any).openMenuForTarget(formCallbackInp);
      expect(host.getMenu().getElement().querySelectorAll('.lz-snippet-item').length).toBe(0);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: 'not_array',
      });
      await (host as any).openMenuForTarget(formCallbackInp);
      expect(host.getMenu().getElement().querySelectorAll('.lz-snippet-item').length).toBe(0);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce(null);
      await (host as any).openMenuForTarget(formCallbackInp);
      expect(host.getMenu().getElement().querySelectorAll('.lz-snippet-item').length).toBe(0);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ value: 'good_item' }],
      });
      await (host as any).openMenuForTarget(formCallbackInp);
      expect(host.getMenu().getElement().querySelectorAll('.lz-snippet-item').length).toBe(1);

      // restoreEntireForm edge cases with error spy
      const errSpy = vi.spyOn(console, 'error');
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: [] });
      await (host as any).restoreEntireForm(formCallbackInp);
      expect(errSpy).not.toHaveBeenCalled();

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: false,
        data: [{ fields: [{ name: 'callback_field', value: 'x' }] }],
      });
      await (host as any).restoreEntireForm(formCallbackInp);
      expect(errSpy).not.toHaveBeenCalled();
      expect(formCallbackInp.value).toBe('Restored via callback');

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ fields: [{ name: 'non_existent_element_xyz', value: 'abc' }] }],
      });
      await (host as any).restoreEntireForm(formCallbackInp);
      expect(errSpy).not.toHaveBeenCalled();

      // restoreEntireForm when res is null
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce(null);
      await (host as any).restoreEntireForm(formCallbackInp);
      expect(errSpy).not.toHaveBeenCalled();

      // restoreEntireForm when fields is null and input with name "undefined" exists
      const undefinedInput = document.createElement('input');
      undefinedInput.setAttribute('name', 'undefined');
      undefinedInput.value = 'untouched_undefined';
      formEl.appendChild(undefinedInput);

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ fields: null }],
      });
      await (host as any).restoreEntireForm(formCallbackInp);
      expect(undefinedInput.value).toBe('untouched_undefined');
      expect(errSpy).not.toHaveBeenCalled();

      const plainDivElem = document.createElement('div');
      plainDivElem.setAttribute('name', 'plain_div_field');
      formEl.appendChild(plainDivElem);
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ fields: [{ name: 'plain_div_field', value: 'div_val' }] }],
      });
      await (host as any).restoreEntireForm(formCallbackInp);
      expect((plainDivElem as any).value).toBeUndefined();
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();

      // RecoveryMenu survivors
      const previewInp = document.createElement('input');
      previewInp.value = 'Original Inp';
      document.body.appendChild(previewInp);
      const testMenu = new RecoveryMenu(new LivePreviewManager());
      testMenu.show(previewInp, [{ value: 'Item 1' }, { value: 'Item 2' }], 100, 100);
      (testMenu as any).previewManager.preview('Previewed Inp');
      expect(previewInp.value).toBe('Previewed Inp');
      testMenu.hide();
      expect(previewInp.value).toBe('Original Inp');
      expect(testMenu.getElement().style.display).toBe('none');

      // Settings button click
      testMenu.show(previewInp, [{ value: 'Item 1' }], 100, 100);
      const winOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const settingsButton = testMenu.getElement().querySelector('.lz-settings-btn') as HTMLElement;
      settingsButton.click();
      expect(winOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('src/options/options.html'),
        '_blank'
      );
      expect(testMenu.isOpen()).toBe(false);
      winOpenSpy.mockRestore();

      // Disable button click
      testMenu.show(previewInp, [{ value: 'Item 1' }], 100, 100);
      const confirmDisableSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const disableButton = testMenu.getElement().querySelector('.lz-disable-btn') as HTMLElement;
      disableButton.click();
      expect(testMenu.isOpen()).toBe(false);
      confirmDisableSpy.mockRestore();

      // Filtered items class names with focusedIndex
      testMenu.show(previewInp, [{ value: 'Item 1' }, { value: 'Item 2' }], 100, 100);
      const snippetItems = testMenu.getElement().querySelectorAll('.lz-snippet-item');
      expect(snippetItems[0].className).toBe('lz-snippet-item');
      expect(snippetItems[1].className).toBe('lz-snippet-item');

      (testMenu as any).focusedIndex = 0;
      (testMenu as any).renderList();
      const updatedSnippets = testMenu.getElement().querySelectorAll('.lz-snippet-item');
      expect(updatedSnippets[0].className).toBe('lz-snippet-item is-focused');
      expect(updatedSnippets[1].className).toBe('lz-snippet-item');

      // Focus search input after timeout
      vi.useFakeTimers();
      testMenu.show(previewInp, [{ value: 'Item 1' }], 100, 100);
      const searchInput = testMenu
        .getElement()
        .querySelector('.lz-search-input') as HTMLInputElement;
      const searchFocusSpy = vi.spyOn(searchInput, 'focus');
      vi.advanceTimersByTime(50);
      expect(searchFocusSpy).toHaveBeenCalled();

      // Test when search input is missing from container during timeout
      testMenu.show(previewInp, [{ value: 'Item 1' }], 100, 100);
      testMenu.getElement().innerHTML = '';
      vi.advanceTimersByTime(50);
      vi.useRealTimers();

      // commitItem
      (testMenu as any).commitItem('Directly Committed');
      expect(previewInp.value).toBe('Directly Committed');

      // Escape and Tab keys do not commit
      testMenu.show(previewInp, [{ value: 'Item 1' }], 100, 100);
      previewInp.value = 'Before Escape';
      let commitFired = false;
      testMenu.onCommit(() => {
        commitFired = true;
      });
      (testMenu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }));
      expect(commitFired).toBe(false);
      expect(previewInp.value).toBe('Before Escape');

      (testMenu as any).handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(commitFired).toBe(false);
      expect(previewInp.value).toBe('Before Escape');
      expect(testMenu.isOpen()).toBe(false);
    });
  });
});
