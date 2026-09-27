import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

const EN_CATALOG_PATH = path.resolve(__dirname, '../../public/_locales/en/messages.json');
const SRC_DIR = path.resolve(__dirname, '../../src');
const MANIFEST_CONFIG_PATH = path.resolve(__dirname, '../../manifest.config.ts');

function walkDir(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      walkDir(filePath, fileList);
    } else {
      if (filePath.endsWith('.ts') || filePath.endsWith('.html')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

describe('L10n Catalog Integrity', () => {
  let enCatalog: any;
  let sourceFiles: string[] = [];

  beforeAll(() => {
    const rawData = fs.readFileSync(EN_CATALOG_PATH, 'utf-8');
    enCatalog = JSON.parse(rawData);
    sourceFiles = walkDir(SRC_DIR);
    if (fs.existsSync(MANIFEST_CONFIG_PATH)) {
      sourceFiles.push(MANIFEST_CONFIG_PATH);
    }
  });

  it('contains optionsWipeConfirmKeyword in en catalog and it is not empty', () => {
    expect(enCatalog.optionsWipeConfirmKeyword).toBeDefined();
    expect(enCatalog.optionsWipeConfirmKeyword.message.trim().length).toBeGreaterThan(0);
  });

  it('contains all required reference locales and optionsWipeConfirmKeyword is defined and non-empty in each', () => {
    const requiredLocales = [
      'en',
      'en_US',
      'ar',
      'de',
      'zh_CN',
      'ja',
      'es',
      'es_419',
      'fr',
      'pt_PT',
      'pt_BR',
      'it',
      'nl',
      'pl',
      'ru',
      'uk',
      'cs',
      'sk',
      'ro',
      'bg',
      'hu',
      'el',
      'sv',
      'da',
      'fi',
      'no',
      'hr',
      'sr',
      'sl',
      'lt',
      'lv',
      'et',
      'ca',
      'tr',
      'he',
      'fa',
      'sw',
      'am',
      'af',
      'zu',
      'ha',
      'yo',
      'ig',
      'so',
    ];
    const localesDir = path.resolve(__dirname, '../../public/_locales');
    for (const locale of requiredLocales) {
      const catalogPath = path.join(localesDir, locale, 'messages.json');
      expect(fs.existsSync(catalogPath), `messages.json should exist for ${locale}`).toBe(true);
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      expect(
        catalog.optionsWipeConfirmKeyword,
        `optionsWipeConfirmKeyword must exist in ${locale}`
      ).toBeDefined();
      expect(
        catalog.optionsWipeConfirmKeyword.message.trim().length,
        `optionsWipeConfirmKeyword must not be empty in ${locale}`
      ).toBeGreaterThan(0);
    }
  });

  it('contains all canonical en keys in all complete European, Americas, Middle Eastern and African catalogs', () => {
    const fullLocales = [
      'de',
      'zh_CN',
      'ja',
      'ar',
      'es',
      'es_419',
      'fr',
      'pt_PT',
      'pt_BR',
      'it',
      'nl',
      'pl',
      'ru',
      'uk',
      'cs',
      'sk',
      'ro',
      'bg',
      'hu',
      'el',
      'sv',
      'da',
      'fi',
      'no',
      'hr',
      'sr',
      'sl',
      'lt',
      'lv',
      'et',
      'ca',
      'tr',
      'he',
      'fa',
      'sw',
      'am',
      'af',
      'zu',
      'ha',
      'yo',
      'ig',
      'so',
    ];
    const enKeys = Object.keys(enCatalog);
    const localesDir = path.resolve(__dirname, '../../public/_locales');
    for (const locale of fullLocales) {
      const catalogPath = path.join(localesDir, locale, 'messages.json');
      expect(fs.existsSync(catalogPath), `messages.json should exist for ${locale}`).toBe(true);
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      const missingKeys = enKeys.filter((k) => !catalog[k]);
      expect(missingKeys, `Missing keys in ${locale}`).toEqual([]);
    }
  });

  it('contains the required Hebrew plural forms (including _two) in the he catalog', () => {
    const heCatalogPath = path.resolve(__dirname, '../../public/_locales/he/messages.json');
    expect(fs.existsSync(heCatalogPath)).toBe(true);
    const heCatalog = JSON.parse(fs.readFileSync(heCatalogPath, 'utf-8'));
    const pluralBases = ['sidepanelDraftCount', 'shadowMenuDraftCount', 'shadowSnippetWordCount'];
    for (const base of pluralBases) {
      expect(heCatalog[`${base}_one`], `Hebrew catalog must contain ${base}_one`).toBeDefined();
      expect(heCatalog[`${base}_two`], `Hebrew catalog must contain ${base}_two`).toBeDefined();
      expect(heCatalog[`${base}_other`], `Hebrew catalog must contain ${base}_other`).toBeDefined();
    }
  });

  it('contains the 6 Arabic plural forms for plural keys in the ar catalog', () => {
    const arCatalogPath = path.resolve(__dirname, '../../public/_locales/ar/messages.json');
    expect(fs.existsSync(arCatalogPath)).toBe(true);
    const arCatalog = JSON.parse(fs.readFileSync(arCatalogPath, 'utf-8'));
    const pluralCategories = ['zero', 'one', 'two', 'few', 'many', 'other'];
    const pluralBases = ['sidepanelDraftCount', 'shadowMenuDraftCount', 'shadowSnippetWordCount'];
    for (const base of pluralBases) {
      for (const cat of pluralCategories) {
        const key = `${base}_${cat}`;
        expect(arCatalog[key], `Arabic catalog must contain ${key}`).toBeDefined();
        expect(arCatalog[key].message.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('does not define native keys starting with @@ in any catalog', () => {
    const localesDir = path.resolve(__dirname, '../../public/_locales');
    const locales = fs
      .readdirSync(localesDir)
      .filter((f) => fs.statSync(path.join(localesDir, f)).isDirectory());
    for (const locale of locales) {
      const catalogPath = path.join(localesDir, locale, 'messages.json');
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      const nativeKeys = Object.keys(catalog).filter((k) => k.startsWith('@@'));
      expect(nativeKeys, `native keys like @@bidi_dir must not be defined in ${locale}`).toEqual(
        []
      );
    }
  });

  it('contains all referenced getMessage keys in the en catalog', () => {
    const regex = /\bgetMessage\(\s*['"]([a-zA-Z0-9_@]+)['"]/g;
    const missingKeys = new Set<string>();

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1];
        // Ignore native WebExtension keys starting with @@
        if (key.startsWith('@@')) continue;

        if (!enCatalog[key]) {
          missingKeys.add(`${key} (found in ${path.basename(filePath)})`);
        }
      }
    }
    expect(Array.from(missingKeys)).toEqual([]);
  });

  it('contains all referenced formatPluralMessage baseKeys and their _other / _one variants in the en catalog', () => {
    const regex = /\bformatPluralMessage\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
    const missingKeys = new Set<string>();

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const baseKey = match[1];
        if (!enCatalog[`${baseKey}_other`]) {
          missingKeys.add(
            `${baseKey}_other (from baseKey ${baseKey} in ${path.basename(filePath)})`
          );
        }
        if (!enCatalog[`${baseKey}_one`]) {
          missingKeys.add(`${baseKey}_one (from baseKey ${baseKey} in ${path.basename(filePath)})`);
        }
      }
    }
    expect(Array.from(missingKeys)).toEqual([]);
  });

  it('contains all referenced data-i18n keys in the en catalog', () => {
    const regex = /data-i18n(?:-[a-z-]+)?=["']([a-zA-Z0-9_]+)["']/g;
    const missingKeys = new Set<string>();

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1];
        if (!enCatalog[key]) {
          missingKeys.add(`${key} (found in ${path.basename(filePath)})`);
        }
      }
    }
    expect(Array.from(missingKeys)).toEqual([]);
  });

  it('contains all referenced __MSG_ keys in the en catalog', () => {
    const regex = /__MSG_([a-zA-Z0-9_]+)__/g;
    const missingKeys = new Set<string>();

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1];
        // Ignore native WebExtension keys starting with @@
        if (key.startsWith('@@')) continue;

        if (!enCatalog[key]) {
          missingKeys.add(`${key} (found in ${path.basename(filePath)})`);
        }
      }
    }
    expect(Array.from(missingKeys)).toEqual([]);
  });

  it('validates all $PLACEHOLDER$ tokens in message strings have a matching case-insensitive key in entry.placeholders across all catalogs', () => {
    const missingPlaceholders = new Set<string>();
    const placeholderRegex = /\$([A-Z0-9_]+)\$/g;
    const localesDir = path.resolve(__dirname, '../../public/_locales');
    const locales = fs
      .readdirSync(localesDir)
      .filter((f) => fs.statSync(path.join(localesDir, f)).isDirectory());

    for (const locale of locales) {
      const catalogPath = path.join(localesDir, locale, 'messages.json');
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

      for (const [key, entry] of Object.entries(catalog)) {
        const message = (entry as any).message;
        if (typeof message !== 'string') continue;

        let match;
        placeholderRegex.lastIndex = 0;
        while ((match = placeholderRegex.exec(message)) !== null) {
          const placeholderName = match[1];

          // Skip natively replaced $COUNT$ for plural strings
          if (placeholderName === 'COUNT') continue;

          // For differential locales like en_US, placeholders can inherit from en
          const placeholdersDict =
            (entry as any).placeholders || (enCatalog[key] as any)?.placeholders || {};

          const definedPlaceholders = Object.keys(placeholdersDict).map((k) => k.toUpperCase());

          if (!definedPlaceholders.includes(placeholderName.toUpperCase())) {
            missingPlaceholders.add(
              `[${locale}] Placeholder $${placeholderName}$ missing in placeholders dict for key: ${key}`
            );
          }
        }
      }
    }
    expect(Array.from(missingPlaceholders)).toEqual([]);
  });
});
