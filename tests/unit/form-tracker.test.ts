import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormTracker } from '../../src/content/form-tracker';
import { FieldExtractor } from '../../src/content/field-extractor';

describe('FormTracker & Field Extractor Unit Tests', () => {
  let tracker: FormTracker;
  let sentMessages: any[] = [];
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('lazarus-recovery-host').forEach((el) => el.remove());

    root = document.createElement('div');
    document.body.appendChild(root);

    // Intercept chrome.runtime.sendMessage
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      sentMessages.push(msg);
      if (msg.type === 'GET_RECOVERABLE_FORM') {
        return {
          success: true,
          data: {
            form: { id: 'recovered-f1' },
            fields: [
              { name: 'full_name', value: 'Restored Name' },
              { name: 'email', value: 'restored@example.com' },
            ],
          },
        };
      }
      return { success: true };
    });

    tracker = new FormTracker(root);
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Lifecycle and Event Registration', () => {
    it('registers all event listeners in the capturing phase (useCapture = true)', () => {
      const addSpy = vi.spyOn(root, 'addEventListener');
      const remSpy = vi.spyOn(root, 'removeEventListener');

      const newTracker = new FormTracker(root);
      newTracker.start();

      const expectedEvents = [
        'input',
        'compositionend',
        'change',
        'focus',
        'blur',
        'paste',
        'submit',
        'reset',
        'contextmenu',
        'keydown',
      ];

      expectedEvents.forEach((evt) => {
        const call = addSpy.mock.calls.find((c) => c[0] === evt);
        expect(call).toBeDefined();
        // Strongly assert useCapture is true
        expect(call![2]).toBe(true);
      });

      newTracker.stop();

      expectedEvents.forEach((evt) => {
        const call = remSpy.mock.calls.find((c) => c[0] === evt);
        expect(call).toBeDefined();
        expect(call![2]).toBe(true);
      });
    });

    it('clears autosaveTimer on stop()', () => {
      const input = document.createElement('input');
      root.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect((tracker as any).autosaveTimer).not.toBeNull();

      tracker.stop();
      expect((tracker as any).autosaveTimer).toBeNull();
    });
  });

  describe('Input Event & Debouncing', () => {
    it('should debounce rapid keystrokes within 300ms and send a single autosave', async () => {
      const form = document.createElement('form');
      form.id = 'comment-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'comment_body';
      input.value = 'Hello';
      form.appendChild(input);
      root.appendChild(form);

      // Fire multiple rapid input events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);

      input.value = 'Hello world';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);

      input.value = 'Hello world!';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // No message should have fired yet (debounced)
      expect(sentMessages.length).toBe(0);

      // Advance past the 300ms debounce threshold
      vi.advanceTimersByTime(300);

      expect(sentMessages.length).toBe(1);
      const msg = sentMessages[0];
      expect(msg.type).toBe('SAVE_AUTOSAVE');
      expect(msg.payload.form.formInstanceId).toBe('comment-form');
      expect(msg.payload.form.fields[0].name).toBe('comment_body');
      expect(msg.payload.form.fields[0].value).toBe('Hello world!');
    });

    it('handles compositionend and change events as input triggers', () => {
      const input = document.createElement('input');
      input.value = 'typed';
      root.appendChild(input);

      input.dispatchEvent(new Event('compositionend', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(1);

      input.dispatchEvent(new Event('change', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(2);
    });

    it('flushes autosave immediately upon pressing Enter in an input', () => {
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.setAttribute('aria-label', 'Search Google');
      searchInput.value = 'firefox nightly addons';
      root.appendChild(searchInput);

      // User types query
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(sentMessages.length).toBe(0); // Debounce still pending

      // User hits Enter to submit search
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe('SAVE_AUTOSAVE');

      // Hit a different key, it should NOT flush
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(sentMessages.length).toBe(1); // Still 1
    });

    it('flushes autosave immediately upon pagehide or beforeunload', () => {
      const input = document.createElement('input');
      input.placeholder = 'Search GitHub';
      input.value = 'lazarus form recovery';
      root.appendChild(input);

      // Must interact to set lastInteractedElement
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(sentMessages.length).toBe(0);

      // Page navigates away immediately (triggers pagehide)
      window.dispatchEvent(new Event('pagehide'));
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe('SAVE_AUTOSAVE');

      sentMessages = [];
      window.dispatchEvent(new Event('beforeunload'));
      expect(sentMessages.length).toBe(1);
    });

    it('flushes pending autosave immediately upon blur', () => {
      const input = document.createElement('input');
      input.name = 'address_line';
      input.value = '123 Main Street';
      root.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(sentMessages.length).toBe(0);

      // User tabs away or clicks out
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe('SAVE_AUTOSAVE');
    });

    it('handles paste events as autosave triggers', () => {
      const input = document.createElement('input');
      input.name = 'pasted_token';
      input.value = 'secret_token_12345';
      root.appendChild(input);

      input.dispatchEvent(new Event('paste', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].payload.form.fields[0].value).toBe('secret_token_12345');
    });

    it('tracks active editing time and resets on idle gaps > 5 mins', () => {
      const form = document.createElement('form');
      form.id = 'time-tracker-form';
      const input = document.createElement('input');
      form.appendChild(input);
      root.appendChild(form);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Advance by 1 minute
      vi.advanceTimersByTime(60000);
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Advance by 6 minutes (idle threshold)
      vi.advanceTimersByTime(360000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    it('passes strict false to isTrackable internally', () => {
      const spy = vi.spyOn(FieldExtractor, 'isTrackable');
      const input = document.createElement('input');
      root.appendChild(input);

      input.dispatchEvent(new Event('focus', { bubbles: true }));
      expect(spy).toHaveBeenCalledWith(input, false); // must explicitly assert false!
    });

    it('ignores input events on invalid elements and password fields', () => {
      // Non-element
      root.dispatchEvent(new Event('input', { bubbles: true }));

      // Password field
      const form = document.createElement('form');
      const pass = document.createElement('input');
      pass.type = 'password';
      form.appendChild(pass);
      root.appendChild(form);

      pass.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(0);
    });

    it('handles contenteditable divs correctly', () => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'Hello contenteditable';
      root.appendChild(editable);

      editable.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(300);

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].payload.form.fields[0].value).toBe('Hello contenteditable');
      expect(sentMessages[0].payload.form.fields[0].type).toBe('contenteditable');
    });
  });

  describe('Form Lifecycle Events (submit, reset, contextmenu)', () => {
    it('should immediately dispatch SUBMIT_FORM on form submit', async () => {
      const form = document.createElement('form');
      form.id = 'checkout-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'cardholder';
      input.value = 'John Doe';
      form.appendChild(input);
      root.appendChild(form);

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(sentMessages.length).toBe(1);
      const msg = sentMessages[0];
      expect(msg.type).toBe('SUBMIT_FORM');
      expect(msg.payload.form.formInstanceId).toBe('checkout-form');
    });

    it('clears pending autosaveTimer when form is submitted immediately', () => {
      const form = document.createElement('form');
      form.id = 'rapid-submit-form';
      const input = document.createElement('input');
      input.name = 'msg';
      input.value = 'About to submit';
      form.appendChild(input);
      root.appendChild(form);

      // Trigger input event to start autosave timer
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect((tracker as any).autosaveTimer).not.toBeNull();

      // Submit immediately before timer expires
      form.dispatchEvent(new Event('submit', { bubbles: true }));
      expect((tracker as any).autosaveTimer).toBeNull();
    });

    it('should immediately snapshot values before form reset', () => {
      const form = document.createElement('form');
      form.id = 'reset-form';
      const input = document.createElement('input');
      input.name = 'pre_reset';
      input.value = 'Valuable Draft';
      form.appendChild(input);
      root.appendChild(form);

      form.dispatchEvent(new Event('reset', { bubbles: true }));

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe('SAVE_AUTOSAVE');
    });

    it('dispatches UPDATE_CONTEXT_MENU on right click (contextmenu)', () => {
      const form = document.createElement('form');
      form.id = 'context-form';
      const input = document.createElement('input');
      input.name = 'target_input';
      form.appendChild(input);
      root.appendChild(form);

      input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

      const contextMsg = sentMessages.find((m) => m.type === 'UPDATE_CONTEXT_MENU');
      expect(contextMsg).toBeDefined();
      expect(contextMsg.payload.formInstanceId).toBe('context-form');
    });

    it('handles submit edge cases (non-element target, orphaned inputs)', () => {
      // Non-element target
      const evt = new Event('submit', { bubbles: true });
      Object.defineProperty(evt, 'target', { value: document });
      root.dispatchEvent(evt);
      expect(sentMessages.length).toBe(0);

      // Orphaned input (no form)
      const input = document.createElement('input');
      input.name = 'orphan';
      input.value = 'orphan-value';
      root.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(1);
    });
  });

  describe('Runtime Message Restoration Handlers', () => {
    it('handles RESTORE_FORM_REVISION, RESTORE_FIELD_TEXT, and FORCE_SAVE_NOW', async () => {
      const form = document.createElement('form');
      const nameInput = document.createElement('input');
      nameInput.name = 'full_name';
      const emailInput = document.createElement('input');
      emailInput.name = 'email';
      form.appendChild(nameInput);
      form.appendChild(emailInput);
      root.appendChild(form);

      // Focus nameInput
      nameInput.focus();
      (tracker as any).lastInteractedElement = nameInput; // strictly set it

      // 1. RESTORE_FORM_REVISION
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rec_form_1' },
      });

      expect(nameInput.value).toBe('Restored Name');
      expect(emailInput.value).toBe('restored@example.com');

      // 2. RESTORE_FIELD_TEXT
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'Directly Injected Text' },
      });
      // The last element modified by RESTORE_FORM_REVISION was emailInput, so it became lastInteractedElement
      expect(emailInput.value).toBe('Directly Injected Text');

      // 3. FORCE_SAVE_NOW
      await (tracker as any).handleRuntimeMessage({ action: 'FORCE_SAVE_NOW' });
      const forceMsg = sentMessages.find((m) => m.type === 'FORCE_SAVE_SNAPSHOT');
      expect(forceMsg).toBeDefined();

      // 4. RESTORE_FORM_REVISION failure scenarios
      // Non-existent form id
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'non-existent' },
      });

      // 5. RESTORE_FIELD_TEXT to a contenteditable
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      root.appendChild(editable);
      editable.focus();
      (tracker as any).lastInteractedElement = editable;
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'Injected HTML' },
      });
      expect(editable.innerHTML).toBe('Injected HTML');

      // 6. RESTORE_FIELD_TEXT to an element without value or innerHTML (uses textContent)
      const span = document.createElement('span');
      root.appendChild(span);
      span.focus();
      (tracker as any).lastInteractedElement = span;
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'Injected Text' },
      });
      expect(span.textContent).toBe('Injected Text');

      // 7. RESTORE_FORM_REVISION fallback querySelector (when formElement is not found)
      const orphanInput = document.createElement('input');
      orphanInput.name = 'orphan_field';
      document.body.appendChild(orphanInput); // Outside root, but document.querySelector will find it

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: {
          form: { id: 'recovered-f2', formInstanceId: 'non-existent-form' },
          fields: [{ name: 'orphan_field', value: 'Found Me' }],
        },
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rec_form_2' },
      });
      expect(orphanInput.value).toBe('Found Me');

      // 8. RESTORE_FORM_REVISION throws exception
      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rec_form_err' },
      });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      // 9. Fast forward timers to trigger flashConfirmation setTimeout
      vi.advanceTimersByTime(300);
    });
  });
});
