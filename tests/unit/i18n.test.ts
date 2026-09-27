import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMessage,
  getUILanguage,
  getDirection,
  isRTL,
  formatRelativeTime,
  formatNumber,
  formatStorageFootprint,
  getPluralCategory,
  localizeDocument,
  normalizeLocale,
  formatPluralMessage,
} from '../../src/common/utils/i18n';

describe('i18n Localisation Module (src/common/utils/i18n.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeLocale', () => {
    it('converts underscores to hyphens in locale tags', () => {
      expect(normalizeLocale('zh_CN')).toBe('zh-CN');
      expect(normalizeLocale('en_US')).toBe('en-US');
      expect(normalizeLocale('ar')).toBe('ar');
      expect(normalizeLocale()).toBeDefined();
    });
  });

  describe('getMessage', () => {
    it('returns translated message from chrome.i18n.getMessage when available', () => {
      const mockGetMessage = vi.fn().mockReturnValue('Lazarus Form Recovery');
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: mockGetMessage,
          getUILanguage: () => 'en',
        },
      };

      const result = getMessage('extensionName');
      expect(mockGetMessage).toHaveBeenCalledWith('extensionName', undefined);
      expect(result).toBe('Lazarus Form Recovery');
    });

    it('returns fallback or key when chrome.i18n.getMessage returns empty string or is unavailable', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn().mockReturnValue(''),
          getUILanguage: () => 'en',
        },
      };

      expect(getMessage('unknownKey', undefined, 'Default Fallback')).toBe('Default Fallback');
      expect(getMessage('unknownKey')).toBe('unknownKey');
    });

    it('passes substitutions array to chrome.i18n.getMessage', () => {
      const mockGetMessage = vi.fn().mockReturnValue('5 drafts recovered');
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: mockGetMessage,
          getUILanguage: () => 'en',
        },
      };

      const result = getMessage('draftsRecoveredCount', ['5']);
      expect(mockGetMessage).toHaveBeenCalledWith('draftsRecoveredCount', ['5']);
      expect(result).toBe('5 drafts recovered');
    });

    it('performs manual substitution if chrome.i18n is not present and fallback contains placeholders', () => {
      const origI18n = (globalThis as any).chrome?.i18n;
      delete (globalThis as any).chrome.i18n;

      const result = getMessage('draftsCount', ['42'], '$1 drafts saved');
      expect(result).toBe('42 drafts saved');
      expect(getMessage('draftsCount', '42', '$1 drafts saved')).toBe('42 drafts saved');

      (globalThis as any).chrome.i18n = origI18n;
    });
  });

  describe('Locale & Bi-directional Detection', () => {
    it('returns UI language from chrome.i18n.getUILanguage or fallback to navigator.language', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn(),
          getUILanguage: () => 'en-GB',
        },
      };

      expect(getUILanguage()).toBe('en-GB');
    });

    it('falls back to navigator.language when chrome.i18n is not present', () => {
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;
      const origNav = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: 'fr' },
        configurable: true,
      });

      expect(getUILanguage()).toBe('fr');

      Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
      (globalThis as any).chrome = origChrome;
    });

    it('falls back to en-GB when chrome.i18n is missing and navigator.language is empty', () => {
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;
      const origNav = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: '' },
        configurable: true,
      });

      expect(getUILanguage()).toBe('en-GB');

      Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
      (globalThis as any).chrome = origChrome;
    });

    it('falls back to navigator.language when chrome.i18n.getUILanguage returns empty string', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn(),
          getUILanguage: () => '',
        },
      };
      const origNav = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: 'de' },
        configurable: true,
      });
      expect(getUILanguage()).toBe('de');
      Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
    });

    it('detects RTL direction via chrome @@bidi_dir or language code', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: (key: string) => (key === '@@bidi_dir' ? 'rtl' : ''),
          getUILanguage: () => 'ar',
        },
      };

      expect(getDirection()).toBe('rtl');
      expect(isRTL()).toBe(true);
    });

    it('detects LTR direction for English and German', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: (key: string) => (key === '@@bidi_dir' ? 'ltr' : ''),
          getUILanguage: () => 'en-US',
        },
      };

      expect(getDirection()).toBe('ltr');
      expect(isRTL()).toBe(false);
      expect(isRTL('ar')).toBe(true);
      expect(isRTL('en')).toBe(false);
    });

    it('identifies RTL language codes even when @@bidi_dir is unavailable', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: () => '',
          getUILanguage: () => 'he',
        },
      };

      expect(isRTL('he')).toBe(true);
      expect(isRTL('fa')).toBe(true);
      expect(isRTL('ur')).toBe(true);
      expect(isRTL('en')).toBe(false);
    });

    it('identifies RTL language codes when chrome is undefined', () => {
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;
      expect(isRTL('ar')).toBe(true);
      expect(isRTL('en')).toBe(false);
      (globalThis as any).chrome = origChrome;
    });
  });

  describe('formatRelativeTime', () => {
    it('formats recent timestamps using Intl.RelativeTimeFormat or just now', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 10000, 'en')).toMatch(/just now|seconds ago/i);
      expect(formatRelativeTime(now - 5 * 60 * 1000, 'en')).toMatch(/5 minutes ago/i);
      expect(formatRelativeTime(now - 2 * 3600 * 1000, 'en')).toMatch(/2 hours ago/i);
      expect(formatRelativeTime(now - 26 * 3600 * 1000, 'en')).toMatch(/yesterday|1 day ago/i);
    });

    it('formats timestamps older than 7 days with localized date', () => {
      const oldTime = new Date('2025-01-15T12:00:00Z').getTime();
      const formattedEn = formatRelativeTime(oldTime, 'en-US');
      expect(formattedEn).toMatch(/2025|Jan/);
    });
    it('returns getMessage(timeUnknown) when timestamp is falsy or NaN', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn(() => ''),
          getUILanguage: () => 'en',
        },
      };
      expect(formatRelativeTime(0 as any)).toBe('Unknown time');
      expect(formatRelativeTime(NaN)).toBe('Unknown time');
      expect(formatRelativeTime(null as any)).toBe('Unknown time');
      expect(formatRelativeTime(undefined as any)).toBe('Unknown time');
    });

    it('normalizes underscored locales without throwing RangeError', () => {
      const now = Date.now();
      expect(() => formatRelativeTime(now - 10000, 'zh_CN')).not.toThrow(RangeError);
    });
  });

  describe('formatNumber & formatStorageFootprint', () => {
    it('formats numbers according to locale conventions', () => {
      const num = 1234567.89;
      const formattedEn = formatNumber(num, { minimumFractionDigits: 2 }, 'en-US');
      expect(formattedEn).toBe('1,234,567.89');

      const formattedDe = formatNumber(num, { minimumFractionDigits: 2 }, 'de-DE');
      expect(formattedDe).toBe('1.234.567,89');
    });

    it('formats storage footprint in MB with localized numbers', () => {
      const bytes = 15.5 * 1024 * 1024;
      const quotaBytes = 500 * 1024 * 1024;
      const { formattedUsage, formattedQuota } = formatStorageFootprint(bytes, quotaBytes, 'en-US');
      expect(formattedUsage).toBe('15.5');
      expect(formattedQuota).toBe('500');
    });

    it('normalizes underscored locales without throwing RangeError', () => {
      expect(() => formatNumber(1000, undefined, 'zh_CN')).not.toThrow(RangeError);
    });

    it('falls back gracefully to en-GB if invalid locale passed', () => {
      const formattedInvalid = formatNumber(1234.56, undefined, 'invalid_locale_xyz_123');
      expect(formattedInvalid).toBe('1,234.56'); // en-GB format
    });

    it('handles zero or missing usage and quota bytes in formatStorageFootprint', () => {
      const { formattedUsage, formattedQuota } = formatStorageFootprint(0, undefined, 'en-GB');
      expect(formattedUsage).toBe('0');
      expect(formattedQuota).toBe('0');
    });
  });

  describe('getPluralCategory', () => {
    it('returns singular or plural category according to Intl.PluralRules', () => {
      expect(getPluralCategory(1, 'en')).toBe('one');
      expect(getPluralCategory(2, 'en')).toBe('other');
      expect(getPluralCategory(0, 'en')).toBe('other');
    });

    it('normalizes underscores to hyphens without throwing RangeError', () => {
      expect(() => getPluralCategory(1, 'zh_CN')).not.toThrow(RangeError);
    });

    it('falls back to (count === 1 ? one : other) when invalid locale is provided', () => {
      expect(getPluralCategory(1, 'invalid_locale_xyz_123')).toBe('one');
      expect(getPluralCategory(5, 'invalid_locale_xyz_123')).toBe('other');
    });
  });

  describe('formatPluralMessage', () => {
    it('replaces $COUNT$ via substitution or inline token and falls back to _other if category key missing', () => {
      const mockDict: Record<string, string> = {
        draftCount_one: '1 draft',
      };

      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn((key: string, subs?: any) => {
            let msg = mockDict[key] || '';
            if (msg && subs) {
              const arr = Array.isArray(subs) ? subs : [subs];
              arr.forEach((s: any, i: number) => {
                msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), String(s));
              });
            }
            return msg;
          }),
          getUILanguage: () => 'en',
        },
      };

      // Exists: _one
      expect(formatPluralMessage('draftCount', 1)).toBe('1 draft');
      // Missing: _other, should fallback to `count baseKey`
      expect(formatPluralMessage('draftCount', 2)).toBe('2 draftCount');

      // Now add missing keys
      mockDict['draftCount_other'] = '$COUNT$ drafts saved $2';
      expect(formatPluralMessage('draftCount', 5, ['extra'])).toBe('5 drafts saved extra');
    });

    it('validates 6-form Arabic plural rules', () => {
      const arDict: Record<string, string> = {
        arCount_zero: '0 مسودة',
        arCount_one: 'مسودة واحدة',
        arCount_two: 'مسودتان',
        arCount_few: '$COUNT$ مسودات',
        arCount_many: '$COUNT$ مسودة',
        arCount_other: '$COUNT$ مسودة',
      };

      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: vi.fn((key: string) => arDict[key] || ''),
          getUILanguage: () => 'ar',
        },
      };

      expect(formatPluralMessage('arCount', 0, undefined, 'ar')).toBe('0 مسودة');
      expect(formatPluralMessage('arCount', 1, undefined, 'ar')).toBe('مسودة واحدة');
      expect(formatPluralMessage('arCount', 2, undefined, 'ar')).toBe('مسودتان');
      expect(formatPluralMessage('arCount', 3, undefined, 'ar')).toBe('3 مسودات');
      expect(formatPluralMessage('arCount', 11, undefined, 'ar')).toBe('11 مسودة');
      expect(formatPluralMessage('arCount', 100, undefined, 'ar')).toBe('100 مسودة');
    });
  });

  describe('localizeDocument', () => {
    it('populates data-i18n text, placeholder, title, and aria-label attributes and sets document dir/lang', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: (key: string) => {
            const table: Record<string, string> = {
              '@@bidi_dir': 'ltr',
              headerTitle: 'Lazarus Settings',
              searchPlaceholder: 'Search items...',
              btnTitle: 'Click to submit',
              btnAriaLabel: 'Submit form action',
            };
            return table[key] || '';
          },
          getUILanguage: () => 'en-GB',
        },
      };

      const container = document.createElement('div');
      container.innerHTML = `
        <h1 data-i18n="headerTitle">Original</h1>
        <input data-i18n-placeholder="searchPlaceholder" placeholder="original" />
        <button data-i18n-title="btnTitle" data-i18n-aria-label="btnAriaLabel" title="orig" aria-label="orig">Go</button>
      `;

      localizeDocument(container);

      const h1 = container.querySelector('h1');
      const input = container.querySelector('input');
      const btn = container.querySelector('button');

      expect(h1?.textContent).toBe('Lazarus Settings');
      expect(input?.getAttribute('placeholder')).toBe('Search items...');
      expect(btn?.getAttribute('title')).toBe('Click to submit');
      expect(btn?.getAttribute('aria-label')).toBe('Submit form action');
    });

    it('sets dir="rtl" on document element when locale is RTL', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: (key: string) => (key === '@@bidi_dir' ? 'rtl' : ''),
          getUILanguage: () => 'ar',
        },
      };

      const doc = document.implementation.createHTMLDocument();
      localizeDocument(doc);

      expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
      expect(doc.documentElement.getAttribute('lang')).toBe('ar');
    });

    it('handles empty or missing translation keys and preserves existing values', () => {
      (globalThis as any).chrome = {
        ...globalThis.chrome,
        i18n: {
          getMessage: () => '',
          getUILanguage: () => 'en-GB',
        },
      };

      const container = document.createElement('div');
      container.innerHTML = `
        <h1 data-i18n="missingKey">Keep</h1>
        <h2 data-i18n="">Keep2</h2>
        <input data-i18n-placeholder="missingPlaceholder" placeholder="keep-holder" />
        <input data-i18n-placeholder="" placeholder="keep-holder2" />
        <button data-i18n-title="missingTitle" title="keep-title">Button</button>
        <button data-i18n-title="" title="keep-title2">Button2</button>
        <span data-i18n-aria-label="missingAria" aria-label="keep-aria">Span</span>
        <span data-i18n-aria-label="" aria-label="keep-aria2">Span2</span>
      `;

      localizeDocument(container);

      expect(container.querySelector('h1')?.textContent).toBe('Keep');
      expect(container.querySelector('h2')?.textContent).toBe('Keep2');
      expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('keep-holder');
      expect(container.querySelector('button')?.getAttribute('title')).toBe('keep-title');
      expect(container.querySelector('span')?.getAttribute('aria-label')).toBe('keep-aria');
    });

    it('covers root fallbacks, document element fallbacks, and missing container', () => {
      // 1. localizeDocument() without arguments uses default document
      localizeDocument();

      // 2. target Document with null body falls back to documentElement
      const mockDoc = document.implementation.createHTMLDocument();
      Object.defineProperty(mockDoc, 'body', { value: null, configurable: true });
      localizeDocument(mockDoc);

      // 3. target Document with null body and null documentElement returns early
      const nullContainerDoc = document.implementation.createHTMLDocument();
      Object.defineProperty(nullContainerDoc, 'body', { value: null, configurable: true });
      Object.defineProperty(nullContainerDoc, 'documentElement', {
        value: null,
        configurable: true,
      });
      localizeDocument(nullContainerDoc);

      // 4. !root and document is undefined returns early
      const origDoc = globalThis.document;
      delete (globalThis as any).document;
      try {
        localizeDocument();
      } finally {
        globalThis.document = origDoc;
      }
    });
  });

  describe('i18n Mutation Killer Suite', () => {
    it('kills RTL_LANGUAGES set mutants for all supported RTL languages', () => {
      expect(isRTL('yi')).toBe(true);
      expect(isRTL('ps')).toBe(true);
      expect(isRTL('sd')).toBe(true);
      expect(isRTL('ug')).toBe(true);
      expect(isRTL('syr')).toBe(true);
      expect(isRTL('ku')).toBe(true);
    });

    it('kills isRTL bidiDir and exception mutants', () => {
      // 1. bidiDir === 'rtl' with English UI returns true
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => (key === '@@bidi_dir' ? 'rtl' : '')),
          getUILanguage: () => 'en',
        },
      };
      expect(isRTL()).toBe(true);

      // 2. bidiDir === 'ltr' with Arabic UI returns false
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => (key === '@@bidi_dir' ? 'ltr' : '')),
          getUILanguage: () => 'ar',
        },
      };
      expect(isRTL()).toBe(false);

      // 3. Explicit locale overrides bidiDir
      expect(isRTL('ar')).toBe(true);

      // 5. bidiDir === '' with Arabic UI falls through to return true
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn(() => ''),
          getUILanguage: () => 'ar',
        },
      };
      expect(isRTL()).toBe(true);
    });

    it('kills getMessage multi-occurrence regex flag mutant', () => {
      const origI18n = (globalThis as any).chrome?.i18n;
      delete (globalThis as any).chrome.i18n;

      const result = getMessage('testKey', ['42'], '$1 items out of $1 total');
      expect(result).toBe('42 items out of 42 total');

      (globalThis as any).chrome.i18n = origI18n;
    });

    it('kills getUILanguage missing navigator and missing chrome mutants', () => {
      // 1. chrome is undefined and navigator is undefined falls back to 'en-GB'
      const origChrome = (globalThis as any).chrome;
      delete (globalThis as any).chrome;

      const origNav = (globalThis as any).navigator;
      delete (globalThis as any).navigator;

      expect(getUILanguage()).toBe('en-GB');

      (globalThis as any).navigator = origNav;
      (globalThis as any).chrome = origChrome;
    });

    it('kills formatRelativeTime boundary and auto numeric mutants', () => {
      // 1. Unknown time fallback when chrome.i18n.getMessage returns empty
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn(() => ''),
          getUILanguage: () => 'en-GB',
        },
      };
      expect(formatRelativeTime(NaN)).toBe('Unknown time');

      // 1b. Unknown time translation returned from chrome.i18n.getMessage
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => (key === 'timeUnknown' ? 'Time Not Known' : '')),
          getUILanguage: () => 'en-GB',
        },
      };
      expect(formatRelativeTime(NaN)).toBe('Time Not Known');

      // Use fake timers to eliminate any millisecond drift during boundary assertions
      vi.useFakeTimers();
      vi.setSystemTime(1000000000000);
      const now = Date.now();

      // 2. Exact 30 second boundary (30000ms): 29999ms is just now, 30000ms is this minute (not just now)
      expect(formatRelativeTime(now - 29999, 'en-GB')).toBe('just now');
      expect(formatRelativeTime(now - 30000, 'en-GB')).toBe('this minute');

      // 3. Exact 1 hour boundary (3600000ms): 3599999ms is 60 minutes ago, 3600000ms is 1 hour ago
      expect(formatRelativeTime(now - 3599999, 'en-GB')).toBe('60 minutes ago');
      expect(formatRelativeTime(now - 3600000, 'en-GB')).toBe('1 hour ago');

      // 4. Exact 24 hours boundary (86400000ms): 86399999ms is 24 hours ago, 86400000ms is yesterday
      expect(formatRelativeTime(now - 86399999, 'en-GB')).toBe('24 hours ago');
      expect(formatRelativeTime(now - 86400000, 'en-GB')).toBe('yesterday');

      // 5. Exact 7 days boundary (604800000ms): 604799999ms is 7 days ago, 604800000ms is localized date
      expect(formatRelativeTime(now - 604799999, 'en-GB')).toBe('7 days ago');
      const dateStr = formatRelativeTime(now - 604800000, 'en-GB');
      expect(dateStr).not.toBe('7 days ago');
      expect(dateStr).toMatch(/[A-Za-z]/); // short month name letters e.g. Sep

      vi.useRealTimers();
    });

    it('kills formatStorageFootprint rounding mutants', () => {
      const res1 = formatStorageFootprint(1.25 * 1024 * 1024, 0, 'en-GB');
      expect(res1.formattedUsage).toBe('1.3'); // max 1 fraction digit

      const res2 = formatStorageFootprint(0, 10.5 * 1024 * 1024, 'en-GB');
      expect(res2.formattedQuota).toBe('11'); // max 0 fraction digits
    });

    it('kills formatPluralMessage locale and extra substitutions mutants', () => {
      // 1. Explicit locale passed to formatPluralMessage (Arabic 0 is category 'zero')
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => {
            if (key === 'items_zero') return 'صفر عنصر';
            return '';
          }),
          getUILanguage: () => 'en-GB',
        },
      };
      const arMsg = formatPluralMessage('items', 0, undefined, 'ar');
      expect(arMsg).toBe('صفر عنصر');

      // 2. Extra substitutions preserved in candidate lookups
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string, subs?: any[]) => {
            if (key === 'item_one') return `${subs?.[0]} saved by ${subs?.[1]}`;
            return '';
          }),
          getUILanguage: () => 'en-GB',
        },
      };
      expect(formatPluralMessage('item', 1, ['Alice'])).toBe('1 saved by Alice');

      // 3. Fallback to candidate _other when _one is missing
      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string, subs?: any[]) => {
            if (key === 'fallbackOther_other') return `${subs?.[0]} items`;
            return '';
          }),
          getUILanguage: () => 'en-GB',
        },
      };
      expect(formatPluralMessage('fallbackOther', 1)).toBe('1 items');
    });

    it('kills localizeDocument null ownerDocument and null body mutants', () => {
      // 1. Element with null ownerDocument
      const mockEl = {
        getAttribute: () => null,
        querySelectorAll: () => [],
        ownerDocument: null,
      };
      expect(() => localizeDocument(mockEl as any)).not.toThrow();

      // 2. Document with null body uses documentElement
      const mockDoc = document.implementation.createHTMLDocument();
      Object.defineProperty(mockDoc, 'body', { value: null, configurable: true });
      const heading = mockDoc.createElement('h1');
      heading.setAttribute('data-i18n', 'testKey');
      mockDoc.documentElement.appendChild(heading);

      (globalThis as any).chrome = {
        i18n: {
          getMessage: vi.fn((key: string) => (key === 'testKey' ? 'Translated Heading' : '')),
          getUILanguage: () => 'en-GB',
        },
      };

      localizeDocument(mockDoc);
      expect(heading.textContent).toBe('Translated Heading');
    });
  });
});
