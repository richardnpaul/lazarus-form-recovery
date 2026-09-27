/**
 * Lazarus Localisation & Internationalisation (i18n/l10n) Engine
 * Provides typed WebExtension message extraction, standard Intl API formatting,
 * and Bi-directional (RTL/LTR) layout adaptation helpers.
 */

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'syr', 'ku']);

/**
 * Retrieves a translated message from the browser's WebExtension catalog.
 * Gracefully falls back to fallback text or key name if missing.
 */
export function getMessage(
  key: string,
  substitutions?: string | string[],
  fallback?: string
): string {
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    const msg = chrome.i18n.getMessage(key, substitutions as any);
    if (msg) {
      return msg;
    }
  }

  const template = fallback !== undefined ? fallback : key;
  if (!substitutions) {
    return template;
  }

  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  let res = template;
  subs.forEach((sub, idx) => {
    res = res.replace(new RegExp(`\\$${idx + 1}`, 'g'), sub);
  });
  return res;
}

/**
 * Returns the current UI language (e.g., 'en-GB', 'en-US', 'ar', 'de').
 */
export function getUILanguage(): string {
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    const lang = chrome.i18n.getUILanguage();
    if (lang) return lang;
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-GB';
}

/**
 * Normalizes locale tags by replacing underscores with hyphens.
 */
export function normalizeLocale(locale?: string): string {
  const loc = locale || getUILanguage();
  return loc.replace(/_/g, '-');
}

/**
 * Checks whether the given or active UI locale is Right-to-Left (RTL).
 */
export function isRTL(locale?: string): boolean {
  if (!locale && typeof chrome !== 'undefined' && chrome.i18n) {
    const bidiDir = chrome.i18n.getMessage('@@bidi_dir');
    if (bidiDir === 'rtl') return true;
    if (bidiDir === 'ltr') return false;
  }

  const lang = (locale || getUILanguage()).toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(lang);
}

/**
 * Returns text direction: 'rtl' or 'ltr'.
 */
export function getDirection(locale?: string): 'rtl' | 'ltr' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

/**
 * Formats a relative timestamp (e.g., "just now", "5 minutes ago", "yesterday")
 * respecting cultural and regional conventions via Intl.RelativeTimeFormat.
 */
export function formatRelativeTime(timestamp: number, locale?: string): string {
  if (!timestamp || isNaN(timestamp)) {
    return getMessage('timeUnknown', undefined, 'Unknown time');
  }

  const loc = normalizeLocale(locale);
  const diffMs = timestamp - Date.now();
  const absDiff = Math.abs(diffMs);

  // Very recent (within 30 seconds)
  if (absDiff < 30000) {
    return getMessage('timeJustNow', undefined, 'just now');
  }

  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });

  // Minutes
  if (absDiff < 3600000) {
    const minutes = Math.round(diffMs / 60000);
    return rtf.format(minutes, 'minute');
  }

  // Hours
  if (absDiff < 86400000) {
    const hours = Math.round(diffMs / 3600000);
    return rtf.format(hours, 'hour');
  }

  // Days (up to 7 days)
  if (absDiff < 7 * 86400000) {
    const days = Math.round(diffMs / 86400000);
    return rtf.format(days, 'day');
  }

  // Older dates: format as localized date
  return new Intl.DateTimeFormat(loc, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Formats a numeric value according to the active locale conventions.
 */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale?: string
): string {
  try {
    return new Intl.NumberFormat(normalizeLocale(locale), options).format(value);
  } catch {
    return new Intl.NumberFormat('en-GB', options).format(value);
  }
}

/**
 * Formats storage consumption and quota footprint in megabytes (MB)
 * using localized number formatting.
 */
export function formatStorageFootprint(
  usageBytes: number,
  quotaBytes?: number,
  locale?: string
): { formattedUsage: string; formattedQuota: string } {
  const loc = normalizeLocale(locale);
  const usageMb = (usageBytes || 0) / (1024 * 1024);
  const quotaMb = quotaBytes ? quotaBytes / (1024 * 1024) : 0;

  const formattedUsage = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(usageMb);
  const formattedQuota = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(quotaMb);

  return { formattedUsage, formattedQuota };
}

/**
 * Returns the plural category ('one', 'other', 'few', etc.) for a number.
 */
export function getPluralCategory(count: number, locale?: string): Intl.LDMLPluralRule {
  try {
    const loc = normalizeLocale(locale);
    return new Intl.PluralRules(loc).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

/**
 * Formats a pluralized message safely with fallbacks.
 */
export function formatPluralMessage(
  baseKey: string,
  count: number,
  substitutions?: string[],
  locale?: string
): string {
  const loc = locale || getUILanguage();
  const category = getPluralCategory(count, loc);
  const formattedCount = formatNumber(count, undefined, loc);
  const subs = substitutions ? [formattedCount, ...substitutions] : [formattedCount];

  const candidateKeys = Array.from(
    new Set([`${baseKey}_${category}`, `${baseKey}_other`, baseKey])
  );

  for (const key of candidateKeys) {
    // Pass '' as fallback so missing keys return empty string, NOT raw key name!
    const msg = getMessage(key, subs, '');
    if (msg) {
      return msg.replace(/\$COUNT\$/gi, formattedCount);
    }
  }

  return `${formattedCount} ${baseKey}`;
}

/**
 * Automatically walks and localizes DOM elements using declarative attributes:
 * - `data-i18n`: sets textContent
 * - `data-i18n-placeholder`: sets placeholder
 * - `data-i18n-title`: sets title
 * - `data-i18n-aria-label`: sets aria-label
 * Also applies dir="rtl"|"ltr" and lang to document or container.
 */
export function localizeDocument(root?: Document | HTMLElement): void {
  if (!root && typeof document === 'undefined') return;
  const target = root || document;

  const docEl =
    target instanceof Document ? target.documentElement : target.ownerDocument?.documentElement;
  if (docEl) {
    const dir = getDirection();
    const lang = getUILanguage();
    docEl.setAttribute('dir', dir);
    docEl.setAttribute('lang', lang);
  }

  const container = target instanceof Document ? target.body || target.documentElement : target;
  if (!container) return;

  // 1. Text content
  const textElements = container.querySelectorAll<HTMLElement>('[data-i18n]');
  textElements.forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const msg = getMessage(key, undefined, '');
      if (msg) el.textContent = msg;
    }
  });

  // 2. Placeholders
  const placeholderElements = container.querySelectorAll<HTMLElement>('[data-i18n-placeholder]');
  placeholderElements.forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const msg = getMessage(key, undefined, '');
      if (msg) el.setAttribute('placeholder', msg);
    }
  });

  // 3. Titles
  const titleElements = container.querySelectorAll<HTMLElement>('[data-i18n-title]');
  titleElements.forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const msg = getMessage(key, undefined, '');
      if (msg) el.setAttribute('title', msg);
    }
  });

  // 4. Aria labels
  const ariaLabelElements = container.querySelectorAll<HTMLElement>('[data-i18n-aria-label]');
  ariaLabelElements.forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      const msg = getMessage(key, undefined, '');
      if (msg) el.setAttribute('aria-label', msg);
    }
  });
}
