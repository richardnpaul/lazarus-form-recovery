import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormTracker } from '../../src/content/form-tracker';
import { FieldExtractor } from '../../src/content/field-extractor';
import * as runtimeUtils from '../../src/common/utils/runtime';

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

    it('handles RESTORE_LAST_FORM message by querying latest domain form', async () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'email_addr';
      form.appendChild(input);
      root.appendChild(form);

      (chrome.runtime.sendMessage as any)
        .mockResolvedValueOnce({
          success: true,
          data: [{ form: { id: 'domain_latest_1' } }],
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            form: { id: 'domain_latest_1' },
            fields: [{ name: 'email_addr', value: 'restored@example.com' }],
          },
        });

      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_LAST_FORM',
      });

      expect(input.value).toBe('restored@example.com');

      // Error branch handled gracefully
      (chrome.runtime.sendMessage as any).mockRejectedValueOnce(new Error('RestoreLastFailed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_LAST_FORM',
      });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to restore last form:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('handles invalid context guards and auto-stop across all event listeners', async () => {
      // 1. When context is invalid, ensureContextValid stops tracker and returns false
      const isContextSpy = vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
      const stopSpy = vi.spyOn(tracker, 'stop');

      expect((tracker as any).ensureContextValid()).toBe(false);
      expect(stopSpy).toHaveBeenCalled();

      // All listeners early return cleanly when context is invalid
      (tracker as any).onBlur(new Event('blur'));
      (tracker as any).onPaste(new Event('paste'));
      (tracker as any).onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      (tracker as any).onPageHide();
      tracker.start();
      (tracker as any).handleFocus(new Event('focus'));
      (tracker as any).handleContextMenu(new MouseEvent('contextmenu'));
      (tracker as any).handleInput(new Event('input'));
      (tracker as any).handleReset(new Event('reset'));
      (tracker as any).handleSubmit(new Event('submit'));
      await (tracker as any).handleRuntimeMessage({});
      await (tracker as any).restoreLastForm();
      await (tracker as any).restoreFormFromId('id');
      (tracker as any).restoreActiveField('val');
      (tracker as any).forceSaveCurrentForm();
      (tracker as any).triggerAutosave(document.createElement('input'));

      isContextSpy.mockRestore();
    });

    it('covers all event target composedPath fallbacks and null target guards', async () => {
      const input = document.createElement('input');
      input.value = 'composed-fallback';
      root.appendChild(input);

      // 1. Event without composedPath (fallback to event.target)
      (tracker as any).handleInput({ target: input });
      (tracker as any).onKeyDown({ key: 'Enter', target: input });
      (tracker as any).handleContextMenu({ target: input });
      (tracker as any).handleFocus({ target: input });
      (tracker as any).onPaste({ target: input });

      // 2. Null target across handlers
      (tracker as any).handleFocus({ target: null, composedPath: () => [] });
      (tracker as any).handleContextMenu({ target: null, composedPath: () => [] });
      (tracker as any).handleReset({ target: null, composedPath: () => [] });
      const nonForm = document.createElement('div');
      (tracker as any).handleReset({ target: nonForm, composedPath: () => [nonForm] });
      (tracker as any).handleSubmit({ target: null, composedPath: () => [] });
      (tracker as any).handleInput({ target: null, composedPath: () => [] });

      // 3. onKeyDown Enter with active autosaveTimer and non-trackable target
      (tracker as any).autosaveTimer = setTimeout(() => {}, 1000);
      (tracker as any).onKeyDown({ key: 'Enter', target: input, composedPath: () => [input] });
      expect((tracker as any).autosaveTimer).toBeNull();

      const nonTrackable = document.createElement('div');
      (tracker as any).onKeyDown({
        key: 'Enter',
        target: nonTrackable,
        composedPath: () => [nonTrackable],
      });

      // 4. onPageHide with null or non-trackable lastInteractedElement
      (tracker as any).lastInteractedElement = null;
      (tracker as any).onPageHide();
      (tracker as any).lastInteractedElement = nonTrackable;
      (tracker as any).onPageHide();
    });

    it('covers contextmenu on rich text, named forms, unnamed elements, and non-trackable items', () => {
      // 1. Target with rich text adapter
      const quill = document.createElement('div');
      quill.className = 'ql-editor';
      quill.id = 'quill_target';
      root.appendChild(quill);
      (tracker as any).handleContextMenu(new MouseEvent('contextmenu', { bubbles: true }));
      (tracker as any).handleContextMenu({ target: quill, composedPath: () => [quill] });

      // 2. Form with name attribute (no id) and input with name
      const formWithName = document.createElement('form');
      formWithName.setAttribute('name', 'named_form');
      const inputWithName = document.createElement('input');
      inputWithName.name = 'user_field';
      formWithName.appendChild(inputWithName);
      root.appendChild(formWithName);
      (tracker as any).handleContextMenu({
        target: inputWithName,
        composedPath: () => [inputWithName],
      });

      // 3. Form with neither id nor name, and input with neither id nor name
      const plainForm = document.createElement('form');
      const plainInput = document.createElement('input');
      plainForm.appendChild(plainInput);
      root.appendChild(plainForm);
      (tracker as any).handleContextMenu({ target: plainInput, composedPath: () => [plainInput] });

      // 4. Target is non-trackable
      const div = document.createElement('div');
      root.appendChild(div);
      (tracker as any).handleContextMenu({ target: div, composedPath: () => [div] });
    });

    it('covers reset and submit on forms with name vs form_wrapper vs fake_form and 0 fields', () => {
      // 1. Reset form with no id (uses form_wrapper)
      const formNoId = document.createElement('form');
      (tracker as any).handleReset({ target: formNoId, composedPath: () => [formNoId] });

      // 2. Submit form with name attribute
      const formWithName = document.createElement('form');
      formWithName.setAttribute('name', 'submit_form_name');
      const input = document.createElement('input');
      input.name = 'data';
      input.value = 'submit_val';
      formWithName.appendChild(input);
      root.appendChild(formWithName);
      (tracker as any).handleSubmit({ target: formWithName, composedPath: () => [formWithName] });

      // 3. Submit form with no id and no name (uses form_wrapper)
      const formNoName = document.createElement('form');
      const input2 = document.createElement('input');
      input2.name = 'd2';
      input2.value = 'v2';
      formNoName.appendChild(input2);
      root.appendChild(formNoName);
      (tracker as any).handleSubmit({ target: formNoName, composedPath: () => [formNoName] });

      // 4. Submit input outside form (uses fake_form)
      const orphan = document.createElement('input');
      orphan.value = 'orphan_val';
      root.appendChild(orphan);
      (tracker as any).handleSubmit({ target: orphan, composedPath: () => [orphan] });

      // 5. Submit form with 0 fields
      const emptyForm = document.createElement('form');
      (tracker as any).handleSubmit({ target: emptyForm, composedPath: () => [emptyForm] });

      // 6. Submit with active autosaveTimer
      (tracker as any).autosaveTimer = setTimeout(() => {}, 1000);
      (tracker as any).handleSubmit({ target: formWithName, composedPath: () => [formWithName] });
      expect((tracker as any).autosaveTimer).toBeNull();
    });

    it('covers triggerAutosave on forms with no id, fake_form, and 0 fields', () => {
      // 1. Form with no id
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'auto_in';
      input.value = 'auto_val';
      form.appendChild(input);
      root.appendChild(form);
      (tracker as any).triggerAutosave(input);

      // 2. Orphan input outside form
      const orphan = document.createElement('input');
      orphan.value = 'orphan_auto';
      root.appendChild(orphan);
      (tracker as any).triggerAutosave(orphan);

      // 3. Target with 0 fields
      const emptyInput = document.createElement('input');
      emptyInput.value = '';
      (tracker as any).triggerAutosave(emptyInput);
    });

    it('covers runtime message edge cases and invalid payloads', async () => {
      // 1. Non-object messages
      await (tracker as any).handleRuntimeMessage(null);
      await (tracker as any).handleRuntimeMessage('string_msg');

      // 2. RESTORE_FORM_REVISION missing formId
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: {},
      });

      // 3. RESTORE_FIELD_TEXT with non-string value
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 12345 },
      });

      // 4. Unrecognized action
      await (tracker as any).handleRuntimeMessage({
        action: 'UNKNOWN_CUSTOM_ACTION',
      });
    });

    it('covers restoreLastForm domain fallbacks, empty items, and failed responses', async () => {
      // 1. res.success is false
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await (tracker as any).restoreLastForm();

      // 2. res.data is not array
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: null });
      await (tracker as any).restoreLastForm();

      // 3. res.data is empty array
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: [] });
      await (tracker as any).restoreLastForm();

      // 4. latestItem has no form.id
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: [{ form: null }],
      });
      await (tracker as any).restoreLastForm();

      // 5. file: protocol domain
      const origLoc = window.location;
      delete (window as any).location;
      (window as any).location = { hostname: '', protocol: 'file:', href: 'file:///app.html' };
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: [] });
      await (tracker as any).restoreLastForm();
      (window as any).location = origLoc;
    });

    it('covers restoreFormFromId failure, missing targetForm, and missing element in doc', async () => {
      // 1. res.success is false or no data
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: false });
      await (tracker as any).restoreFormFromId('rev_fail');

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: null });
      await (tracker as any).restoreFormFromId('rev_null_data');

      // 2. Empty fields array
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: { fields: [] },
      });
      await (tracker as any).restoreFormFromId('rev_empty_fields');

      // 3. targetForm is null (no form in document) and elements found via document.querySelector
      document.body.innerHTML = '';
      const input = document.createElement('input');
      input.name = 'global_field';
      document.body.appendChild(input);

      (tracker as any).lastInteractedElement = null;
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
        success: true,
        data: {
          form: { id: 'f_global' },
          fields: [
            { name: 'global_field', value: 'Found Globally' },
            { name: 'non_existent_field', value: 'NotFound' }, // covers if (el) false branch
          ],
        },
      });
      await (tracker as any).restoreFormFromId('rev_global');
      expect(input.value).toBe('Found Globally');
    });

    it('covers forceSaveCurrentForm fallbacks and applyValueToElement non-input element', () => {
      // 1. forceSaveCurrentForm: lastInteractedElement is null, activeElement is null, uses querySelector
      document.body.innerHTML = '';
      const form = document.createElement('form'); // no id -> form_wrapper
      const ta = document.createElement('textarea');
      ta.value = 'ta_val';
      form.appendChild(ta);
      document.body.appendChild(form);

      (tracker as any).lastInteractedElement = null;
      const origActive = document.activeElement;
      Object.defineProperty(document, 'activeElement', { value: null, configurable: true });

      // Test with safeSendMessage resolving with non-null vs null
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true });
      (tracker as any).forceSaveCurrentForm();

      (chrome.runtime.sendMessage as any).mockResolvedValueOnce(null);
      (tracker as any).forceSaveCurrentForm();

      // Test with form having an explicit id
      form.id = 'form_with_id';
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true });
      (tracker as any).forceSaveCurrentForm();

      // Test when target is NOT inside a form -> fake_form
      document.body.innerHTML = '';
      const standaloneInput = document.createElement('input');
      standaloneInput.value = 'standalone';
      document.body.appendChild(standaloneInput);
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true });
      (tracker as any).forceSaveCurrentForm();

      // When no form/input/textarea in document -> returns
      document.body.innerHTML = '';
      (tracker as any).forceSaveCurrentForm();

      // 2. restoreActiveField when target is null
      (tracker as any).restoreActiveField('val');
      Object.defineProperty(document, 'activeElement', { value: origActive, configurable: true });

      // 3. applyValueToElement on plain div (non-input, non-adapter)
      const plainDiv = document.createElement('div');
      (tracker as any).applyValueToElement(plainDiv, 'div text content');
      expect(plainDiv.textContent).toBe('div text content');

      // 4. applyValueToElement on Quill editor
      const quill = document.createElement('div');
      quill.className = 'ql-editor';
      (tracker as any).applyValueToElement(quill, '<p>quill html</p>');
      expect(quill.innerHTML).toBe('<p>quill html</p>');
    });

    it('covers onBlur, onKeyDown, handleFocus, start/stop without window, and restoreLastForm custom protocol', async () => {
      const input = document.createElement('input');
      input.value = 'test_val';
      root.appendChild(input);

      // onBlur with event without composedPath and no active timer
      (tracker as any).autosaveTimer = null;
      (tracker as any).onBlur({ target: input });

      // onKeyDown Enter with no active timer
      (tracker as any).autosaveTimer = null;
      (tracker as any).onKeyDown({ key: 'Enter', target: input });

      // handleFocus on non-trackable element
      const div = document.createElement('div');
      root.appendChild(div);
      (tracker as any).handleFocus({ target: div });

      // start() and stop() when window is undefined
      const origWindow = globalThis.window;
      try {
        delete (globalThis as any).window;
        tracker.start();
        tracker.stop();
      } finally {
        globalThis.window = origWindow;
      }

      // stop() when context is invalid
      const ctxSpy = vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
      tracker.stop();
      ctxSpy.mockRestore();

      // restoreLastForm when protocol is custom: (returns unknown)
      const origLoc = window.location;
      delete (window as any).location;
      (window as any).location = { hostname: '', protocol: 'custom:', href: 'custom://app' };
      (chrome.runtime.sendMessage as any).mockResolvedValueOnce({ success: true, data: [] });
      await (tracker as any).restoreLastForm();

      // restoreLastForm when window is undefined
      try {
        delete (globalThis as any).window;
        await (tracker as any).restoreLastForm();
      } finally {
        globalThis.window = origWindow;
        (window as any).location = origLoc;
      }
    });
  });
});
