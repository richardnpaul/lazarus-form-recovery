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
  });

  describe('RecoveryButton', () => {
    it('creates, positions, activates, and handles clicks', () => {
      const btn = new RecoveryButton();
      const el = btn.getElement();
      expect(el).toBeInstanceOf(HTMLButtonElement);

      let clicked = false;
      btn.onClick(() => {
        clicked = true;
      });

      el.click();
      expect(clicked).toBe(true);

      btn.setActive(true);
      expect(el.classList.contains('is-active')).toBe(true);
      btn.setActive(false);
      expect(el.classList.contains('is-active')).toBe(false);

      // Attach to element
      const target = document.createElement('textarea');
      document.body.appendChild(target);
      btn.attachTo(target);
      expect(el.style.display).toBe('flex');

      // Window scroll event triggers updatePosition
      window.dispatchEvent(new Event('scroll'));

      // Disconnect target hides button
      target.remove();
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

      // Click footer actions
      let restoreAllFired = false;
      menu.onRestoreEntireForm(() => {
        restoreAllFired = true;
      });
      (container.querySelector('.lz-restore-all-btn') as HTMLButtonElement)?.click();
      expect(restoreAllFired).toBe(true);

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

      // Click document outside closes menu
      document.dispatchEvent(new MouseEvent('click'));

      // Test restoreEntireForm execution
      await (host as any).restoreEntireForm(input);
      expect(input.value).toBe('Restored John');
      expect(textarea.value).toBe('Restored Bio');
    });
  });
});
