import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

const catalogs: Record<string, Record<string, any>> = {};

function getCatalog(locale: string): Record<string, any> {
  const normalized = locale.replace('-', '_');
  if (catalogs[normalized]) return catalogs[normalized];

  let p = path.resolve(__dirname, `../../public/_locales/${normalized}/messages.json`);
  if (!fs.existsSync(p)) {
    const base = normalized.split('_')[0];
    p = path.resolve(__dirname, `../../public/_locales/${base}/messages.json`);
  }

  if (fs.existsSync(p)) {
    catalogs[normalized] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else {
    catalogs[normalized] = {};
  }
  return catalogs[normalized];
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'syr', 'ku']);

export async function withLocale<T>(locale: string, fn: () => T | Promise<T>): Promise<T> {
  const origGetMessage = chrome.i18n.getMessage;
  const origGetUILang = chrome.i18n.getUILanguage;

  const primary = getCatalog(locale);
  const enCatalog = getCatalog('en');

  (chrome.i18n.getUILanguage as any) = vi.fn(() => locale);
  (chrome.i18n.getMessage as any) = vi.fn((key: string, substitutions?: string | string[]) => {
    if (key === '@@bidi_dir') {
      const lang = locale.toLowerCase().split(/[-_]/)[0];
      return RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
    }

    const entry = primary[key] || enCatalog[key];
    if (!entry) return '';

    let msg = entry.message;
    if (substitutions) {
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
      const placeholders = entry.placeholders || enCatalog[key]?.placeholders;
      if (placeholders) {
        for (const p in placeholders) {
          const content = placeholders[p].content;
          const indexMatch = content.match(/\$(\d+)/);
          if (indexMatch) {
            const idx = parseInt(indexMatch[1], 10) - 1;
            if (subs[idx] !== undefined) {
              msg = msg.replace(new RegExp(`\\$${p}\\$`, 'gi'), subs[idx]);
            }
          }
        }
      }
      subs.forEach((sub, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), sub);
      });
    }
    return msg;
  });

  try {
    return await fn();
  } finally {
    chrome.i18n.getMessage = origGetMessage;
    chrome.i18n.getUILanguage = origGetUILang;
  }
}
