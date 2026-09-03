import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import { FormTracker } from '../../src/content/form-tracker';
import fs from 'fs';
import path from 'path';

describe('Live Sidepanel & Form Recovery End-to-End Integration Tests', () => {
  let tracker: FormTracker;

  beforeEach(async () => {
    // 1. Reset database
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();

    // 2. Set up DOM containing both the Web Page Form and the Sidepanel
    const sidepanelHtml = fs.readFileSync(path.resolve(__dirname, '../../src/sidepanel/sidepanel.html'), 'utf-8');
    const match = sidepanelHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const sidepanelBody = match ? match[1] : sidepanelHtml;

    document.body.innerHTML = `
      <!-- Web Page Area -->
      <div id="webpage-container">
        <form id="contact-form">
          <input type="text" id="cust-name" name="customer_name" />
          <textarea id="cust-feedback" name="feedback"></textarea>
        </form>
      </div>

      <!-- Sidepanel Area -->
      <div id="sidepanel-container">
        ${sidepanelBody}
      </div>
    `;

    // 3. Boot Background Service Worker & Message Router
    await import('../../src/background/service-worker');

    // 4. Boot Sidepanel UI Controller on fresh DOM
    const sidepanel = await import('../../src/sidepanel/sidepanel');
    sidepanel.initSidepanel();

    // 5. Boot Form Tracker on the web page only (simulating content script isolated from extension sidebar window)
    const webContainer = document.getElementById('webpage-container') as HTMLElement;
    tracker = new FormTracker(webContainer);
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
  });

  it('Scenario 1: Typing in a webpage form automatically saves and displays the draft in the sidebar', async () => {
    const custName = document.getElementById('cust-name') as HTMLInputElement;
    const custFeedback = document.getElementById('cust-feedback') as HTMLTextAreaElement;
    const historyList = document.getElementById('history-list') as HTMLElement;
    const historyCount = document.getElementById('history-count') as HTMLElement;

    expect(custName).not.toBeNull();
    expect(custFeedback).not.toBeNull();
    expect(historyList).not.toBeNull();

    // User types in webpage form
    custName.value = 'Dr. Gordon Freeman';
    custName.dispatchEvent(new Event('input', { bubbles: true }));

    custFeedback.value = 'Resonance cascade observed in Sector C test chamber.';
    custFeedback.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for debounce (500ms) + background save + broadcast + sidebar render
    await new Promise(r => setTimeout(r, 700));

    // Verify draft was saved in DB
    const formsInDb = await db.forms.toArray();
    expect(formsInDb.length).toBe(1);

    // Verify sidebar rendered the draft in real time
    expect(historyCount.textContent).toBe('1 draft');
    const items = historyList.querySelectorAll('.history-item');
    expect(items.length).toBe(1);

    const renderedText = items[0].textContent || '';
    expect(renderedText).toContain('Dr. Gordon Freeman');
    expect(renderedText).toContain('Resonance cascade observed');
  });

  it('Scenario 2: Typing in the sidebar playground automatically creates and displays a draft', async () => {
    const testTitle = document.getElementById('test-title') as HTMLInputElement;
    const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
    const historyList = document.getElementById('history-list') as HTMLElement;
    const historyCount = document.getElementById('history-count') as HTMLElement;

    testTitle.value = 'Research Notes';
    testTitle.dispatchEvent(new Event('input', { bubbles: true }));

    testBody.value = 'Quantum teleportation protocols require entangled pairs.';
    testBody.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for debounce (500ms) + background save + broadcast + sidebar render
    await new Promise(r => setTimeout(r, 700));

    // Verify draft was saved in DB
    const formsInDb = await db.forms.toArray();
    expect(formsInDb.length).toBe(1);
    expect(formsInDb[0].domainId).toBe('sidepanel.lazarus');

    // Verify sidebar rendered the playground draft
    expect(historyCount.textContent).toBe('1 draft');
    const items = historyList.querySelectorAll('.history-item');
    expect(items.length).toBe(1);

    const renderedText = items[0].textContent || '';
    expect(renderedText).toContain('Research Notes');
    expect(renderedText).toContain('Quantum teleportation');
  });

  it('Scenario 3: Clicking "Save Now" in the sidebar creates a submitted revision draft', async () => {
    const testTitle = document.getElementById('test-title') as HTMLInputElement;
    const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
    const playgroundForm = document.getElementById('playground-form') as HTMLFormElement;
    const historyList = document.getElementById('history-list') as HTMLElement;
    const historyCount = document.getElementById('history-count') as HTMLElement;

    testTitle.value = 'Final Thesis Draft';
    testBody.value = 'Final conclusion for academic review.';

    // Click Save Now (submit)
    playgroundForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait for background persistence and UI reload
    await new Promise(r => setTimeout(r, 500));

    const formsInDb = await db.forms.toArray();
    expect(formsInDb.length).toBe(1);
    expect(formsInDb[0].isFinalSubmit).toBe(true);

    const items = historyList.querySelectorAll('.history-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Submitted');
    expect(items[0].textContent).toContain('Final Thesis Draft');
  });

  it('Scenario 4: Search filter updates the sidebar drafts in real-time', async () => {
    const testTitle = document.getElementById('test-title') as HTMLInputElement;
    const testBody = document.getElementById('test-body') as HTMLTextAreaElement;
    const playgroundForm = document.getElementById('playground-form') as HTMLFormElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const historyList = document.getElementById('history-list') as HTMLElement;

    testTitle.value = 'Special Secret Keyword Alpha';
    testBody.value = 'Nothing to see here.';
    playgroundForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise(r => setTimeout(r, 250));
    expect(historyList.querySelectorAll('.history-item').length).toBe(1);

    // Search for non-matching query
    searchInput.value = 'BetaZetaNotFound';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));

    expect(historyList.querySelectorAll('.history-item').length).toBe(0);

    // Search for matching query
    searchInput.value = 'Alpha';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));

    expect(historyList.querySelectorAll('.history-item').length).toBe(1);
  });
});
