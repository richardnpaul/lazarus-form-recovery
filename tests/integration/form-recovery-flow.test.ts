import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import { FormTracker } from '../../src/content/form-tracker';
import '../../src/background/service-worker'; // Bootstraps background service worker & message listener

describe('Full Form Recovery & Storage Integration Flow', () => {
  let tracker: FormTracker;

  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
    document.body.innerHTML = '';

    tracker = new FormTracker();
  });

  afterEach(() => {
    tracker.stop();
  });

  it('should capture form input, debounce, send to background, and persist in database', async () => {
    // 1. Create a form in the DOM
    const form = document.createElement('form');
    form.id = 'checkout-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.name = 'full_name';
    nameInput.id = 'full_name';

    const notesArea = document.createElement('textarea');
    notesArea.name = 'order_notes';
    notesArea.id = 'order_notes';

    form.appendChild(nameInput);
    form.appendChild(notesArea);
    document.body.appendChild(form);

    // 2. Start tracker
    tracker.start();

    // 3. User types into the form
    nameInput.value = 'Alice Henderson';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    notesArea.value = 'Please leave package at side porch';
    notesArea.dispatchEvent(new Event('input', { bubbles: true }));

    // Before debounce timer fires: DB should still be empty
    expect(await db.forms.count()).toBe(0);

    // 4. Wait 600ms for real debounce timer to fire and background write to complete
    await new Promise((resolve) => setTimeout(resolve, 650));

    // 5. Verify background service worker persisted the form and fields into IndexedDB
    const forms = await db.forms.toArray();
    expect(forms.length).toBe(1);
    expect(forms[0].formInstanceId).toBe('checkout-form');

    const fields = await db.fields.toArray();
    expect(fields.length).toBe(2);

    const nameField = fields.find((f) => f.name === 'full_name');
    expect(nameField?.value).toBe('Alice Henderson');

    const notesField = fields.find((f) => f.name === 'order_notes');
    expect(notesField?.value).toBe('Please leave package at side porch');

    // 6. Test GET_ALL_HISTORY runtime message
    const historyRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
    expect(historyRes.success).toBe(true);
    expect(historyRes.data.length).toBe(1);
    expect(historyRes.data[0].fields.length).toBe(2);

    // 7. Test GET_RECOVERABLE_TEXT runtime message (used by in-situ recovery menu)
    const recoverRes = await chrome.runtime.sendMessage({
      type: 'GET_RECOVERABLE_TEXT',
      payload: {
        domain: window.location.hostname || 'localhost',
        fieldName: 'order_notes',
        fieldType: 'textarea',
      },
    });

    expect(recoverRes.success).toBe(true);
    expect(recoverRes.data.length).toBeGreaterThan(0);
    expect(recoverRes.data[0].value).toBe('Please leave package at side porch');
  });

  it('should capture sidebar playground autosaves and update history', async () => {
    const playgroundMessage = {
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'sidepanel-playground',
          url: 'chrome-extension://mock-extension/src/sidepanel/sidepanel.html',
          domain: 'sidepanel.lazarus',
          title: 'Sidepanel Playground Form',
          editingTime: 15,
          fields: [
            { name: 'subject', type: 'text', value: 'Integration Test Title' },
            { name: 'notes', type: 'textarea', value: 'Detailed notes captured in playground' },
          ],
        },
      },
    };

    const res = await chrome.runtime.sendMessage(playgroundMessage);
    expect(res.success).toBe(true);

    // Query history as the sidebar does
    const historyRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
    expect(historyRes.success).toBe(true);
    expect(historyRes.data.length).toBe(1);

    const capturedItem = historyRes.data[0];
    expect(capturedItem.form.title).toBe('Sidepanel Playground Form');
    expect(capturedItem.fields.length).toBe(2);

    const subjectField = capturedItem.fields.find((f: any) => f.name === 'subject');
    expect(subjectField.value).toBe('Integration Test Title');
  });

  it('should support multiple chronological revisions of a form on the same website and offer multiple recoverable versions', async () => {
    const domain = 'test-revisions.org';
    const formInstanceId = 'contact-feedback-form';

    // 1. First Draft & Submit: Revision 1
    const submit1 = {
      type: 'SUBMIT_FORM',
      payload: {
        form: {
          formInstanceId,
          url: `https://${domain}/feedback`,
          domain,
          title: 'Customer Feedback Form',
          editingTime: 12,
          fields: [{ name: 'message', type: 'textarea', value: 'First revision: Great product!' }],
        },
      },
    };
    const res1 = await chrome.runtime.sendMessage(submit1);
    expect(res1.success).toBe(true);
    expect(res1.data.revisionNumber).toBe(1);

    // 2. Second Session / Submit: Revision 2 on the same form
    const submit2 = {
      type: 'SUBMIT_FORM',
      payload: {
        form: {
          formInstanceId,
          url: `https://${domain}/feedback`,
          domain,
          title: 'Customer Feedback Form',
          editingTime: 30,
          fields: [
            {
              name: 'message',
              type: 'textarea',
              value: 'Second revision: Need support for mobile app.',
            },
          ],
        },
      },
    };
    const res2 = await chrome.runtime.sendMessage(submit2);
    expect(res2.success).toBe(true);
    expect(res2.data.revisionNumber).toBe(2);

    // 3. Verify multiple revisions exist in IndexedDB for the same form
    const forms = await db.forms.where('domainId').equals(domain).toArray();
    expect(forms.length).toBe(2);

    const rev1Form = forms.find((f) => f.revisionNumber === 1);
    const rev2Form = forms.find((f) => f.revisionNumber === 2);
    expect(rev1Form).toBeDefined();
    expect(rev2Form).toBeDefined();
    expect(rev1Form?.isFinalSubmit).toBe(true);
    expect(rev2Form?.isFinalSubmit).toBe(true);

    // 4. Test GET_FORM_REVISIONS returns both revisions ordered newest first
    const revisionsRes = await chrome.runtime.sendMessage({
      type: 'GET_FORM_REVISIONS',
      payload: { domain, formInstanceId },
    });
    expect(revisionsRes.success).toBe(true);
    expect(revisionsRes.data.length).toBe(2);
    expect(revisionsRes.data[0].form.revisionNumber).toBe(2);
    expect(revisionsRes.data[1].form.revisionNumber).toBe(1);

    // 5. Test GET_RECOVERABLE_TEXT returns multiple unique historical snippets across revisions
    const recoverableRes = await chrome.runtime.sendMessage({
      type: 'GET_RECOVERABLE_TEXT',
      payload: { domain, fieldName: 'message', fieldType: 'textarea' },
    });
    expect(recoverableRes.success).toBe(true);
    expect(recoverableRes.data.length).toBe(2);
    expect(recoverableRes.data[0].value).toBe('Second revision: Need support for mobile app.');
    expect(recoverableRes.data[1].value).toBe('First revision: Great product!');
  });

  it('should broadcast FORM_SAVED on autosave and allow context menu form restoration', async () => {
    // 1. Listen for background broadcast
    let receivedBroadcast: any = null;
    const listener = (msg: any) => {
      if (msg?.type === 'FORM_SAVED') {
        receivedBroadcast = msg.payload;
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // 2. Set up a form in the DOM
    const form = document.createElement('form');
    form.id = 'live-sync-form';

    const input = document.createElement('input');
    input.name = 'address';
    input.value = '123 Initial Street';
    form.appendChild(input);
    document.body.appendChild(form);

    tracker.start();

    // 3. Trigger Force Snapshot (as done by context menu "Save Snapshot Now")
    const saveRes = await chrome.runtime.sendMessage({
      type: 'FORCE_SAVE_SNAPSHOT',
      payload: {
        form: {
          formInstanceId: 'live-sync-form',
          url: 'https://example.com/checkout',
          domain: 'example.com',
          title: 'Checkout Form',
          editingTime: 10,
          fields: [{ name: 'address', type: 'text', value: '123 Saved Street' }],
        },
      },
    });

    expect(saveRes.success).toBe(true);
    expect(receivedBroadcast).not.toBeNull();
    expect(receivedBroadcast.formInstanceId).toBe('live-sync-form');
    expect(receivedBroadcast.revisionNumber).toBe(1);

    // 4. Clear input value in DOM (simulating user clearing or losing form)
    input.value = '';

    // 5. Simulate context menu triggering RESTORE_FORM_REVISION on active tab
    const formId = saveRes.data.formId;
    await (tracker as any).restoreFormFromId(formId);

    // Assert that the form input was restored to the saved revision value
    expect(input.value).toBe('123 Saved Street');

    chrome.runtime.onMessage.removeListener(listener);
  });
});
