import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecoveryButton } from '../../src/content/shadow-ui/recovery-button';
import { RecoveryMenu } from '../../src/content/shadow-ui/recovery-menu';
import { LivePreviewManager } from '../../src/content/shadow-ui/live-preview';
import { attachRecoveryUI, LazarusRecoveryHost } from '../../src/content/shadow-ui/shadow-host';

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
    });
  });

  describe('LazarusRecoveryHost & attachRecoveryUI', () => {
    it('creates recovery host, positions near element, opens menu, and restores form', async () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.id = 'comment_input';
      input.setAttribute('name', 'full_name');
      form.appendChild(input);

      const textarea = document.createElement('textarea');
      textarea.name = 'bio';
      form.appendChild(textarea);

      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.id = 'rich_notes';
      form.appendChild(ceDiv);

      document.body.appendChild(form);

      const host = attachRecoveryUI(input);
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
  });
});
