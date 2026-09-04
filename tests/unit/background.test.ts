import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/background/service-worker';
import { db } from '../../src/common/db/lazarus-db';
import { RuntimeMessage } from '../../src/common/types/messages';
import { handleRuntimeMessage } from '../../src/background/message-router';

describe('Background Storage & Message Router Tests', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
  });

  it('should process SAVE_AUTOSAVE and persist to Dexie IndexedDB', async () => {
    const message: RuntimeMessage = {
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'issue-form-1',
          url: 'https://github.com/org/repo/issues/new',
          domain: 'github.com',
          title: 'New Issue · GitHub',
          editingTime: 45,
          fields: [
            { name: 'issue_title', type: 'text', value: 'Bug: Form reset accident' },
            { name: 'issue_body', type: 'textarea', value: 'Steps to reproduce the crash...' },
          ],
        },
      },
    };

    const response = await chrome.runtime.sendMessage(message);
    expect(response.success).toBe(true);

    const forms = await db.forms.toArray();
    expect(forms.length).toBe(1);
    expect(forms[0].domainId).toBe('github.com');
    expect(forms[0].title).toBe('New Issue · GitHub');

    const fields = await db.fields.toArray();
    expect(fields.length).toBe(2);
    expect(fields.find((f) => f.name === 'issue_title')?.value).toBe('Bug: Form reset accident');
  });

  it('should retrieve saved field text via GET_RECOVERABLE_TEXT and form via GET_RECOVERABLE_FORM', async () => {
    const saveRes = await chrome.runtime.sendMessage({
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'comment-box',
          url: 'https://news.ycombinator.com',
          domain: 'news.ycombinator.com',
          title: 'Hacker News',
          editingTime: 10,
          fields: [{ name: 'text', type: 'textarea', value: 'Insightful tech comment here' }],
        },
      },
    });

    const queryResponse = await chrome.runtime.sendMessage({
      type: 'GET_RECOVERABLE_TEXT',
      payload: {
        domain: 'news.ycombinator.com',
        fieldName: 'text',
        fieldType: 'textarea',
      },
    });

    expect(queryResponse.success).toBe(true);
    expect(queryResponse.data.length).toBe(1);
    expect(queryResponse.data[0].value).toBe('Insightful tech comment here');

    // GET_RECOVERABLE_FORM
    const formRes = await chrome.runtime.sendMessage({
      type: 'GET_RECOVERABLE_FORM',
      payload: { formId: saveRes.data.formId },
    });
    expect(formRes.success).toBe(true);
    expect(formRes.data.form.id).toBe(saveRes.data.formId);
  });

  it('should perform keyword search via SEARCH_HISTORY and empty search fallback', async () => {
    await chrome.runtime.sendMessage({
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'reddit-reply',
          url: 'https://reddit.com/r/programming',
          domain: 'reddit.com',
          title: 'Programming Discussion',
          editingTime: 20,
          fields: [
            {
              name: 'comment',
              type: 'textarea',
              value: 'WebExtensions with MV3 are very capable.',
            },
          ],
        },
      },
    });

    const searchRes = await chrome.runtime.sendMessage({
      type: 'SEARCH_HISTORY',
      payload: { query: 'capable' },
    });

    expect(searchRes.success).toBe(true);
    expect(searchRes.data.length).toBe(1);

    // Empty query returns all
    const emptySearchRes = await chrome.runtime.sendMessage({
      type: 'SEARCH_HISTORY',
      payload: { query: '' },
    });
    expect(emptySearchRes.success).toBe(true);
    expect(emptySearchRes.data.length).toBe(1);
  });

  it('should manage domain enable/disable blocklist and reject disabled domain saves', async () => {
    // Check initial
    const initialCheck = await chrome.runtime.sendMessage({
      type: 'IS_DOMAIN_ENABLED',
      payload: { domain: 'blocked.com' },
    });
    expect(initialCheck.data.enabled).toBe(true);

    // Disable domain with wipe
    await chrome.runtime.sendMessage({
      type: 'DISABLE_DOMAIN',
      payload: { domain: 'blocked.com', wipeExisting: true },
    });

    const checkAfterDisable = await chrome.runtime.sendMessage({
      type: 'IS_DOMAIN_ENABLED',
      payload: { domain: 'blocked.com' },
    });
    expect(checkAfterDisable.data.enabled).toBe(false);

    // Attempt saves on disabled domain -> should reject
    const sampleForm = {
      formInstanceId: 'f1',
      url: 'https://blocked.com',
      domain: 'blocked.com',
      title: 'Blocked',
      editingTime: 1,
      fields: [{ name: 'test', type: 'text', value: 'val' }],
    };

    const autoRes = await chrome.runtime.sendMessage({
      type: 'SAVE_AUTOSAVE',
      payload: { form: sampleForm },
    });
    expect(autoRes.success).toBe(false);

    const subRes = await chrome.runtime.sendMessage({
      type: 'SUBMIT_FORM',
      payload: { form: sampleForm },
    });
    expect(subRes.success).toBe(false);

    const forceRes = await chrome.runtime.sendMessage({
      type: 'FORCE_SAVE_SNAPSHOT',
      payload: { form: sampleForm },
    });
    expect(forceRes.success).toBe(false);

    // Re-enable domain
    await chrome.runtime.sendMessage({
      type: 'ENABLE_DOMAIN',
      payload: { domain: 'blocked.com' },
    });

    const checkAfterEnable = await chrome.runtime.sendMessage({
      type: 'IS_DOMAIN_ENABLED',
      payload: { domain: 'blocked.com' },
    });
    expect(checkAfterEnable.data.enabled).toBe(true);
  });

  it('should manage settings and export data', async () => {
    // GET_SETTINGS
    const getRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    expect(getRes.success).toBe(true);
    expect(getRes.data.expireFormsInterval).toBeDefined();

    // UPDATE_SETTINGS
    const updateRes = await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { settings: { expireFormsInterval: 14 } },
    });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data.expireFormsInterval).toBe(14);

    // EXPORT_DATA
    const exportRes = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA' });
    expect(exportRes.success).toBe(true);
    expect(exportRes.data.version).toBe(chrome.runtime.getManifest().version);
  });

  it('should manage vault operations and passwords', async () => {
    // Initial status
    const statusRes = await chrome.runtime.sendMessage({ type: 'CHECK_VAULT_STATUS' });
    expect(statusRes.success).toBe(true);
    expect(statusRes.data.hasMasterPassword).toBe(false);

    // SET_MASTER_PASSWORD
    const setRes = await chrome.runtime.sendMessage({
      type: 'SET_MASTER_PASSWORD',
      payload: { password: 'SuperSecretPassword123!' },
    });
    expect(setRes.success).toBe(true);

    // LOCK_VAULT
    const lockRes = await chrome.runtime.sendMessage({ type: 'LOCK_VAULT' });
    expect(lockRes.success).toBe(true);

    // UNLOCK_VAULT (wrong password)
    const wrongUnlock = await chrome.runtime.sendMessage({
      type: 'UNLOCK_VAULT',
      payload: { password: 'WrongPassword' },
    });
    expect(wrongUnlock.success).toBe(false);

    // UNLOCK_VAULT (correct password)
    const correctUnlock = await chrome.runtime.sendMessage({
      type: 'UNLOCK_VAULT',
      payload: { password: 'SuperSecretPassword123!' },
    });
    expect(correctUnlock.success).toBe(true);

    // REMOVE_MASTER_PASSWORD with wrong password
    const wrongRemove = await chrome.runtime.sendMessage({
      type: 'REMOVE_MASTER_PASSWORD',
      payload: { currentPassword: 'Wrong' },
    });
    expect(wrongRemove.success).toBe(false);

    // REMOVE_MASTER_PASSWORD with correct password
    const correctRemove = await chrome.runtime.sendMessage({
      type: 'REMOVE_MASTER_PASSWORD',
      payload: { currentPassword: 'SuperSecretPassword123!' },
    });
    expect(correctRemove.success).toBe(true);

    // REMOVE_MASTER_PASSWORD with no password parameter
    await chrome.runtime.sendMessage({ type: 'REMOVE_MASTER_PASSWORD', payload: {} });
  });

  it('should soft-delete forms and handle unknown message types', async () => {
    const saveRes = await chrome.runtime.sendMessage({
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'f_del',
          url: 'https://site.com',
          domain: 'site.com',
          title: 'Delete me',
          editingTime: 1,
          fields: [{ name: 'f', type: 'text', value: 'val' }],
        },
      },
    });

    const delRes = await chrome.runtime.sendMessage({
      type: 'DELETE_FORM',
      payload: { formId: saveRes.data.formId },
    });
    expect(delRes.success).toBe(true);

    // FORCE_SAVE_SNAPSHOT on enabled domain
    const forceRes = await chrome.runtime.sendMessage({
      type: 'FORCE_SAVE_SNAPSHOT',
      payload: {
        form: {
          formInstanceId: 'f_force',
          url: 'https://site.com',
          domain: 'site.com',
          title: 'Force me',
          editingTime: 1,
          fields: [{ name: 'f', type: 'text', value: 'val' }],
        },
      },
    });
    expect(forceRes.success).toBe(true);

    // UPDATE_CONTEXT_MENU
    const menuRes = await chrome.runtime.sendMessage({
      type: 'UPDATE_CONTEXT_MENU',
      payload: {
        domain: 'site.com',
        formInstanceId: 'f_force',
        fieldName: 'f',
        fieldType: 'text',
      },
    });
    expect(menuRes.success).toBe(true);

    // CLEAR_ALL_HISTORY
    const clearRes = await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY' });
    expect(clearRes.success).toBe(true);

    // OPEN_OPTIONS_PAGE
    const optionsRes = await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    expect(optionsRes.success).toBe(true);
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();

    // OPEN_OPTIONS_PAGE fallback to tabs.create
    const origOpenOptions = chrome.runtime.openOptionsPage;
    delete (chrome.runtime as any).openOptionsPage;
    const fallbackRes = await handleRuntimeMessage({ type: 'OPEN_OPTIONS_PAGE' }, {} as any);
    expect(fallbackRes.success).toBe(true);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://mock/src/options/options.html',
    });
    chrome.runtime.openOptionsPage = origOpenOptions;

    // Unknown message type
    const unknownRes = await handleRuntimeMessage({ type: 'UNKNOWN_TYPE' } as any, {});
    expect(unknownRes.success).toBe(false);
    expect(unknownRes.error).toBe('Unknown message type');

    // Exception handling
    const errRes = await handleRuntimeMessage(null as any, {});
    expect(errRes.success).toBe(false);
  });
});
