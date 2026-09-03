import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormTracker } from '../../src/content/form-tracker';

describe('FormTracker & Field Extractor Unit Tests', () => {
  let tracker: FormTracker;
  let sentMessages: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('lazarus-recovery-host').forEach((el) => el.remove());

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

    tracker = new FormTracker();
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Input Event & Debouncing', () => {
    it('should debounce rapid keystrokes within 500ms and send a single autosave', async () => {
      const form = document.createElement('form');
      form.id = 'comment-form';
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'comment_body';
      input.value = 'Hello';
      form.appendChild(input);
      document.body.appendChild(form);

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

      // Advance past the 500ms debounce threshold
      vi.advanceTimersByTime(500);

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
      document.body.appendChild(input);

      input.dispatchEvent(new Event('compositionend', { bubbles: true }));
      vi.advanceTimersByTime(500);
      expect(sentMessages.length).toBe(1);

      input.dispatchEvent(new Event('change', { bubbles: true }));
      vi.advanceTimersByTime(500);
      expect(sentMessages.length).toBe(2);
    });

    it('tracks active editing time and resets on idle gaps > 5 mins', () => {
      const form = document.createElement('form');
      form.id = 'time-tracker-form';
      const input = document.createElement('input');
      form.appendChild(input);
      document.body.appendChild(form);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Advance by 1 minute
      vi.advanceTimersByTime(60000);
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Advance by 6 minutes (idle threshold)
      vi.advanceTimersByTime(360000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    it('should capture multiline textareas and contenteditable elements', async () => {
      const textarea = document.createElement('textarea');
      textarea.id = 'essay-box';
      textarea.value = 'Paragraph 1\n\nParagraph 2 with code snippet.';
      document.body.appendChild(textarea);

      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(500);

      expect(sentMessages.length).toBe(1);
      const msg = sentMessages[0];
      expect(msg.type).toBe('SAVE_AUTOSAVE');
      expect(msg.payload.form.fields[0].value).toBe(
        'Paragraph 1\n\nParagraph 2 with code snippet.'
      );
      expect(msg.payload.form.fields[0].type).toBe('textarea');

      // Contenteditable
      const editableDiv = document.createElement('div');
      editableDiv.contentEditable = 'true';
      editableDiv.id = 'rich-editor';
      editableDiv.textContent = 'Rich editor formatted text';
      document.body.appendChild(editableDiv);

      editableDiv.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(500);

      expect(sentMessages.length).toBe(2);
    });

    it('should ignore input events on non-editable elements', async () => {
      const regularDiv = document.createElement('div');
      regularDiv.id = 'static-div';
      document.body.appendChild(regularDiv);

      regularDiv.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(600);

      expect(sentMessages.length).toBe(0);
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
      document.body.appendChild(form);

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(sentMessages.length).toBe(1);
      const msg = sentMessages[0];
      expect(msg.type).toBe('SUBMIT_FORM');
      expect(msg.payload.form.formInstanceId).toBe('checkout-form');
    });

    it('should immediately snapshot values before form reset', () => {
      const form = document.createElement('form');
      form.id = 'reset-form';
      const input = document.createElement('input');
      input.name = 'pre_reset';
      input.value = 'Valuable Draft';
      form.appendChild(input);
      document.body.appendChild(form);

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
      document.body.appendChild(form);

      input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

      const contextMsg = sentMessages.find((m) => m.type === 'UPDATE_CONTEXT_MENU');
      expect(contextMsg).toBeDefined();
      expect(contextMsg.payload.formInstanceId).toBe('context-form');
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
      document.body.appendChild(form);

      // Focus nameInput
      nameInput.focus();

      // 1. RESTORE_FORM_REVISION
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rec_form_1' },
      });

      expect(nameInput.value).toBe('Restored Name');
      expect(emailInput.value).toBe('restored@example.com');

      // 2. RESTORE_FIELD_TEXT
      (tracker as any).lastInteractedElement = nameInput;
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'Directly Injected Text' },
      });
      expect(nameInput.value).toBe('Directly Injected Text');

      // 3. FORCE_SAVE_NOW
      await (tracker as any).handleRuntimeMessage({ action: 'FORCE_SAVE_NOW' });
      const forceMsg = sentMessages.find((m) => m.type === 'FORCE_SAVE_SNAPSHOT');
      expect(forceMsg).toBeDefined();

      // Test applyValueToElement on rich text and textContent fallbacks
      const richEl = document.createElement('div');
      richEl.contentEditable = 'true';
      (tracker as any).applyValueToElement(richEl, 'Rich Restored');
      expect(richEl.textContent).toBe('Rich Restored');

      const plainEl = document.createElement('span');
      (tracker as any).applyValueToElement(plainEl, 'Plain Restored');
      expect(plainEl.textContent).toBe('Plain Restored');

      // Advance timer for flash confirmation
      vi.advanceTimersByTime(350);

      // Stop tracker
      tracker.stop();
    });
  });

  describe('In-Situ UI Injection on Focus', () => {
    it('should attach <lazarus-recovery-host> when an editable input gains focus', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'target-field';
      document.body.appendChild(input);

      input.dispatchEvent(new Event('focus', { bubbles: true }));

      const host = document.querySelector('lazarus-recovery-host');
      expect(host).not.toBeNull();
      expect(host?.tagName.toLowerCase()).toBe('lazarus-recovery-host');
    });

    it('should not attach recovery UI when a non-editable element gains focus', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      button.dispatchEvent(new Event('focus', { bubbles: true }));

      const host = document.querySelector('lazarus-recovery-host');
      expect(host).toBeNull();
    });
  });
});
