import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import { FormTracker } from '../../src/content/form-tracker';
import { isExtensionContextValid, safeSendMessage } from '../../src/common/utils/runtime';
import { RuntimeBroadcasterAdapter } from '../../src/infrastructure/messaging/runtime-broadcaster.adapter';
import fs from 'fs';
import path from 'path';

describe('Firefox Functional Reproduction Tests (Google Search & RoboForm)', () => {
  let tracker: FormTracker | null = null;
  const originalChrome = (globalThis as any).chrome;
  const originalBrowser = (globalThis as any).browser;

  beforeEach(async () => {
    // Reset database
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
  });

  afterEach(() => {
    if (tracker) {
      tracker.stop();
      tracker = null;
    }
    // Restore globals
    (globalThis as any).chrome = originalChrome;
    if (originalBrowser !== undefined) {
      (globalThis as any).browser = originalBrowser;
    } else {
      delete (globalThis as any).browser;
    }
    vi.restoreAllMocks();
  });

  describe('Reproduction 1: Firefox Runtime Context & Safe Messaging Compatibility', () => {
    it('isExtensionContextValid should return true when globalThis.browser is present even if chrome is undefined', () => {
      // Replicate Firefox content script sandbox where chrome is undefined
      delete (globalThis as any).chrome;
      (globalThis as any).browser = {
        runtime: {
          id: 'firefox-lazarus-uuid',
        },
      };

      expect(isExtensionContextValid()).toBe(true);
    });

    it('safeSendMessage should deliver messages and return responses via browser.runtime.sendMessage', async () => {
      // Replicate Firefox environment with browser namespace returning Promise
      const mockResponse = { success: true, data: { test: 'firefox_ok' } };
      (globalThis as any).browser = {
        runtime: {
          id: 'firefox-lazarus-uuid',
          sendMessage: vi.fn(async () => mockResponse),
        },
      };
      // In Firefox, chrome.runtime.sendMessage is callback-based (returns undefined when called without callback)
      (globalThis as any).chrome = {
        runtime: {
          id: 'firefox-lazarus-uuid',
          sendMessage: vi.fn(() => undefined),
        },
      };

      const result = await safeSendMessage({ type: 'PING' });
      expect(result).toEqual(mockResponse);
    });

    it('RuntimeBroadcasterAdapter should not throw when runtime.sendMessage returns void/undefined in Firefox', () => {
      const broadcaster = new RuntimeBroadcasterAdapter();
      (globalThis as any).chrome = {
        runtime: {
          // Callback-style returns undefined
          sendMessage: vi.fn(() => undefined),
        },
      };

      expect(() => {
        broadcaster.broadcastFormSaved({
          domain: 'google.com',
          formInstanceId: 'form_search',
          revisionNumber: 1,
          formId: 'test-form-id',
        });
      }).not.toThrow();

      expect(() => {
        broadcaster.broadcastRefresh();
      }).not.toThrow();
    });

    it('FieldExtractor and queryAllDeep must support cross-realm DOM elements where (el instanceof HTMLElement) is false', async () => {
      const { FieldExtractor } = await import('../../src/content/field-extractor');
      const { queryAllDeep } = await import('../../src/common/utils/dom');

      // In Firefox content scripts, elements returned from the page have prototypes in the page's realm,
      // not the content script's realm, so (el instanceof HTMLElement) evaluates to false.
      const mockCrossRealmTextarea = Object.create({
        nodeType: 1,
        tagName: 'TEXTAREA',
        getAttribute: (attr: string) => (attr === 'name' ? 'q' : null),
        value: 'cross-realm search test',
        id: 'APjFqb',
      });
      // Verify (element instanceof HTMLElement) is false
      expect(mockCrossRealmTextarea instanceof HTMLElement).toBe(false);
      expect(mockCrossRealmTextarea.nodeType).toBe(1);

      // Verify FieldExtractor.isTrackable works on cross-realm elements
      expect(FieldExtractor.isTrackable(mockCrossRealmTextarea as any)).toBe(true);

      const field = FieldExtractor.extractField(mockCrossRealmTextarea as any);
      expect(field).toBeDefined();
      expect(field?.name).toBe('q');
      expect(field?.value).toBe('cross-realm search test');

      // Verify queryAllDeep includes elements with nodeType === 1
      const container = document.createElement('div');
      const realInput = document.createElement('input');
      realInput.name = 'real_input';
      container.appendChild(realInput);

      const elements = queryAllDeep(container, 'input');
      expect(elements.length).toBe(1);
      expect(elements[0].nodeType).toBe(1);
    });
  });

  describe('Reproduction 2: Google Search Form Recovery & Sidebar Synchronization', () => {
    it('Scenario: Typing in Google Search bar triggers autosave and synchronizes with sidebar in Firefox', async () => {
      // Replicate exact Google Search DOM structure (un-named form with action="/search", no id)
      const sidepanelHtml = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidepanel/sidepanel.html'),
        'utf-8'
      );
      const match = sidepanelHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const sidepanelBody = match ? match[1] : sidepanelHtml;

      document.body.innerHTML = `
        <div id="google-search-page">
          <form action="/search" autocomplete="off" method="GET" role="search">
            <textarea class="gLFyf" name="q" id="APjFqb" title="Search" aria-label="Search" role="combobox"></textarea>
            <input type="submit" value="Google Search" />
          </form>
        </div>
        <div id="sidepanel-container">
          ${sidepanelBody}
        </div>
      `;

      // Replicate window.location for Google search page
      delete (window as any).location;
      (window as any).location = new URL('https://www.google.com/');

      // Set up Firefox browser API environment
      const firefoxBrowserMock: any = {
        runtime: {
          id: 'lazarus-firefox-id',
          sendMessage: vi.fn(async (msg: any) => {
            return await originalChrome.runtime.sendMessage(msg);
          }),
          onMessage: originalChrome.runtime.onMessage,
        },
        tabs: {
          query: vi.fn(async (queryInfo: any) => {
            return [{ id: 101, url: 'https://www.google.com/search?q=' }];
          }),
          onActivated: { addListener: vi.fn() },
          onUpdated: { addListener: vi.fn() },
        },
      };

      (globalThis as any).browser = firefoxBrowserMock;

      // Boot Background Service Worker & Message Router
      await import('../../src/background/service-worker');

      // Boot Sidepanel UI Controller
      const sidepanel = await import('../../src/sidepanel/sidepanel');
      await sidepanel.resolveActiveTab();
      sidepanel.initSidepanel();

      // Verify domain recognized in sidebar
      const siteDomainEl = document.getElementById('site-domain');
      expect(sidepanel.getCurrentDomain()).toBe('www.google.com');
      expect(siteDomainEl?.textContent).toBe('www.google.com');

      // Boot FormTracker on Google page
      const googleContainer = document.getElementById('google-search-page') as HTMLElement;
      tracker = new FormTracker(googleContainer);
      tracker.start();

      // User types search query
      const searchInput = document.getElementById('APjFqb') as HTMLTextAreaElement;
      searchInput.value = 'how to recover lost form text in firefox';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce (300ms) + background save + broadcast
      await new Promise((r) => setTimeout(r, 650));

      // Verify draft saved in DB
      const forms = await db.forms.toArray();
      expect(forms.length).toBe(1);

      // Verify sidebar displays the Google Search draft
      await sidepanel.loadHistory();
      const historyList = document.getElementById('history-list') as HTMLElement;
      const items = historyList.querySelectorAll('.history-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('how to recover lost form text');

      // User presses Enter in search box to submit
      searchInput.value = 'how to recover lost form text in firefox [updated]';
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      await new Promise((r) => setTimeout(r, 600));

      // Verify immediate flush on Enter saved revision in DB and sidebar
      const allForms = await db.forms.toArray();
      expect(allForms.length).toBeGreaterThanOrEqual(1);
      expect(allForms[allForms.length - 1].formInstanceId).toBe('form_search');
    });
  });

  describe('Reproduction 3: RoboForm All-Fields Complex Form Filling & Restoration', () => {
    it('Scenario: Filling numeric-named fields, handling Reset button, and restoring values works seamlessly', async () => {
      // Replicate exact RoboForm test form markup
      document.body.innerHTML = `
        <div id="roboform-page">
          <form class="container" id="robo-main-form">
            <input type="text" name="01___title" id="01___title" value="" />
            <input type="text" name="02frstname" id="02frstname" value="" />
            <input type="text" name="03middle_i" value="" />
            <input type="text" name="04lastname" value="" />
            <input type="text" name="10address1" value="" />
            <select name="40cc__type" id="40cc__type">
              <option value="0">(Select Card Type)</option>
              <option value="9">Visa</option>
              <option value="6">Master Card</option>
            </select>
            <select name="66mm" id="66mm">
              <option value="0">Month</option>
              <option value="1">Jan</option>
              <option value="5">May</option>
            </select>
            <input type="checkbox" name="terms" id="terms" value="agreed" />
            <input type="radio" name="plan" id="plan-pro" value="pro" />
            <textarea placeholder="Anonymous notes"></textarea>
            <input type="password" name="31password" value="" />
            <input type="reset" value="Reset" id="robo-reset-btn" />
          </form>
        </div>
      `;

      // Set window.location.hostname
      delete (window as any).location;
      (window as any).location = new URL('https://www.roboform.com/filling-test-all-fields');

      // Boot Background Service Worker
      await import('../../src/background/service-worker');

      const roboContainer = document.getElementById('roboform-page') as HTMLElement;
      tracker = new FormTracker(roboContainer);
      tracker.start();

      const titleInput = document.getElementById('01___title') as HTMLInputElement;
      const firstNameInput = document.getElementById('02frstname') as HTMLInputElement;
      const addressInput = document.querySelector('input[name="10address1"]') as HTMLInputElement;
      const cardSelect = document.getElementById('40cc__type') as HTMLSelectElement;
      const monthSelect = document.getElementById('66mm') as HTMLSelectElement;
      const termsCheckbox = document.getElementById('terms') as HTMLInputElement;
      const planRadio = document.getElementById('plan-pro') as HTMLInputElement;
      const anonTextarea = document.querySelector(
        'textarea[placeholder="Anonymous notes"]'
      ) as HTMLTextAreaElement;

      // 1. User fills multiple fields (including numeric names, dropdowns, checkbox, radio, selector-based field)
      titleInput.value = 'Dr.';
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));

      firstNameInput.value = 'Gordon';
      firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));

      addressInput.value = 'Level 3 Dormitories, Black Mesa Facility';
      addressInput.dispatchEvent(new Event('input', { bubbles: true }));

      cardSelect.value = '9';
      cardSelect.dispatchEvent(new Event('change', { bubbles: true }));

      monthSelect.value = '5';
      monthSelect.dispatchEvent(new Event('change', { bubbles: true }));

      termsCheckbox.checked = true;
      termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

      planRadio.checked = true;
      planRadio.dispatchEvent(new Event('change', { bubbles: true }));

      anonTextarea.value = 'Secret facility observations';
      anonTextarea.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce autosave
      await new Promise((r) => setTimeout(r, 650));

      // 2. Verify all fields are persisted in DB
      const forms = await db.forms.toArray();
      expect(forms.length).toBe(1);
      const fields = await db.fields.where('formId').equals(forms[0].id).toArray();
      expect(fields.length).toBeGreaterThanOrEqual(8);

      const fieldNames = fields.map((f) => f.name);
      expect(fieldNames).toContain('01___title');
      expect(fieldNames).toContain('02frstname');
      expect(fieldNames).toContain('10address1');
      expect(fieldNames).toContain('40cc__type');
      expect(fieldNames).toContain('66mm');
      expect(fieldNames).toContain('terms');
      expect(fieldNames).toContain('plan');

      // 3. User clicks Reset button (clears form, but tracker captures pre-reset snapshot)
      const formEl = document.getElementById('robo-main-form') as HTMLFormElement;
      formEl.dispatchEvent(new Event('reset', { bubbles: true }));

      // Form values are cleared after reset in the DOM
      titleInput.value = '';
      firstNameInput.value = '';
      addressInput.value = '';
      cardSelect.value = '0';
      monthSelect.value = '0';
      termsCheckbox.checked = false;
      planRadio.checked = false;
      anonTextarea.value = '';

      // 4. Test Form Restoration: restore the saved draft
      const formId = forms[0].id;
      // Trigger runtime message to restore form
      await (tracker as any).restoreFormFromId(formId);

      // Verify that numeric-named inputs, select dropdowns, checkboxes, radios, and selector-based inputs are restored!
      expect(titleInput.value).toBe('Dr.');
      expect(firstNameInput.value).toBe('Gordon');
      expect(addressInput.value).toBe('Level 3 Dormitories, Black Mesa Facility');
      expect(cardSelect.value).toBe('9');
      expect(monthSelect.value).toBe('5');
      expect(termsCheckbox.checked).toBe(true);
      expect(planRadio.checked).toBe(true);
      expect(anonTextarea.value).toBe('Secret facility observations');
    });
  });
});
