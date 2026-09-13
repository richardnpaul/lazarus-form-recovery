import { describe, it, expect, vi } from 'vitest';
import {
  formatTimeAgo,
  computeWordCount,
  sanitizePreview,
  computeSimpleDiff,
} from '../../src/common/utils/text';
import {
  escapeCss,
  getElementSelector,
  computeButtonPosition,
  queryAllDeep,
  safeSetHtml,
} from '../../src/common/utils/dom';
import { isValidLuhn, scrubSensitiveData } from '../../src/common/utils/pii';
import { getExtensionVersion } from '../../src/common/utils/version';

describe('Text Utilities (src/common/utils/text.ts)', () => {
  it('should format relative timestamps correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000000000);
    const now = Date.now();

    expect(formatTimeAgo(now - 10000)).toBe('Just now');
    expect(formatTimeAgo(now - 59999)).toBe('Just now');
    expect(formatTimeAgo(now - 60000)).toBe('1m ago'); // exact 60s boundary
    expect(formatTimeAgo(now - 120000)).toBe('2m ago');
    expect(formatTimeAgo(now - 3599999)).toBe('59m ago');
    expect(formatTimeAgo(now - 3600000)).toBe('1h ago'); // exact 1h boundary
    expect(formatTimeAgo(now - 7200000)).toBe('2h ago');
    expect(formatTimeAgo(now - 86399999)).toBe('23h ago');
    expect(formatTimeAgo(now - 86400000)).toBe('Yesterday'); // exact 24h boundary
    expect(formatTimeAgo(now - 90000000)).toBe('Yesterday');
    expect(formatTimeAgo(now - 172799999)).toBe('Yesterday');
    expect(formatTimeAgo(now - 172800000)).toBe(new Date(now - 172800000).toLocaleDateString()); // exact 48h boundary
    expect(formatTimeAgo(now - 500000000)).toBe(new Date(now - 500000000).toLocaleDateString());

    vi.useRealTimers();
  });

  it('should compute word count accurately', () => {
    expect(computeWordCount(null as any)).toBe(0);
    expect(computeWordCount(undefined as any)).toBe(0);
    expect(computeWordCount('')).toBe(0);
    expect(computeWordCount('   ')).toBe(0);
    expect(computeWordCount('Hello world')).toBe(2);
    expect(computeWordCount('Hello   world')).toBe(2); // multiple spaces between words
    expect(computeWordCount('  One   two   three  ')).toBe(3);
  });

  it('should sanitize and preview text', () => {
    expect(sanitizePreview(null as any)).toBe('');
    expect(sanitizePreview(undefined as any)).toBe('');
    expect(sanitizePreview('')).toBe('');
    expect(sanitizePreview('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
    expect(sanitizePreview('<b>Hello</b><b>World</b>')).toBe('Hello World'); // tags without space
    expect(sanitizePreview('Hello<tag')).toBe('Hello'); // unclosed trailing tag
    expect(sanitizePreview('exact5', 6)).toBe('exact5');
    expect(sanitizePreview('exact6', 6)).toBe('exact6'); // length === maxLength
    expect(sanitizePreview('exact67', 6)).toBe('exact6...'); // length > maxLength
    expect(sanitizePreview('Short text', 50)).toBe('Short text');
    expect(sanitizePreview('This is a very long sentence that exceeds length', 10)).toBe(
      'This is a ...'
    );
  });

  it('should compute diffs between identical and divergent texts', () => {
    // Identical
    expect(computeSimpleDiff('hello world', 'hello world')).toEqual([
      { type: 'unchanged', value: 'hello world' },
    ]);
    expect(computeSimpleDiff('', '')).toEqual([]);

    // Multiple spaces between words (tests \s+ vs \s tokenization on oldText and newText)
    expect(computeSimpleDiff('hello   world', 'hello world')).toEqual([
      { type: 'unchanged', value: 'hello' },
      { type: 'removed', value: '   ' },
      { type: 'added', value: ' ' },
      { type: 'unchanged', value: 'world' },
    ]);
    expect(computeSimpleDiff('hello world', 'hello   world')).toEqual([
      { type: 'unchanged', value: 'hello' },
      { type: 'removed', value: ' ' },
      { type: 'added', value: '   ' },
      { type: 'unchanged', value: 'world' },
    ]);

    // Added tokens before unchanged token (within lookahead window)
    expect(computeSimpleDiff('fox', 'fast brown fox')).toEqual([
      { type: 'added', value: 'fast brown ' },
      { type: 'unchanged', value: 'fox' },
    ]);

    // Lookahead boundary: match within lookahead window (index 4 < 5)
    expect(computeSimpleDiff('target', 'w1 w2 target')).toEqual([
      { type: 'added', value: 'w1 w2 ' },
      { type: 'unchanged', value: 'target' },
    ]);

    // Lookahead boundary: exact match at index 5 (5 < 5 is false, kills <= 5 mutant)
    expect(computeSimpleDiff('target', ' w1 w2 target')).toEqual([
      { type: 'removed', value: 'target' },
      { type: 'added', value: ' w1 w2 target' },
    ]);

    // Lookahead boundary: match outside lookahead window (index 6 >= 5)
    expect(computeSimpleDiff('target', 'w1 w2 w3 target')).toEqual([
      { type: 'removed', value: 'target' },
      { type: 'added', value: 'w1 w2 w3 target' },
    ]);

    // Divergent with removal and lookahead match
    expect(computeSimpleDiff('the quick brown fox', 'the fast brown dog')).toEqual([
      { type: 'unchanged', value: 'the ' },
      { type: 'removed', value: 'quick' },
      { type: 'added', value: 'fast' },
      { type: 'unchanged', value: ' brown ' },
      { type: 'removed', value: 'fox' },
      { type: 'added', value: 'dog' },
    ]);

    // Completely different
    expect(computeSimpleDiff('apple', 'banana')).toEqual([
      { type: 'removed', value: 'apple' },
      { type: 'added', value: 'banana' },
    ]);

    // Extra tokens on old
    expect(computeSimpleDiff('one two three', 'one')).toEqual([
      { type: 'unchanged', value: 'one' },
      { type: 'removed', value: ' two three' },
    ]);

    // Extra tokens on new
    expect(computeSimpleDiff('one', 'one two three')).toEqual([
      { type: 'unchanged', value: 'one' },
      { type: 'added', value: ' two three' },
    ]);
  });
});

describe('DOM Utilities (src/common/utils/dom.ts)', () => {
  it('should escape CSS identifiers safely', () => {
    expect(escapeCss('normal-id')).toBe('normal-id');
    expect(escapeCss('weird:id.with spaces')).toBeDefined();

    // Simulate CSS.escape available
    const originalCss = (globalThis as any).CSS;
    (globalThis as any).CSS = { escape: (s: string) => `escaped-${s}` };
    expect(escapeCss('test')).toBe('escaped-test');

    // Simulate CSS defined but escape function missing
    (globalThis as any).CSS = {};
    expect(escapeCss('test.dot')).toBe('test\\.dot');

    // Simulate CSS unavailable (fallback regex branch)
    (globalThis as any).CSS = undefined;
    expect(escapeCss('weird:id.with spaces')).toBe('weird\\:id\\.with\\ spaces');

    (globalThis as any).CSS = originalCss;
  });

  it('should strip srcdoc attribute in safeSetHtml', () => {
    const el = document.createElement('div');
    el.appendChild(document.createElement('span'));
    safeSetHtml(el, '<div srcdoc="secret">safe text</div>');
    expect(el.querySelector('[srcdoc]')).toBeNull();
    expect(el.textContent).toBe('safe text');

    // Test clearing existing children when html is empty or invalid
    const elEmpty = document.createElement('div');
    elEmpty.appendChild(document.createElement('span'));
    safeSetHtml(elEmpty, '');
    expect(elEmpty.childNodes.length).toBe(0);

    const elNonString = document.createElement('div');
    elNonString.appendChild(document.createElement('span'));
    safeSetHtml(elNonString, 123 as any);
    expect(elNonString.childNodes.length).toBe(0);

    safeSetHtml(elNonString, null as any);
    expect(elNonString.childNodes.length).toBe(0);
    safeSetHtml(null as any, '<div></div>');

    // Blocked tags removal inside HTML, SVG and MathML namespaces
    const blockedTagsToTest = [
      'script',
      'iframe',
      'frame',
      'frameset',
      'object',
      'embed',
      'applet',
      'base',
      'meta',
      'link',
      'style',
      'template',
      'form',
      'foreignobject',
      'use',
      'animate',
      'set',
      'animatemotion',
      'animatetransform',
      'discard',
      'annotation-xml',
    ];
    for (const tag of blockedTagsToTest) {
      const elTest = document.createElement('div');
      safeSetHtml(elTest, `<svg><${tag} data-tag="${tag}"></${tag}></svg>`);
      expect(elTest.querySelector(`[data-tag="${tag}"]`)).toBeNull();
    }

    // Dangerous URL schemes on UNBLOCKED elements (action, formaction, poster, background, xlink:href)
    const el3 = document.createElement('div');
    safeSetHtml(
      el3,
      '<div action="javascript:1"></div><button formaction="javascript:2"></button><video poster="javascript:3"></video><div background="javascript:4"></div><svg><image xlink:href="javascript:5"></image></svg>'
    );
    expect(el3.querySelector('[action]')).toBeNull();
    expect(el3.querySelector('[formaction]')).toBeNull();
    expect(el3.querySelector('[poster]')).toBeNull();
    expect(el3.querySelector('[background]')).toBeNull();
    expect(el3.querySelector('[xlink\\:href]')).toBeNull();

    // Data URLs: only safe raster image data is allowed on src, NOT on href
    const elData = document.createElement('div');
    safeSetHtml(
      elData,
      '<a href="data:image/png;base64,AAA">link</a><img src="data:image/png;base64,AAA"><img src="data:text/plain;data:image/png;base64,AAA">'
    );
    expect(elData.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(elData.querySelectorAll('img')[0]?.getAttribute('src')).toBe(
      'data:image/png;base64,AAA'
    );
    expect(elData.querySelectorAll('img')[1]?.getAttribute('src')).toBeNull();

    // Style sanitization and attribute specificity
    const elStyle = document.createElement('div');
    safeSetHtml(
      elStyle,
      '<div style="java\\script:alert(1)">bad style</div><div title="javascript:alert(1)" class="javascript:alert(1)">safe attributes</div>'
    );
    expect(elStyle.querySelector('[style]')).toBeNull();
    expect(elStyle.querySelector('[title]')?.getAttribute('title')).toBe('javascript:alert(1)');
    expect(elStyle.querySelector('[class]')?.getAttribute('class')).toBe('javascript:alert(1)');
  });

  it('should generate accurate element selectors', () => {
    const elWithId = document.createElement('div');
    elWithId.id = 'main-container';
    expect(getElementSelector(elWithId)).toBe('#main-container');

    const elWithName = document.createElement('input');
    elWithName.setAttribute('name', 'user_email');
    expect(getElementSelector(elWithName)).toBe('input[name="user_email"]');

    const parent = document.createElement('ul');
    const li1 = document.createElement('li');
    const li2 = document.createElement('li');
    parent.appendChild(li1);
    parent.appendChild(li2);
    expect(getElementSelector(li2)).toBe('li:nth-of-type(2)');

    const singleChild = document.createElement('span');
    parent.appendChild(singleChild);
    expect(getElementSelector(singleChild)).toBe('span');

    const detached = document.createElement('p');
    expect(getElementSelector(detached)).toBe('p');
  });

  it('should traverse open shadow roots using queryAllDeep', () => {
    const container = document.createElement('div');
    const directInput = document.createElement('input');
    directInput.id = 'direct';
    container.appendChild(directInput);

    const customEl = document.createElement('div');
    if (customEl.attachShadow) {
      const shadow = customEl.attachShadow({ mode: 'open' });
      const shadowInput = document.createElement('input');
      shadowInput.id = 'shadow';
      shadow.appendChild(shadowInput);
    }
    container.appendChild(customEl);

    const results = queryAllDeep(container, 'input');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((el) => el.id === 'direct')).toBe(true);
    if (customEl.shadowRoot) {
      expect(results.some((el) => el.id === 'shadow')).toBe(true);
    }
  });

  it('should compute button positions with internal and external placements and clamping', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    // Mock getBoundingClientRect
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 400,
      height: 100,
      right: 410,
      bottom: 110,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    const posInternal = computeButtonPosition(target);
    expect(posInternal).toEqual({ x: 380, y: 48, placement: 'internal' });

    // Short target -> external placement
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 50,
      height: 20,
      right: 60,
      bottom: 30,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    const posExternal = computeButtonPosition(target);
    expect(posExternal).toEqual({ x: 64, y: 8, placement: 'external' });

    // Placement boundaries for height and width
    // height = 28, width = 100 -> internal
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 100,
      height: 28,
      right: 110,
      bottom: 38,
      x: 10,
      y: 10,
      toJSON: () => {},
    });
    expect(computeButtonPosition(target).placement).toBe('internal');

    // height = 27, width = 100 -> external
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 100,
      height: 27,
      right: 110,
      bottom: 37,
      x: 10,
      y: 10,
      toJSON: () => {},
    });
    expect(computeButtonPosition(target).placement).toBe('external');

    // height = 28, width = 99 -> external
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 99,
      height: 28,
      right: 109,
      bottom: 38,
      x: 10,
      y: 10,
      toJSON: () => {},
    });
    expect(computeButtonPosition(target).placement).toBe('external');

    // Scroll offsets
    window.scrollX = 50;
    window.scrollY = 100;
    target.getBoundingClientRect = () => ({
      left: 10,
      top: 10,
      width: 400,
      height: 100,
      right: 410,
      bottom: 110,
      x: 10,
      y: 10,
      toJSON: () => {},
    });
    expect(computeButtonPosition(target)).toEqual({ x: 430, y: 148, placement: 'internal' });
    window.scrollX = 0;
    window.scrollY = 0;

    // Clamping boundaries (far right overflow and negative coordinates)
    target.getBoundingClientRect = () => ({
      left: 5000,
      top: -300,
      width: 500,
      height: 500,
      right: 5500,
      bottom: 200,
      x: 5000,
      y: -300,
      toJSON: () => {},
    });

    const origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    const posClamped = computeButtonPosition(target);
    expect(posClamped.x).toBe(768); // 800 - 24 - 8
    expect(posClamped.y).toBe(4);
    Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, configurable: true });

    // Negative left -> clamps X to minimum
    target.getBoundingClientRect = () => ({
      left: -1000,
      top: 10,
      width: 50,
      height: 50,
      right: -950,
      bottom: 60,
      x: -1000,
      y: 10,
      toJSON: () => {},
    });
    const posLeftClamped = computeButtonPosition(target);
    expect(posLeftClamped.x).toBe(4);

    // Clamps when window.innerWidth is 0 (falling back to documentElement.clientWidth)
    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 800,
      configurable: true,
    });
    const posFallback = computeButtonPosition(target);
    expect(posFallback.x).toBe(4);
    Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, configurable: true });

    // queryAllDeep with non-HTMLElement (SVG)
    const svgContainer = document.createElement('div');
    svgContainer.innerHTML = '<svg class="item"><circle></circle></svg><div class="item"></div>';
    const deepItems = queryAllDeep(svgContainer, '.item');
    expect(deepItems.length).toBe(1);
  });
});

describe('PII Utilities (src/common/utils/pii.ts)', () => {
  it('should handle edge cases in Luhn validation and scrubbing', () => {
    expect(isValidLuhn('')).toBe(false);
    expect(isValidLuhn('18')).toBe(false); // short 2-digit number that passes Luhn formula
    expect(isValidLuhn('123')).toBe(false);
    expect(isValidLuhn('12345678901234567890')).toBe(false); // 20 digits
    expect(isValidLuhn('40000000000000000002')).toBe(false); // 20 digits that would pass Luhn if not bounded
    expect(isValidLuhn('0000000000000')).toBe(false); // all zeros
    expect(isValidLuhn('4000000000006')).toBe(true); // 13-digit valid card boundary
    expect(isValidLuhn('4000000000000000006')).toBe(true); // 19-digit valid card boundary

    // Test digit doubling boundary: 4 (doubles to 8) vs 5 (doubles to 10 - 9 = 1)
    expect(isValidLuhn('4000000000048')).toBe(true); // contains digit 4 in doubled position
    expect(isValidLuhn('4000000000055')).toBe(true); // contains digit 5 in doubled position

    expect(scrubSensitiveData('')).toBe('');
    expect(scrubSensitiveData(null as any)).toBe(null);
    expect(scrubSensitiveData(undefined as any)).toBe(undefined);

    // CVV/CVC and card code variations
    expect(scrubSensitiveData('123', 'cvv')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'cvc')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'cid')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'security_code')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'securitycode')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'card_code')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'cardcode')).toBe('[REDACTED CVV]');

    expect(scrubSensitiveData('Random text with no cards')).toBe('Random text with no cards');
    expect(scrubSensitiveData('Invalid card pattern: 4532015112830367')).toContain(
      '4532015112830367'
    );
  });

  it('should validate and redact valid credit card numbers', () => {
    // Valid test card numbers
    expect(isValidLuhn('4532015112830366')).toBe(true);
    expect(isValidLuhn('4532-0151-1283-0366')).toBe(true);
    expect(isValidLuhn('4242424242424242')).toBe(true);

    // Redacts valid credit card in text
    expect(scrubSensitiveData('My card is 4532-0151-1283-0366 here')).toBe(
      'My card is [REDACTED CREDIT CARD] here'
    );
  });
});

describe('Version Utilities (src/common/utils/version.ts)', () => {
  it('retrieves extension version from chrome.runtime.getManifest() or fallback', () => {
    // 1. Manifest version available
    (chrome.runtime as any).getManifest = vi.fn().mockReturnValue({ version: '2.5.0' });
    expect(getExtensionVersion()).toBe('2.5.0');

    // 2. Manifest without version
    (chrome.runtime as any).getManifest = vi.fn().mockReturnValue({});
    expect(getExtensionVersion()).toBe('0.0.1');

    // 2b. Manifest is null (kills mutant 11)
    (chrome.runtime as any).getManifest = vi.fn().mockReturnValue(null);
    expect(getExtensionVersion()).toBe('0.0.1');

    // 3. getManifest undefined
    const orig = chrome.runtime.getManifest;
    delete (chrome.runtime as any).getManifest;
    expect(getExtensionVersion()).toBe('0.0.1');
    chrome.runtime.getManifest = orig;

    // 4. chrome.runtime undefined (kills mutant 7)
    const origRuntime = chrome.runtime;
    delete (chrome as any).runtime;
    expect(getExtensionVersion()).toBe('0.0.1');
    (chrome as any).runtime = origRuntime;

    // 5. global chrome undefined (kills mutant 4)
    const origChrome = (globalThis as any).chrome;
    delete (globalThis as any).chrome;
    expect(getExtensionVersion()).toBe('0.0.1');
    (globalThis as any).chrome = origChrome;
  });
});

describe('Configuration Defaults (src/common/types/config.ts)', () => {
  it('exports strictly defined default settings', async () => {
    vi.resetModules();
    const config = await import('../../src/common/types/config');
    expect(config.DEFAULT_SETTINGS).toEqual({
      savePasswords: false,
      filterCreditCards: true,
      expireFormsInterval: 10,
      autoLockMinutes: 15,
      encryptionMode: 'none',
      disabledDomains: [],
    });
    expect(config.DEFAULT_SETTINGS.savePasswords).toBe(false);
    expect(config.DEFAULT_SETTINGS.filterCreditCards).toBe(true);
    expect(config.DEFAULT_SETTINGS.disabledDomains).toEqual([]);
    expect(config.DEFAULT_SETTINGS.disabledDomains).toHaveLength(0);
  });
});
