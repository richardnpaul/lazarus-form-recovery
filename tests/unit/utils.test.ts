import { describe, it, expect } from 'vitest';
import { formatTimeAgo, computeWordCount, sanitizePreview, computeSimpleDiff } from '../../src/common/utils/text';
import { escapeCss, getElementSelector, computeButtonPosition } from '../../src/common/utils/dom';
import { isValidLuhn, scrubSensitiveData } from '../../src/common/utils/pii';

describe('Text Utilities (src/common/utils/text.ts)', () => {
  it('should format relative timestamps correctly', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 10000)).toBe('Just now');
    expect(formatTimeAgo(now - 120000)).toBe('2m ago');
    expect(formatTimeAgo(now - 7200000)).toBe('2h ago');
    expect(formatTimeAgo(now - 90000000)).toBe('Yesterday');
    expect(formatTimeAgo(now - 500000000)).toBe(new Date(now - 500000000).toLocaleDateString());
  });

  it('should compute word count accurately', () => {
    expect(computeWordCount('')).toBe(0);
    expect(computeWordCount('   ')).toBe(0);
    expect(computeWordCount('Hello world')).toBe(2);
    expect(computeWordCount('  One   two   three  ')).toBe(3);
  });

  it('should sanitize and preview text', () => {
    expect(sanitizePreview('')).toBe('');
    expect(sanitizePreview('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
    expect(sanitizePreview('Short text', 50)).toBe('Short text');
    expect(sanitizePreview('This is a very long sentence that exceeds length', 10)).toBe('This is a ...');
  });

  it('should compute diffs between identical and divergent texts', () => {
    // Identical
    const identical = computeSimpleDiff('hello world', 'hello world');
    expect(identical).toEqual([{ type: 'unchanged', value: 'hello world' }]);

    // Divergent
    const diff = computeSimpleDiff('the quick brown fox', 'the fast brown dog');
    expect(diff.length).toBeGreaterThan(1);
    expect(diff.some(d => d.type === 'removed')).toBe(true);
    expect(diff.some(d => d.type === 'added')).toBe(true);

    // Completely different
    const diff2 = computeSimpleDiff('apple', 'banana');
    expect(diff2.length).toBeGreaterThanOrEqual(2);

    // Extra tokens on old
    const diff3 = computeSimpleDiff('one two three', 'one');
    expect(diff3.some(d => d.type === 'removed')).toBe(true);

    // Extra tokens on new
    const diff4 = computeSimpleDiff('one', 'one two three');
    expect(diff4.some(d => d.type === 'added')).toBe(true);
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
    (globalThis as any).CSS = originalCss;
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
    expect(posInternal.placement).toBe('internal');
    expect(posInternal.x).toBeGreaterThan(0);

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
    expect(posExternal.placement).toBe('external');

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

    const posClamped = computeButtonPosition(target);
    expect(posClamped.y).toBe(4);

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
  });
});

describe('PII Utilities (src/common/utils/pii.ts)', () => {
  it('should handle edge cases in Luhn validation and scrubbing', () => {
    expect(isValidLuhn('')).toBe(false);
    expect(isValidLuhn('123')).toBe(false);
    expect(isValidLuhn('12345678901234567890')).toBe(false); // 20 digits

    expect(scrubSensitiveData('')).toBe('');
    expect(scrubSensitiveData('123', 'cvv')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('123', 'security_code')).toBe('[REDACTED CVV]');
    expect(scrubSensitiveData('Random text with no cards')).toBe('Random text with no cards');
    expect(scrubSensitiveData('Invalid card pattern: 4532015112830367')).toContain('4532015112830367');
  });
});
