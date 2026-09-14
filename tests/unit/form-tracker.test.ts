import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormTracker } from '../../src/content/form-tracker';
import { FieldExtractor } from '../../src/content/field-extractor';
import * as runtimeUtils from '../../src/common/utils/runtime';

describe('FormTracker & Field Extractor Unit Tests', () => {
  let tracker: FormTracker;
  let sentMessages: any[] = [];
  let root: HTMLElement;

  let customResponses: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    customResponses = [];
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('lazarus-recovery-host').forEach((el) => el.remove());

    root = document.createElement('div');
    document.body.appendChild(root);

    // Intercept chrome.runtime.sendMessage
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (msg: any) => {
      sentMessages.push(msg);
      if (customResponses.length > 0) {
        const next = customResponses.shift();
        if (typeof next === 'function') {
          return next(msg);
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }
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

    it('registers and unregisters chrome.runtime.onMessage listeners and handles stop branches', () => {
      const addListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener');
      const removeListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'removeListener');
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      const testTracker = new FormTracker(root);
      testTracker.start();
      expect(addListenerSpy).toHaveBeenCalledWith((testTracker as any).onRuntimeMessageBound);

      // 1. stop with active autosaveTimer
      const input = document.createElement('input');
      root.appendChild(input);
      (testTracker as any).handleInput({ target: input, composedPath: () => [input] });
      expect((testTracker as any).autosaveTimer).not.toBeNull();

      testTracker.stop();
      expect(clearSpy).toHaveBeenCalled();
      expect((testTracker as any).autosaveTimer).toBeNull();
      expect(removeListenerSpy).toHaveBeenCalledWith((testTracker as any).onRuntimeMessageBound);

      // Verify timer does not fire after stop
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(0);

      // 2. stop without active autosaveTimer
      clearSpy.mockClear();
      removeListenerSpy.mockClear();
      testTracker.stop();
      expect(clearSpy).not.toHaveBeenCalled();

      // 3. stop when isExtensionContextValid is false
      const ctxSpy = vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
      removeListenerSpy.mockClear();
      testTracker.stop();
      expect(removeListenerSpy).not.toHaveBeenCalled();
      ctxSpy.mockRestore();

      // 4. start and stop when chrome.runtime.onMessage is undefined
      const origOnMsg = chrome.runtime.onMessage;
      delete (chrome.runtime as any).onMessage;
      const noMsgTracker = new FormTracker(root);
      expect(() => noMsgTracker.start()).not.toThrow();
      expect(() => noMsgTracker.stop()).not.toThrow();
      (chrome.runtime as any).onMessage = origOnMsg;

      // 5. start and stop when chrome.runtime is undefined
      const origRuntime = (chrome as any).runtime;
      delete (chrome as any).runtime;
      const noRuntimeTracker = new FormTracker(root);
      expect(() => noRuntimeTracker.start()).not.toThrow();
      expect(() => noRuntimeTracker.stop()).not.toThrow();
      (chrome as any).runtime = origRuntime;
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

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      // First input: timer is null, clearTimeout not called
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(clearSpy).not.toHaveBeenCalled();
      expect((tracker as any).autosaveTimer).not.toBeNull();
      vi.advanceTimersByTime(200);

      // Second input: timer is active, clearTimeout IS called
      input.value = 'Hello world';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(clearSpy).toHaveBeenCalled();
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

    it('flushes autosave immediately upon pagehide or beforeunload and manages timer', () => {
      const input = document.createElement('input');
      input.placeholder = 'Search GitHub';
      input.value = 'lazarus form recovery';
      root.appendChild(input);

      // Interact to set lastInteractedElement
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(sentMessages.length).toBe(0);
      expect((tracker as any).autosaveTimer).not.toBeNull();

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Page navigates away immediately (triggers pagehide) with active timer
      window.dispatchEvent(new Event('pagehide'));
      expect(clearSpy).toHaveBeenCalled();
      expect((tracker as any).autosaveTimer).toBeNull();
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe('SAVE_AUTOSAVE');

      // Page navigates away when timer is already null
      clearSpy.mockClear();
      sentMessages = [];
      window.dispatchEvent(new Event('beforeunload'));
      expect(clearSpy).not.toHaveBeenCalled();
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
      // 1. Initial call returns 0
      const t1 = (tracker as any).updateEditingTime('time-form');
      expect(t1).toBe(0);

      // 2. 50s later (< 300,000ms idle): returns 50
      vi.advanceTimersByTime(50000);
      const t2 = (tracker as any).updateEditingTime('time-form');
      expect(t2).toBe(50);

      // 3. Exactly 300,000ms later (idleTime <= EDITING_IDLE_TIME): accumulates 300s -> 350
      vi.advanceTimersByTime(300000);
      const t3 = (tracker as any).updateEditingTime('time-form');
      expect(t3).toBe(350);

      // 4. Exactly 300,001ms later (idleTime > EDITING_IDLE_TIME): resets burst start, does not accumulate -> 350
      vi.advanceTimersByTime(300001);
      const t4 = (tracker as any).updateEditingTime('time-form');
      expect(t4).toBe(350);

      // 5. 10s later in new active burst: accumulates 10s -> 360
      vi.advanceTimersByTime(10000);
      const t5 = (tracker as any).updateEditingTime('time-form');
      expect(t5).toBe(360);
    });

    it('resolves getFormId correctly for id, name, form_wrapper, and fake_form', () => {
      // Form with id
      const f1 = document.createElement('form');
      f1.id = 'form-id-1';
      expect((tracker as any).getFormId(f1)).toBe('form-id-1');

      // Form with name only
      const f2 = document.createElement('form');
      f2.setAttribute('name', 'form-name-2');
      expect((tracker as any).getFormId(f2)).toBe('form-name-2');

      // Form with neither id nor name
      const f3 = document.createElement('form');
      expect((tracker as any).getFormId(f3)).toBe('form_wrapper');

      // Null form element
      expect((tracker as any).getFormId(null)).toBe('fake_form');
    });

    it('passes strict false to isTrackable internally and attaches recovery UI on focus', () => {
      const spy = vi.spyOn(FieldExtractor, 'isTrackable');
      const input = document.createElement('input');
      root.appendChild(input);

      (tracker as any).handleFocus({ target: input, composedPath: () => [input] });
      expect(spy).toHaveBeenCalledWith(input, false);
      expect((tracker as any).lastInteractedElement).toBe(input);
      expect(document.querySelector('lazarus-recovery-host')).not.toBeNull();
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

      (tracker as any).lastInteractedElement = null;
      (tracker as any).autosaveTimer = null;
      pass.dispatchEvent(new Event('input', { bubbles: true }));
      expect((tracker as any).autosaveTimer).toBeNull();
      expect((tracker as any).lastInteractedElement).toBeNull();
      vi.advanceTimersByTime(300);
      expect(sentMessages.length).toBe(0);

      // Non-trackable element directly passed to handleInput
      const untrackable = document.createElement('div');
      (tracker as any).handleInput({ target: untrackable, composedPath: () => [untrackable] });
      expect((tracker as any).autosaveTimer).toBeNull();
      expect((tracker as any).lastInteractedElement).toBeNull();
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

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(clearSpy).not.toHaveBeenCalled();
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

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Submit immediately before timer expires
      form.dispatchEvent(new Event('submit', { bubbles: true }));
      expect(clearSpy).toHaveBeenCalled();
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

    it('does not dispatch messages on submit, reset, or triggerAutosave when form has 0 trackable fields or non-form reset', () => {
      const form = document.createElement('form');
      const pass = document.createElement('input');
      pass.type = 'password';
      pass.value = 'secret';
      form.appendChild(pass);
      root.appendChild(form);

      // Reset empty
      sentMessages = [];
      (tracker as any).handleReset({ target: form, composedPath: () => [form] });
      expect(sentMessages.length).toBe(0);

      // Reset non-form
      const nonForm = document.createElement('div');
      const inputInNonForm = document.createElement('input');
      inputInNonForm.name = 'non_form_in';
      inputInNonForm.value = 'val';
      nonForm.appendChild(inputInNonForm);
      root.appendChild(nonForm);
      (tracker as any).handleReset({ target: nonForm, composedPath: () => [nonForm] });
      expect(sentMessages.length).toBe(0);

      // Submit empty
      sentMessages = [];
      (tracker as any).handleSubmit({ target: form, composedPath: () => [form] });
      expect(sentMessages.length).toBe(0);

      // TriggerAutosave empty
      sentMessages = [];
      (tracker as any).triggerAutosave(pass);
      expect(sentMessages.length).toBe(0);
    });

    it('dispatches UPDATE_CONTEXT_MENU on right click (contextmenu) with accurate payload', () => {
      // Case 1: Form with id and input with name
      const form1 = document.createElement('form');
      form1.id = 'form-id-1';
      const input1 = document.createElement('input');
      input1.name = 'input-name-1';
      form1.appendChild(input1);
      root.appendChild(form1);

      input1.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toEqual({
        type: 'UPDATE_CONTEXT_MENU',
        payload: {
          domain: window.location.hostname,
          formInstanceId: 'form-id-1',
          fieldName: 'input-name-1',
          fieldType: 'input',
        },
      });

      // Case 2: Form with name only, input with id only
      sentMessages = [];
      const form2 = document.createElement('form');
      form2.setAttribute('name', 'form-name-2');
      const input2 = document.createElement('input');
      input2.id = 'input-id-2';
      form2.appendChild(input2);
      root.appendChild(form2);

      (tracker as any).handleContextMenu({ target: input2, composedPath: () => [input2] });
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].payload).toEqual({
        domain: window.location.hostname,
        formInstanceId: 'form-name-2',
        fieldName: 'input-id-2',
        fieldType: 'input',
      });

      // Case 3: Form with neither id nor name, input with neither
      sentMessages = [];
      const form3 = document.createElement('form');
      const input3 = document.createElement('input');
      form3.appendChild(input3);
      root.appendChild(form3);

      (tracker as any).handleContextMenu({ target: input3, composedPath: () => [input3] });
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].payload).toEqual({
        domain: window.location.hostname,
        formInstanceId: undefined,
        fieldName: undefined,
        fieldType: 'input',
      });

      // Case 4: Rich text editor (Quill)
      sentMessages = [];
      const quill = document.createElement('div');
      quill.className = 'ql-editor';
      quill.id = 'quill-id';
      root.appendChild(quill);

      (tracker as any).handleContextMenu({ target: quill, composedPath: () => [quill] });
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].payload).toEqual({
        domain: window.location.hostname,
        formInstanceId: undefined,
        fieldName: 'quill-id',
        fieldType: 'quill',
      });

      // Case 5: Non-trackable target (div)
      sentMessages = [];
      const div = document.createElement('div');
      root.appendChild(div);
      (tracker as any).handleContextMenu({ target: div, composedPath: () => [div] });
      expect(sentMessages.length).toBe(0);
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
      (tracker as any).lastInteractedElement = nameInput;

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
      expect(emailInput.value).toBe('Directly Injected Text');

      // 3. FORCE_SAVE_NOW
      await (tracker as any).handleRuntimeMessage({ action: 'FORCE_SAVE_NOW' });
      const forceMsg = sentMessages.find((m) => m.type === 'FORCE_SAVE_SNAPSHOT');
      expect(forceMsg).toBeDefined();

      // 4. RESTORE_FORM_REVISION failure scenarios
      customResponses.push({ success: false });
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
      document.body.appendChild(orphanInput);

      customResponses.push({
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
      customResponses.push(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'rec_form_err' },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to restore form revision:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();

      // 9. Fast forward timers to trigger flashConfirmation setTimeout
      vi.advanceTimersByTime(300);
    });

    it('handles RESTORE_LAST_FORM message by querying latest domain form across hostname and protocol fallbacks', async () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'email_addr';
      form.appendChild(input);
      root.appendChild(form);

      // 1. Hostname is defined
      sentMessages = [];
      customResponses.push({
        success: true,
        data: [{ form: { id: 'domain_latest_1' } }],
      });
      customResponses.push({
        success: true,
        data: {
          form: { id: 'domain_latest_1' },
          fields: [{ name: 'email_addr', value: 'restored@example.com' }],
        },
      });

      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_LAST_FORM',
      });

      expect(sentMessages[0].type).toBe('GET_DOMAIN_HISTORY');
      expect(sentMessages[0].payload.domain).toBe(window.location.hostname);
      expect(input.value).toBe('restored@example.com');

      // 2. Empty hostname with file: protocol
      const origLoc = window.location;
      delete (window as any).location;
      (window as any).location = { hostname: '', protocol: 'file:', href: 'file:///app.html' };

      sentMessages = [];
      customResponses.push({
        success: true,
        data: [],
      });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(sentMessages[0].payload.domain).toBe('local file');

      // 3. Empty hostname with custom: protocol -> 'unknown'
      (window as any).location = { hostname: '', protocol: 'custom:', href: 'custom://app' };
      sentMessages = [];
      customResponses.push({
        success: true,
        data: [],
      });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(sentMessages[0].payload.domain).toBe('unknown');

      (window as any).location = origLoc;

      // 4. Error branch handled gracefully
      customResponses.push(new Error('RestoreLastFailed'));
      const consoleSpy2 = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_LAST_FORM',
      });
      expect(consoleSpy2).toHaveBeenCalledWith('Failed to restore last form:', expect.any(Error));
      consoleSpy2.mockRestore();

      // Spy on restoreFormFromId for empty/invalid responses vs valid item
      const restoreFromIdSpy = vi.spyOn(tracker as any, 'restoreFormFromId');
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // 5. Response with success: false (must not call restoreFormFromId and must not throw error)
      customResponses.push({ success: false, data: [{ form: { id: 'should_not_call' } }] });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 6. Response with data: null
      customResponses.push({ success: true, data: null });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 7. Response with data: []
      customResponses.push({ success: true, data: [] });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 8. Response with data: [{ form: null }]
      customResponses.push({ success: true, data: [{ form: null }] });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 8b. Response is null
      customResponses.push(null);
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      // 9. Response with data: [{ form: { id: 'target_id' } }]
      customResponses.push({ success: true, data: [{ form: { id: 'target_id' } }] });
      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreFromIdSpy).toHaveBeenCalledWith('target_id');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('strictly terminates all methods when extension context is invalid without performing side effects', async () => {
      const isContextSpy = vi.spyOn(runtimeUtils, 'isExtensionContextValid').mockReturnValue(false);
      const stopSpy = vi.spyOn(tracker, 'stop');

      expect((tracker as any).ensureContextValid()).toBe(false);
      expect(stopSpy).toHaveBeenCalled();

      // Create realistic trackable elements
      const form = document.createElement('form');
      form.id = 'ctx-form';
      const input = document.createElement('input');
      input.name = 'ctx_field';
      input.value = 'unchanged_val';
      form.appendChild(input);
      root.appendChild(form);

      const addSpy = vi.spyOn(root, 'addEventListener');
      tracker.start();
      expect(addSpy).not.toHaveBeenCalled();

      const triggerSpy = vi.spyOn(tracker as any, 'triggerAutosave');
      const restoreSpy = vi.spyOn(tracker as any, 'restoreLastForm');

      // Ensure lastInteractedElement is set, then invoke handlers
      (tracker as any).lastInteractedElement = input;
      (tracker as any).onBlur({ target: input, composedPath: () => [input] });
      (tracker as any).onPaste({ target: input, composedPath: () => [input] });
      (tracker as any).onKeyDown({ key: 'Enter', target: input, composedPath: () => [input] });
      (tracker as any).onPageHide();
      expect(triggerSpy).not.toHaveBeenCalled();

      (tracker as any).lastInteractedElement = null;
      (tracker as any).handleFocus({ target: input, composedPath: () => [input] });
      expect((tracker as any).lastInteractedElement).toBeNull();

      (tracker as any).handleContextMenu({ target: input, composedPath: () => [input] });
      expect((tracker as any).lastInteractedElement).toBeNull();

      (tracker as any).handleInput({ target: input, composedPath: () => [input] });
      expect((tracker as any).lastInteractedElement).toBeNull();
      expect((tracker as any).autosaveTimer).toBeNull();

      (tracker as any).handleReset({ target: form, composedPath: () => [form] });
      (tracker as any).handleSubmit({ target: form, composedPath: () => [form] });
      (tracker as any).triggerAutosave(input);

      await (tracker as any).handleRuntimeMessage({ action: 'RESTORE_LAST_FORM' });
      expect(restoreSpy).not.toHaveBeenCalled();

      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: { formId: 'f1' },
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 'hack' },
      });
      await (tracker as any).handleRuntimeMessage({ action: 'FORCE_SAVE_NOW' });
      await (tracker as any).restoreLastForm();
      await (tracker as any).restoreFormFromId('id');

      (tracker as any).lastInteractedElement = input;
      (tracker as any).restoreActiveField('hack');
      (tracker as any).forceSaveCurrentForm();

      // Zero side-effects
      expect(sentMessages.length).toBe(0);
      expect((tracker as any).autosaveTimer).toBeNull();
      expect(document.querySelector('lazarus-recovery-host')).toBeNull();
      expect(input.value).toBe('unchanged_val');
      expect(input.style.backgroundColor).toBe('');

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

    it('covers runtime message edge cases, null/missing payloads, and invalid actions', async () => {
      // 1. Non-object messages
      await (tracker as any).handleRuntimeMessage(null);
      await (tracker as any).handleRuntimeMessage('string_msg');
      await (tracker as any).handleRuntimeMessage(12345);

      // 2. RESTORE_FORM_REVISION missing payload or formId
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: null,
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FORM_REVISION',
        payload: {},
      });

      // 3. RESTORE_FIELD_TEXT with missing payload or non-string value
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: null,
      });
      await (tracker as any).handleRuntimeMessage({
        action: 'RESTORE_FIELD_TEXT',
        payload: { value: 12345 },
      });

      // 4. Unrecognized action, even with string value and formId in payload
      const testIn = document.createElement('input');
      testIn.value = 'orig_val';
      root.appendChild(testIn);
      (tracker as any).lastInteractedElement = testIn;

      const restoreFromIdSpy2 = vi.spyOn(tracker as any, 'restoreFormFromId');
      const forceSaveSpy = vi.spyOn(tracker as any, 'forceSaveCurrentForm');
      const restoreLastSpy = vi.spyOn(tracker as any, 'restoreLastForm');
      const restoreActiveSpy = vi.spyOn(tracker as any, 'restoreActiveField');

      await (tracker as any).handleRuntimeMessage({
        action: 'UNKNOWN_CUSTOM_ACTION',
        payload: { value: 'hack_val', formId: 'hack_id' },
      });
      expect(restoreFromIdSpy2).not.toHaveBeenCalled();
      expect(forceSaveSpy).not.toHaveBeenCalled();
      expect(restoreLastSpy).not.toHaveBeenCalled();
      expect(restoreActiveSpy).not.toHaveBeenCalled();
      expect(testIn.value).toBe('orig_val');
    });

    it('covers restoreFormFromId scoping to targetForm over document querySelector and error handling', async () => {
      // Two forms with identical input names
      const formA = document.createElement('form');
      formA.id = 'form-A';
      const inputA = document.createElement('input');
      inputA.name = 'target_field';
      inputA.value = 'original_A';
      formA.appendChild(inputA);
      root.appendChild(formA);

      const formB = document.createElement('form');
      formB.id = 'form-B';
      const inputB = document.createElement('input');
      inputB.name = 'target_field';
      inputB.value = 'original_B';
      formB.appendChild(inputB);
      root.appendChild(formB);

      // Set lastInteractedElement in formB
      (tracker as any).lastInteractedElement = inputB;

      customResponses.push({
        success: true,
        data: {
          form: { id: 'rev-target' },
          fields: [{ name: 'target_field', value: 'restored_in_B' }],
        },
      });

      await (tracker as any).restoreFormFromId('rev-target');

      // formB input updated, formA untouched
      expect(inputB.value).toBe('restored_in_B');
      expect(inputA.value).toBe('original_A');

      // Error and empty checks without throwing or overwriting
      const consoleSpy = vi.spyOn(console, 'error');

      customResponses.push({
        success: false,
        data: { fields: [{ name: 'target_field', value: 'HACKED' }] },
      });
      await (tracker as any).restoreFormFromId('rev_fail');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(inputB.value).toBe('restored_in_B');

      customResponses.push(null);
      await (tracker as any).restoreFormFromId('rev_null_response');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(inputB.value).toBe('restored_in_B');

      customResponses.push({ success: true, data: null });
      await (tracker as any).restoreFormFromId('rev_null_data');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(inputB.value).toBe('restored_in_B');

      customResponses.push({ success: true, data: { fields: [] } });
      await (tracker as any).restoreFormFromId('rev_empty_fields');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(inputB.value).toBe('restored_in_B');

      customResponses.push({ success: true, data: { fields: null } });
      await (tracker as any).restoreFormFromId('rev_null_fields');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(inputB.value).toBe('restored_in_B');

      // targetForm is null, document.querySelector finds orphan input, and non_existent field ignored
      root.innerHTML = '';
      const orphanInput = document.createElement('input');
      orphanInput.name = 'orphan_input';
      orphanInput.value = 'old_orphan';
      root.appendChild(orphanInput);
      (tracker as any).lastInteractedElement = null;

      customResponses.push({
        success: true,
        data: {
          form: { id: 'rev-orphan' },
          fields: [
            { name: 'orphan_input', value: 'restored_orphan' },
            { name: 'non_existent_field', value: 'ignored' },
          ],
        },
      });
      await (tracker as any).restoreFormFromId('rev-orphan');
      expect(orphanInput.value).toBe('restored_orphan');
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('restores fields by ID, placeholder, aria-label, and handles checkbox/radio/select states', async () => {
      root.innerHTML = '';
      const form = document.createElement('form');

      // 1. By ID only (no name)
      const inputId = document.createElement('input');
      inputId.id = 'only_id';
      inputId.value = 'old_id';
      form.appendChild(inputId);

      // 2. By placeholder only (no name, no id)
      const inputPh = document.createElement('input');
      inputPh.setAttribute('placeholder', 'only_ph');
      inputPh.value = 'old_ph';
      form.appendChild(inputPh);

      // 3. By aria-label only (no name, no id, no placeholder)
      const inputAria = document.createElement('input');
      inputAria.setAttribute('aria-label', 'only_aria');
      inputAria.value = 'old_aria';
      form.appendChild(inputAria);

      // 4. Checkbox toggles: 'on', 'false', '0', ''
      const cbOn = document.createElement('input');
      cbOn.type = 'checkbox';
      cbOn.name = 'cb_on';
      cbOn.checked = false;
      form.appendChild(cbOn);

      const cbFalse = document.createElement('input');
      cbFalse.type = 'checkbox';
      cbFalse.name = 'cb_false';
      cbFalse.checked = true;
      form.appendChild(cbFalse);

      const cbZero = document.createElement('input');
      cbZero.type = 'checkbox';
      cbZero.name = 'cb_zero';
      cbZero.checked = true;
      form.appendChild(cbZero);

      const cbEmpty = document.createElement('input');
      cbEmpty.type = 'checkbox';
      cbEmpty.name = 'cb_empty';
      cbEmpty.checked = true;
      form.appendChild(cbEmpty);

      // 5. Radio buttons
      const radioFalse = document.createElement('input');
      radioFalse.type = 'radio';
      radioFalse.name = 'r_false';
      radioFalse.checked = true;
      form.appendChild(radioFalse);

      const radioOne = document.createElement('input');
      radioOne.type = 'radio';
      radioOne.name = 'r_one';
      radioOne.checked = false;
      form.appendChild(radioOne);

      // 6. Select dropdown
      const selectEl = document.createElement('select');
      selectEl.name = 'sel_field';
      const opt1 = document.createElement('option');
      opt1.value = 'v1';
      const opt2 = document.createElement('option');
      opt2.value = 'v2';
      selectEl.appendChild(opt1);
      selectEl.appendChild(opt2);
      selectEl.value = 'v1';
      form.appendChild(selectEl);

      root.appendChild(form);

      customResponses.push({
        success: true,
        data: {
          form: { id: 'rev-attr-test' },
          fields: [
            { name: 'only_id', value: 'new_id_val' },
            { name: 'only_ph', value: 'new_ph_val' },
            { name: 'only_aria', value: 'new_aria_val' },
            { name: 'cb_on', value: 'on' },
            { name: 'cb_false', value: 'false' },
            { name: 'cb_zero', value: '0' },
            { name: 'cb_empty', value: '' },
            { name: 'r_false', value: 'false' },
            { name: 'r_one', value: '1' },
            { name: 'sel_field', value: 'v2' },
          ],
        },
      });

      await (tracker as any).restoreFormFromId('rev-attr-test');

      expect(inputId.value).toBe('new_id_val');
      expect(inputPh.value).toBe('new_ph_val');
      expect(inputAria.value).toBe('new_aria_val');
      expect(cbOn.checked).toBe(true);
      expect(cbFalse.checked).toBe(false);
      expect(cbZero.checked).toBe(false);
      expect(cbEmpty.checked).toBe(false);
      expect(radioFalse.checked).toBe(false);
      expect(radioOne.checked).toBe(true);
      expect(selectEl.value).toBe('v2');
    });

    it('covers forceSaveCurrentForm target resolution, safeSendMessage null check, and flashConfirmation', async () => {
      root.innerHTML = '';
      const div1 = document.createElement('div');
      const input1 = document.createElement('input');
      input1.name = 'field1';
      input1.value = 'val1';
      div1.appendChild(input1);
      root.appendChild(div1);

      const div2 = document.createElement('div');
      const input2 = document.createElement('input');
      input2.name = 'field2';
      input2.value = 'val2';
      div2.appendChild(input2);
      root.appendChild(div2);

      // 1. lastInteractedElement has highest precedence
      (tracker as any).lastInteractedElement = input1;
      sentMessages = [];
      customResponses.push({ success: true });
      (tracker as any).forceSaveCurrentForm();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages[0].payload.form.fields[0].value).toBe('val1');
      expect(input1.style.getPropertyPriority('background-color')).toBe('important');

      // 2. When safeSendMessage returns null, flashConfirmation is not called
      input2.style.backgroundColor = '';
      (tracker as any).lastInteractedElement = input2;
      customResponses.push(null);
      (tracker as any).forceSaveCurrentForm();
      await Promise.resolve();
      await Promise.resolve();
      expect(input2.style.backgroundColor).toBe('');

      // 3. When lastInteractedElement is null, falls back to activeElement
      input2.focus();
      (tracker as any).lastInteractedElement = null;
      sentMessages = [];
      customResponses.push({ success: true });
      (tracker as any).forceSaveCurrentForm();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages[0].payload.form.fields[0].value).toBe('val2');

      // 4. When both are null, falls back to document.querySelector
      (tracker as any).lastInteractedElement = null;
      const origActive = document.activeElement;
      Object.defineProperty(document, 'activeElement', { value: null, configurable: true });
      sentMessages = [];
      customResponses.push({ success: true });
      (tracker as any).forceSaveCurrentForm();
      await Promise.resolve();
      await Promise.resolve();
      expect(sentMessages.length).toBe(1);

      // 5. When no elements in document, returns safely
      root.innerHTML = '';
      sentMessages = [];
      (tracker as any).forceSaveCurrentForm();
      expect(sentMessages.length).toBe(0);

      Object.defineProperty(document, 'activeElement', { value: origActive, configurable: true });
    });

    it('accurately dispatches synthetic input and change events with bubbles and composed in applyValueToElement', () => {
      const input = document.createElement('input');
      input.style.backgroundColor = 'rgb(255, 255, 255)';
      root.appendChild(input);

      let inputEvt: Event | null = null;
      let changeEvt: Event | null = null;
      input.addEventListener('input', (e) => {
        inputEvt = e;
      });
      input.addEventListener('change', (e) => {
        changeEvt = e;
      });

      (tracker as any).applyValueToElement(input, 'synthesized-value');

      expect(input.value).toBe('synthesized-value');

      // Verify input event flags
      expect(inputEvt).not.toBeNull();
      expect(inputEvt!.type).toBe('input');
      expect(inputEvt!.bubbles).toBe(true);
      expect(inputEvt!.composed).toBe(true);

      // Verify change event flags
      expect(changeEvt).not.toBeNull();
      expect(changeEvt!.type).toBe('change');
      expect(changeEvt!.bubbles).toBe(true);

      // Verify flashConfirmation styles
      expect(input.style.getPropertyValue('background-color')).toBe('rgba(33, 196, 93, 0.25)');
      expect(input.style.getPropertyPriority('background-color')).toBe('important');

      // 299ms: still highlighted
      vi.advanceTimersByTime(299);
      expect(input.style.getPropertyValue('background-color')).toBe('rgba(33, 196, 93, 0.25)');

      // 300ms: restored to origBg
      vi.advanceTimersByTime(1);
      expect(input.style.backgroundColor).toBe('rgb(255, 255, 255)');
    });

    it('covers onBlur, onKeyDown, handleFocus, start/stop without window, and restoreActiveField null', async () => {
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

      // restoreActiveField when target is null
      (tracker as any).lastInteractedElement = null;
      const origActive = document.activeElement;
      Object.defineProperty(document, 'activeElement', { value: null, configurable: true });
      (tracker as any).restoreActiveField('val');
      Object.defineProperty(document, 'activeElement', { value: origActive, configurable: true });

      // start() and stop() when window is undefined
      const origWindow = globalThis.window;
      try {
        delete (globalThis as any).window;
        tracker.start();
        tracker.stop();
      } finally {
        globalThis.window = origWindow;
      }
    });
  });
});
