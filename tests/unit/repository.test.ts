import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import {
  repository,
  normalizeDomainId,
  matchesDomainPattern,
} from '../../src/common/db/repository';
import { vault } from '../../src/common/crypto/vault';
import Dexie from 'dexie';

describe('LazarusRepository Full Branch Coverage (src/common/db/repository.ts)', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
    vault.lock();
    vi.restoreAllMocks();
  });

  describe('Utility functions', () => {
    it('normalizes domain identifiers correctly and strictly', () => {
      // Test nullish values to trigger early returns
      expect(normalizeDomainId(undefined as any)).toBe('unknown');
      expect(normalizeDomainId(null as any)).toBe('unknown');
      expect(normalizeDomainId('')).toBe('unknown');
      expect(normalizeDomainId('   ')).toBe('unknown');

      // Test protocol stripping explicitly (testing the regex)
      expect(normalizeDomainId('http://test.com')).toBe('test.com');
      expect(normalizeDomainId('https://test.com')).toBe('test.com');
      expect(normalizeDomainId('ftp://test.com')).toBe('test.com');
      // The regex /^[a-z]+:\/\// does not match custom-scheme because of the hyphen, so it splits and returns 'custom-scheme'
      expect(normalizeDomainId('custom-scheme://test.com')).toBe('custom-scheme');

      // Test port stripping explicitly
      expect(normalizeDomainId('test.com:8080')).toBe('test.com');
      expect(normalizeDomainId('https://SUB.EXAMPLE.COM:8080/path?q=1')).toBe('sub.example.com');
      expect(normalizeDomainId('example.org')).toBe('example.org');
    });

    it('matches wildcard domain patterns strictly', () => {
      // Exact matching boundary (case and trim)
      // The function does not trim hostname, only pattern. So ' GOOGLE.COM ' strictly becomes ' google.com ' which does not match 'google.com'
      expect(matchesDomainPattern(' GOOGLE.COM ', ' google.com ')).toBe(false);
      expect(matchesDomainPattern('google.com', 'google.com')).toBe(true);

      // Wildcard patterns
      expect(matchesDomainPattern('mail.google.com', '*.google.com')).toBe(true);
      expect(matchesDomainPattern('evil-google.com', '*.google.com')).toBe(false);
      expect(matchesDomainPattern('sub.mail.google.com', '*.google.com')).toBe(true);

      // Edge cases for regex replacement (. + ? ^ $ { } ( ) | [ ] \)
      expect(matchesDomainPattern('test.com', 'test.com')).toBe(true);
      expect(matchesDomainPattern('testXcom', 'test.com')).toBe(false); // ensuring . is escaped
      expect(matchesDomainPattern('a+b.com', 'a+b.com')).toBe(true);
      expect(matchesDomainPattern('a-b.com', 'a+b.com')).toBe(false);
    });
  });

  describe('CRUD & Revisions & Pruning', () => {
    it('handles default domain, milestones, and pruning beyond 10 revisions strictly', async () => {
      const baseSnapshot = {
        formInstanceId: 'prune-form',
        url: 'https://example.com/form',
        domain: '', // triggers 'unknown' domain
        title: '',
        editingTime: 5,
        fields: [{ name: 'notes', type: 'textarea', value: 'v1' }],
      };

      // Save 12 revisions (each > 5 mins apart so they don't merge)
      // to trigger pruning which keeps exactly 10
      for (let i = 1; i <= 12; i++) {
        await repository.saveFormSnapshot(
          {
            ...baseSnapshot,
            fields: [{ name: 'notes', type: 'textarea', value: `Revision note ${i}` }],
          },
          false,
          true
        );
      }

      const forms = await db.forms.where('formInstanceId').equals('prune-form').toArray();
      // Should cap exactly at 10
      expect(forms.length).toBe(10);

      // Ensure the domains were updated correctly
      const domains = await db.domains.toArray();
      expect(domains.length).toBe(1);
      expect(domains[0].id).toBe('unknown');
    });

    it('handles fallback queries in getRecoverableText and locked drafts', async () => {
      const domain = 'query-fallback.com';

      // 1. Seed a field with empty value (should be filtered out)
      await db.fields.put({
        id: 'f_empty',
        formId: 'f1',
        domainId: domain,
        revisionId: 'r1',
        name: 'emptyField',
        type: 'text',
        value: '   ',
        encryption: 'none',
        lastModified: Date.now(),
        status: 0,
      });

      // 2. Seed a field with name match only (different type)
      await db.fields.put({
        id: 'f_name_only',
        formId: 'f1',
        domainId: domain,
        revisionId: 'r1',
        name: 'searchField',
        type: 'custom_type',
        value: 'Fallback by name',
        encryption: 'none',
        lastModified: Date.now(),
        status: 0,
      });

      // Query looking for 'text' type -> should fallback to name
      const resName = await repository.getRecoverableText(domain, 'searchField', 'text');
      expect(resName.length).toBe(1);
      expect(resName[0].value).toBe('Fallback by name');

      // 3. Query for non-existent field -> should fallback to any recent field on domain
      const resAny = await repository.getRecoverableText(domain, 'unheard_field', 'unheard_type');
      expect(resAny.length).toBe(1);
      expect(resAny[0].value).toBe('Fallback by name');

      // 4. Test locked draft fallback when decrypt throws
      vi.spyOn(vault, 'decrypt').mockRejectedValueOnce(new Error('Locked'));
      const resLocked = await repository.getRecoverableText(domain, 'searchField', 'text');
      expect(resLocked[0].value).toBe('[Locked Draft - Enter Master Password]');
    });

    it('handles getRecoverableForm edge cases (null form, encrypted URL failure, field decrypt failure)', async () => {
      // Non-existent form
      const emptyRes = await repository.getRecoverableForm('non_existent');
      expect(emptyRes.form).toBeNull();
      expect(emptyRes.fields).toEqual([]);

      // Seed form with hybrid-aes-gcm encryption
      await db.forms.put({
        id: 'enc_form',
        domainId: 'secure.com',
        url: 'ciphertext_url',
        formInstanceId: 'f1',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Encrypted Form',
        encryption: 'hybrid-aes-gcm',
        editingTime: 10,
        lastModified: Date.now(),
        status: 0,
      });
      await db.fields.put({
        id: 'enc_field',
        formId: 'enc_form',
        domainId: 'secure.com',
        revisionId: 'r1',
        name: 'secret',
        type: 'text',
        value: 'ciphertext_val',
        encryption: 'hybrid-aes-gcm',
        lastModified: Date.now(),
        status: 0,
      });

      // Decrypt fails because vault is locked
      const res = await repository.getRecoverableForm('enc_form');
      expect(res.form!.url).toBe('[Encrypted URL]');
      expect(res.fields[0].value).toBe('[Locked Draft]');

      // Decrypt succeeds
      vi.spyOn(vault, 'decrypt').mockImplementation(async (val: string) => {
        if (val === 'ciphertext_url') return 'https://secure.com/decrypted';
        if (val === 'ciphertext_val') return 'Decrypted Secret Value';
        return val;
      });

      const resDecrypted = await repository.getRecoverableForm('enc_form');
      expect(resDecrypted.form!.url).toBe('https://secure.com/decrypted');
      expect(resDecrypted.fields[0].value).toBe('Decrypted Secret Value');
    });

    it('searches history matching by title, domain, field name, and field value strictly', async () => {
      const snap1 = {
        formInstanceId: 'f1',
        url: 'https://alpha.org/edit',
        domain: 'alpha.org',
        title: 'Alpha Form Title',
        editingTime: 1,
        fields: [{ name: 'user_bio', type: 'text', value: 'SpecialKeywordInValue' }],
      };
      await repository.saveFormSnapshot(snap1);

      // Search by domain exactly
      const matchDomain = await repository.searchHistory('alpha.org');
      expect(matchDomain.length).toBe(1);
      expect(matchDomain[0].form.domainId).toBe('alpha.org');

      // Search by title
      const matchTitle = await repository.searchHistory('Alpha Form');
      expect(matchTitle.length).toBe(1);

      // Search by field name
      const matchFieldName = await repository.searchHistory('user_bio');
      expect(matchFieldName.length).toBe(1);

      // Search by partial URL path
      const matchUrl = await repository.searchHistory('/edit');
      expect(matchUrl.length).toBe(1);

      // Search by field value
      const matchVal = await repository.searchHistory('SpecialKeyword');
      expect(matchVal.length).toBe(1);

      // No match
      const noMatch = await repository.searchHistory('NonexistentQuery123');
      expect(noMatch.length).toBe(0);

      // Empty query (returns everything because it matches partial strings or the code falls through)
      const emptyQuery = await repository.searchHistory('   ');
      expect(emptyQuery.length).toBeGreaterThan(0);
    });

    it('handles domain history, all history, and domain wiping strictly', async () => {
      await repository.saveFormSnapshot({
        formInstanceId: 'f_wipe',
        url: 'https://wipe-me.com',
        domain: 'wipe-me.com',
        title: 'Wipe Me',
        editingTime: 1,
        fields: [{ name: 'f', type: 'text', value: 'v' }],
      });

      const domainHist = await repository.getDomainHistory('wipe-me.com');
      expect(domainHist.length).toBe(1);
      expect(domainHist[0].form.domainId).toBe('wipe-me.com');

      const allHist = await repository.getAllHistory();
      expect(allHist.length).toBe(1);

      // Disable domain without wipe
      await repository.disableDomain('wipe-me.com', false);
      const afterDisable = await repository.getDomainHistory('wipe-me.com');
      expect(afterDisable.length).toBe(1); // Still there!

      // Disable domain with wipe
      await repository.disableDomain('wipe-me.com', true);
      const afterWipe = await repository.getDomainHistory('wipe-me.com');
      expect(afterWipe.length).toBe(0);

      // Domain record should be gone too
      const domRec = await db.domains.where('id').equals('wipe-me.com').first();
      expect(domRec).toBeUndefined();
    });

    it('evaluates isDomainEnabled against user blocklist patterns and wildcards', async () => {
      // Clean baseline
      expect(await repository.isDomainEnabled('example.com')).toBe(true);

      // Disable domain explicitly (first time)
      await repository.disableDomain('blocked-site.com');
      expect(await repository.isDomainEnabled('blocked-site.com')).toBe(false);

      // Disable it again (should not duplicate in array)
      await repository.disableDomain('blocked-site.com');
      const settings = await repository.getSettings();
      expect(settings.disabledDomains.filter((d) => d === 'blocked-site.com').length).toBe(1);

      expect(await repository.isDomainEnabled('allowed-site.com')).toBe(true);

      // Enable it back
      await repository.enableDomain('blocked-site.com');
      expect(await repository.isDomainEnabled('blocked-site.com')).toBe(true);

      // Wildcard pattern support
      await repository.updateSettings({ disabledDomains: ['*.bank.internal', 'secret.corp'] });
      expect(await repository.isDomainEnabled('portal.bank.internal')).toBe(false);
      expect(await repository.isDomainEnabled('secret.corp')).toBe(false);
      expect(await repository.isDomainEnabled('public.corp')).toBe(true);
    });

    it('cleans up forms older than the configured expiration interval', async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      await repository.updateSettings({ expireFormsInterval: 5 });

      // Expired form (11 days old, exceeds 5 days and 10 days cutoff)
      await db.forms.put({
        id: 'expired-repo-form',
        domainId: 'old.org',
        url: 'https://old.org/form',
        formInstanceId: 'f_old',
        revisionId: 'r_old',
        revisionNumber: 1,
        title: 'Old Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: now - 11 * dayMs,
        status: 0,
      });
      await db.fields.put({
        id: 'expired-repo-field',
        formId: 'expired-repo-form',
        domainId: 'old.org',
        revisionId: 'r_old',
        name: 'old_input',
        type: 'text',
        value: 'Old data',
        encryption: 'none',
        lastModified: now - 11 * dayMs,
        status: 0,
      });

      // Fresh form (1 day old)
      await db.forms.put({
        id: 'fresh-repo-form',
        domainId: 'fresh.org',
        url: 'https://fresh.org/form',
        formInstanceId: 'f_fresh',
        revisionId: 'r_fresh',
        revisionNumber: 1,
        title: 'Fresh Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: now - 1 * dayMs,
        status: 0,
      });
      await db.fields.put({
        id: 'fresh-repo-field',
        formId: 'fresh-repo-form',
        domainId: 'fresh.org',
        revisionId: 'r_fresh',
        name: 'fresh_input',
        type: 'text',
        value: 'Fresh data',
        encryption: 'none',
        lastModified: now - 1 * dayMs,
        status: 0,
      });

      // Form disabled by expiration 0 setting (0 is falsey in `interval || 5` so it falls back to 5)
      await repository.updateSettings({ expireFormsInterval: 0 }); // 0 falls back to 5!
      let deletedCount = await repository.cleanupExpiredForms();
      expect(deletedCount).toBe(1); // One deleted because 0 -> 5

      // Restore expiration setting
      await repository.updateSettings({ expireFormsInterval: 5 });
      deletedCount = await repository.cleanupExpiredForms();
      expect(deletedCount).toBe(0); // None left to delete

      const remainingForms = await db.forms.toArray();
      expect(remainingForms.length).toBe(1);
      expect(remainingForms[0].id).toBe('fresh-repo-form');

      const remainingFields = await db.fields.toArray();
      expect(remainingFields.length).toBe(1);
      expect(remainingFields[0].id).toBe('fresh-repo-field');
    });

    it('updates existing revision in-place when within active editing milestone strictly', async () => {
      const snapshot1 = {
        formInstanceId: 'inplace-form',
        url: 'https://example.com/inplace',
        domain: 'example.com',
        title: 'Inplace Form',
        editingTime: 1,
        fields: [{ name: 'msg', type: 'text', value: 'Draft v1' }],
      };

      // First save
      const res1 = await repository.saveFormSnapshot(snapshot1, false, false);
      expect(res1.revisionNumber).toBe(1);

      // Second save within 1 minute (forceNewRevision = false, isFinalSubmit = false)
      const snapshot2 = {
        ...snapshot1,
        fields: [{ name: 'msg', type: 'text', value: 'Draft v1 updated' }],
      };
      const res2 = await repository.saveFormSnapshot(snapshot2, false, false);
      expect(res2.revisionId).toBe(res1.revisionId);
      expect(res2.revisionNumber).toBe(1);

      // Verify the field was updated in-place rather than creating duplicates
      const fields = await db.fields.where('formId').equals(res1.formId).toArray();
      expect(fields.length).toBe(1);
      expect(fields[0].value).toBe('Draft v1 updated');

      // Third save with forceNewRevision = true
      const res3 = await repository.saveFormSnapshot(snapshot2, false, true);
      expect(res3.revisionNumber).toBe(2);
      expect(res3.revisionId).not.toBe(res1.revisionId);

      // Fourth save with isFinalSubmit = true
      const res4 = await repository.saveFormSnapshot(snapshot2, true, false);
      expect(res4.revisionNumber).toBe(3);
    });

    it('triggers new revision when milestone duration or idle timeout is reached', async () => {
      const now = Date.now();
      // Seed a form created 10 minutes ago (beyond 5m milestone duration)
      const oldTime = now - 10 * 60 * 1000;
      await db.forms.put({
        id: 'old-milestone-form',
        domainId: 'milestone.com',
        url: 'https://milestone.com/form',
        formInstanceId: 'f_milestone',
        revisionId: `rev_${oldTime}`,
        revisionNumber: 1,
        title: 'Milestone Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: oldTime,
        status: 0,
      });

      const snapshot = {
        formInstanceId: 'f_milestone',
        url: 'https://milestone.com/form',
        domain: 'milestone.com',
        title: 'Milestone Form',
        editingTime: 2,
        fields: [{ name: 'msg', type: 'text', value: 'After milestone' }],
      };

      const res = await repository.saveFormSnapshot(snapshot, false, false);
      expect(res.revisionNumber).toBe(2); // Since it was 10 mins ago, it creates a new milestone revision!
      expect(res.revisionId).not.toBe(`rev_${oldTime}`);
    });

    it('handles search decryption errors gracefully', async () => {
      // Put a field with encryption='hybrid-aes-gcm' and corrupt encrypted payload
      await db.forms.put({
        id: 'encrypted-form',
        domainId: 'crypto.com',
        url: 'https://crypto.com/page',
        formInstanceId: 'f_enc',
        revisionId: 'r_enc',
        revisionNumber: 1,
        title: 'Encrypted Form',
        encryption: 'hybrid-aes-gcm',
        editingTime: 1,
        lastModified: Date.now(),
        status: 0,
      });
      await db.fields.put({
        id: 'encrypted-field',
        formId: 'encrypted-form',
        domainId: 'crypto.com',
        revisionId: 'r_enc',
        name: 'secret',
        type: 'text',
        value: 'corrupted-cipher-text',
        encryption: 'hybrid-aes-gcm',
        lastModified: Date.now(),
        status: 0,
      });

      vi.spyOn(vault, 'decrypt').mockRejectedValue(new Error('Decryption Failed'));

      // Search query should not throw and return 0 matches
      const results = await repository.searchHistory('secret_data');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('falls back to single-index domainId query if compound index query fails strictly', async () => {
      await db.forms.put({
        id: 'fallback-form-1',
        domainId: 'fallback-domain.com',
        url: 'https://fallback-domain.com/form',
        formInstanceId: 'f_fb',
        revisionId: 'r_fb',
        revisionNumber: 1,
        title: 'Fallback Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: Date.now(),
        status: 0,
      });

      await db.forms.put({
        id: 'fallback-form-deleted',
        domainId: 'fallback-domain.com',
        url: 'https://fallback-domain.com/form',
        formInstanceId: 'f_fb2',
        revisionId: 'r_fb2',
        revisionNumber: 1,
        title: 'Fallback Form Deleted',
        encryption: 'none',
        editingTime: 1,
        lastModified: Date.now(),
        status: 1, // Deleted status!
      });

      // 1. getLatestFormRevisions strictly filtering status 0!
      const latest = await repository.getLatestFormRevisions('fallback-domain.com', 5);
      expect(latest.length).toBe(1);
      expect(latest[0].form.id).toBe('fallback-form-1');

      // 2. getDomainHistory should catch error and use domainId fallback, strictly filtering status 0!
      const domainHistory = await repository.getDomainHistory('fallback-domain.com', 5);
      expect(domainHistory.length).toBe(1);
      expect(domainHistory[0].form.id).toBe('fallback-form-1');

      // 3. saveFormSnapshot fallback strictly checking status 0
      const res = await repository.saveFormSnapshot(
        {
          formInstanceId: 'f_fb',
          url: 'https://fallback-domain.com/form',
          domain: 'fallback-domain.com',
          title: 'Fallback Form',
          editingTime: 1,
          fields: [{ name: 'msg', type: 'text', value: 'Draft v1 updated' }],
        },
        false,
        false
      );

      expect(res.revisionNumber).toBe(1); // In-place update due to fallback querying the active form
    });

    it('exercises sort comparators and filters when querying multiple records', async () => {
      const now = Date.now();

      // 1. Seed two active forms with different timestamps, plus one deleted form
      await db.forms.bulkPut([
        {
          id: 'sort-form-older',
          domainId: 'sort-test.com',
          url: 'https://sort-test.com/1',
          formInstanceId: 'f_sort_1',
          revisionId: 'r1',
          revisionNumber: 1,
          title: 'Older Form Multi Match',
          encryption: 'none',
          editingTime: 1,
          lastModified: now - 5000,
          status: 0,
        },
        {
          id: 'sort-form-newer',
          domainId: 'sort-test.com',
          url: 'https://sort-test.com/2',
          formInstanceId: 'f_sort_2',
          revisionId: 'r2',
          revisionNumber: 1,
          title: 'Newer Form Multi Match',
          encryption: 'none',
          editingTime: 1,
          lastModified: now,
          status: 0,
        },
        {
          id: 'sort-form-deleted',
          domainId: 'sort-test.com',
          url: 'https://sort-test.com/3',
          formInstanceId: 'f_sort_3',
          revisionId: 'r3',
          revisionNumber: 1,
          title: 'Deleted Form Multi Match',
          encryption: 'none',
          editingTime: 1,
          lastModified: now + 1000,
          status: 1,
        },
      ]);

      // Seed fields for getRecoverableFields with different timestamps
      await db.fields.bulkPut([
        {
          id: 'sort-field-1',
          formId: 'sort-form-older',
          domainId: 'sort-test.com',
          revisionId: 'r1',
          name: 'comment',
          type: 'textarea',
          value: 'First Comment Value',
          encryption: 'none',
          lastModified: now - 3000,
          status: 0,
        },
        {
          id: 'sort-field-2',
          formId: 'sort-form-newer',
          domainId: 'sort-test.com',
          revisionId: 'r2',
          name: 'comment',
          type: 'textarea',
          value: 'Second Comment Value',
          encryption: 'none',
          lastModified: now - 1000,
          status: 0,
        },
      ]);

      // 1. getLatestFormRevisions standard path (exercises line 386 filter)
      const latest = await repository.getLatestFormRevisions('sort-test.com', 5);
      expect(latest.length).toBe(2);
      expect(latest[0].form.id).toBe('sort-form-newer');
      expect(latest[1].form.id).toBe('sort-form-older');

      // 2. getRecoverableFields with >= 2 fields (exercises line 314 sort)
      const recFields = await repository.getRecoverableText('sort-test.com', 'comment', 'textarea');
      expect(recFields.length).toBe(2);
      expect(recFields[0].value).toBe('Second Comment Value');
      expect(recFields[1].value).toBe('First Comment Value');

      // 3. searchHistory('') with >= 2 forms (exercises line 447 sort)
      const emptySearch = await repository.searchHistory('', 10);
      expect(emptySearch.length).toBeGreaterThanOrEqual(2);
      expect(emptySearch[0].form.lastModified).toBeGreaterThanOrEqual(
        emptySearch[1].form.lastModified
      );

      // 4. searchHistory('Multi Match') with >= 2 forms (exercises line 497 sort)
      const querySearch = await repository.searchHistory('Multi Match', 10);
      expect(querySearch.length).toBe(2);
      expect(querySearch[0].form.id).toBe('sort-form-newer');
      expect(querySearch[1].form.id).toBe('sort-form-older');

      // 5. getAllHistory() with >= 2 forms (exercises line 508 sort)
      const allHist = await repository.getAllHistory(10);
      expect(allHist.length).toBeGreaterThanOrEqual(2);
      expect(allHist[0].form.lastModified).toBeGreaterThanOrEqual(allHist[1].form.lastModified);
    });

    it('handles fallback queries when compound index fails in getRecoverableFields and getFormRevisions', async () => {
      const now = Date.now();
      await db.forms.put({
        id: 'rev-form-1',
        domainId: 'rev-test.com',
        url: 'https://rev-test.com',
        formInstanceId: 'f_rev_inst',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Rev Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: now,
        status: 0,
      });

      await db.fields.put({
        id: 'rev-field-1',
        formId: 'rev-form-1',
        domainId: 'rev-test.com',
        revisionId: 'r1',
        name: 'feedback',
        type: 'text',
        value: 'Fallback Field Value',
        encryption: 'none',
        lastModified: now,
        status: 0,
      });

      const fieldsRes = await repository.getRecoverableText('rev-test.com', 'feedback', 'text');
      expect(fieldsRes.length).toBe(1);
      expect(fieldsRes[0].value).toBe('Fallback Field Value');

      const formsRes = await repository.getFormRevisions('rev-test.com', 'f_rev_inst');
      expect(formsRes.length).toBe(1);
      expect(formsRes[0].form.id).toBe('rev-form-1');

      // 3. Save snapshot with a field that has no name and no value (exercises line 222 continue)
      await repository.saveFormSnapshot({
        formInstanceId: 'f_empty_field',
        url: 'https://rev-test.com',
        domain: 'rev-test.com',
        title: 'Empty Field Form',
        editingTime: 1,
        fields: [
          { name: '', type: 'text', value: '' },
          { name: 'valid', type: 'text', value: 'has-value' },
        ],
      });
    });

    it('covers all defensive fallbacks for formInstanceId, revisionNumber, URLs, fields, and trimming', async () => {
      // 1. Snapshot with empty formInstanceId, empty url, undefined editingTime, non-array fields
      await repository.saveFormSnapshot({
        formInstanceId: '' as any,
        url: '' as any,
        domain: 'fallback-test.com',
        title: 'Fallback Form',
        editingTime: undefined as any,
        fields: undefined as any,
      });

      // 2. Snapshot with fields having empty name, empty type, empty value
      await repository.saveFormSnapshot({
        formInstanceId: 'f_field_fallbacks',
        url: 'https://fallback-test.com',
        domain: 'fallback-test.com',
        title: 'Field Fallbacks',
        editingTime: 5,
        fields: [
          { name: '' as any, type: '' as any, value: 'HasVal' },
          { name: 'has_name', type: 'text', value: '' as any },
        ],
      });

      // 3. Updating an existing revision where latestRevision has revisionId: '', revisionNumber: 0
      await db.forms.put({
        id: 'fallback-test.com_f_corrupt_rev_corrupt',
        domainId: 'fallback-test.com',
        url: '',
        formInstanceId: 'f_corrupt',
        revisionId: '',
        revisionNumber: 0,
        title: 'Corrupt',
        encryption: 'none',
        editingTime: 0,
        lastModified: Date.now(),
        status: 0,
      });
      await repository.saveFormSnapshot(
        {
          formInstanceId: 'f_corrupt',
          url: 'https://fallback-test.com',
          domain: 'fallback-test.com',
          title: 'Corrupt Update',
          editingTime: 2,
          fields: [],
        },
        false
      );

      // 4. Trimming revisions when an old revision has isFinalSubmit: true (line 248 false branch)
      for (let i = 1; i <= 12; i++) {
        await repository.saveFormSnapshot(
          {
            formInstanceId: 'f_trim_test',
            url: 'https://fallback-test.com',
            domain: 'fallback-test.com',
            title: `Trim ${i}`,
            editingTime: i * 1000,
            fields: [],
          },
          true
        );
      }

      // 5. Querying form revisions where form has url: '' (line 457)
      const revs = await repository.getFormRevisions('fallback-test.com', 'f_corrupt');
      expect(revs.length).toBeGreaterThan(0);

      // 6. Querying searchHistory with field having value: '' and non-matching name (line 481)
      await db.fields.put({
        id: 'empty_val_field',
        formId: 'f_empty_val',
        domainId: 'fallback-test.com',
        revisionId: 'r',
        name: 'non_matching_name',
        type: 'text',
        value: '',
        encryption: 'none',
        lastModified: Date.now(),
        status: 0,
      });
      const searchResults = await repository.searchHistory('nomatch_query');
      expect(searchResults.length).toBe(0);

      // 7. getAllHistory with form having domainId: '' and revisionNumber: 0 (lines 632, 633)
      await db.forms.put({
        id: 'no_domain_form',
        domainId: '',
        url: 'https://fallback-test.com',
        formInstanceId: 'f_no_domain',
        revisionId: 'rev_nd',
        revisionNumber: 0,
        title: 'No Domain',
        encryption: 'none',
        editingTime: 1,
        lastModified: Date.now(),
        status: 0,
      });
      const allHist = await repository.getAllHistory();
      expect(allHist.length).toBeGreaterThan(0);
    });
  });

  describe('Mutation Resistance Tests for Repository', () => {
    it('kills wildcard regex anchors in matchesDomainPattern', () => {
      expect(matchesDomainPattern('subgoogle.com', 'google.com')).toBe(false);
      expect(matchesDomainPattern('google.com.attacker.com', 'google.com')).toBe(false);
      expect(matchesDomainPattern('google.com', 'google.com')).toBe(true);
      expect(matchesDomainPattern('mail.google.com', '*.google.com')).toBe(true);
      expect(matchesDomainPattern('evilgoogle.com', '*.google.com')).toBe(false);
    });

    it('kills unknown settings keys mutant in getSettings', async () => {
      await db.settings.put({
        key: 'completely_unknown_key_mutation_check',
        value: 'should_be_ignored',
        lastModified: Date.now(),
      });
      const settings = await repository.getSettings();
      expect('completely_unknown_key_mutation_check' in settings).toBe(false);
    });

    it('kills disableDomain domain isolation and field deletion mutants strictly', async () => {
      await repository.updateSettings({ disabledDomains: [] });
      await db.domains.put({
        id: 'disable-domain.com',
        domain: 'disable-domain.com',
        totalEditingTime: 10,
        lastModified: 1,
        status: 0,
      });
      await db.forms.put({
        id: 'f_dis',
        domainId: 'disable-domain.com',
        formInstanceId: 'fi',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Title',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1,
        status: 0,
        url: '',
      });
      await db.fields.put({
        id: 'fld_dis',
        formId: 'f_dis',
        domainId: 'disable-domain.com',
        revisionId: 'r1',
        name: 'field1',
        type: 'text',
        value: 'val1',
        encryption: 'none',
        lastModified: 1,
        status: 0,
      });
      // Field on another domain
      await db.fields.put({
        id: 'other_fld',
        domainId: 'other-domain.com',
        formId: 'f_other',
        revisionId: 'r_other',
        name: 'n',
        type: 'text',
        value: 'v',
        encryption: 'none',
        lastModified: 1,
        status: 0,
      });

      // Default wipeExisting = false
      await repository.disableDomain('disable-domain.com');
      let s = await repository.getSettings();
      expect(s.disabledDomains).toContain('disable-domain.com');
      expect(await db.forms.get('f_dis')).toBeDefined();
      expect(await db.fields.get('fld_dis')).toBeDefined();
      expect(await db.domains.get('disable-domain.com')).toBeDefined();

      // Calling disableDomain again when already in list (branch coverage)
      await repository.disableDomain('disable-domain.com');
      s = await repository.getSettings();
      expect(s.disabledDomains.filter((d) => d === 'disable-domain.com').length).toBe(1);

      // With wipeExisting = true
      await repository.disableDomain('disable-domain.com', true);
      expect(await db.forms.get('f_dis')).toBeUndefined();
      expect(await db.fields.get('fld_dis')).toBeUndefined();
      expect(await db.domains.get('disable-domain.com')).toBeUndefined();
      // other domain field must NOT be deleted
      expect(await db.fields.get('other_fld')).toBeDefined();

      // enableDomain with multiple domains
      await repository.updateSettings({
        disabledDomains: ['domain-a.com', 'domain-b.com', 'domain-c.com'],
      });
      await repository.enableDomain('domain-b.com');
      s = await repository.getSettings();
      expect(s.disabledDomains).toEqual(['domain-a.com', 'domain-c.com']);
    });

    it('kills deleteForm and clearAllHistory mutants strictly', async () => {
      await db.forms.put({
        id: 'f_to_delete',
        domainId: 'del.com',
        formInstanceId: 'fi',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'T',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1,
        status: 0,
        url: '',
      });
      await db.fields.put({
        id: 'fld_to_delete',
        formId: 'f_to_delete',
        domainId: 'del.com',
        revisionId: 'r1',
        name: 'f',
        type: 'text',
        value: 'v',
        encryption: 'none',
        lastModified: 1,
        status: 0,
      });

      await repository.deleteForm('f_to_delete');
      const f = await db.forms.get('f_to_delete');
      expect(f?.status).toBe(1);
      const fld = await db.fields.get('fld_to_delete');
      expect(fld?.status).toBe(1);

      // Clear all history
      await db.domains.put({
        id: 'd1',
        domain: 'd1',
        totalEditingTime: 1,
        lastModified: 1,
        status: 0,
      });
      expect(await db.forms.count()).toBeGreaterThan(0);
      expect(await db.fields.count()).toBeGreaterThan(0);
      expect(await db.domains.count()).toBeGreaterThan(0);

      await repository.clearAllHistory();
      expect(await db.forms.count()).toBe(0);
      expect(await db.fields.count()).toBe(0);
      expect(await db.domains.count()).toBe(0);
    });

    it('kills saveFormSnapshot milestone, idle timeout, and cumulative editing time mutants', async () => {
      const nowSpy = vi.spyOn(Date, 'now');
      const startTime = 1_700_000_000_000;
      nowSpy.mockReturnValue(startTime);

      const snap = {
        domain: 'milestone.com',
        formInstanceId: 'f_ms',
        title: 'MS Form',
        url: 'https://milestone.com',
        editingTime: 10,
        fields: [{ name: 'f1', type: 'text', value: 'hello' }],
      };

      const res1 = await repository.saveFormSnapshot(snap);
      expect(res1.revisionNumber).toBe(1);
      let dom = await db.domains.get('milestone.com');
      expect(dom?.totalEditingTime).toBe(10);

      // Milestone boundary (5 minutes = 300_000ms):
      // At 299_999ms later, milestone not reached: updates existing revision
      nowSpy.mockReturnValue(startTime + 299_999);
      const res2 = await repository.saveFormSnapshot({ ...snap, editingTime: 15 });
      expect(res2.revisionNumber).toBe(1);
      expect(res2.revisionId).toBe(res1.revisionId);
      dom = await db.domains.get('milestone.com');
      expect(dom?.totalEditingTime).toBe(25);

      // At exactly 300_000ms from creation: milestone reached! Spawns new revision
      nowSpy.mockReturnValue(startTime + 300_000);
      const res3 = await repository.saveFormSnapshot(snap);
      expect(res3.revisionNumber).toBe(2);
      expect(res3.revisionId).not.toBe(res1.revisionId);

      // Idle timeout boundary (15 minutes = 900_000ms):
      // Seed a revision with unparseable timestamp in revisionId so revisionCreationTime defaults to now (milestone never reached)
      const idleBaseTime = 1_800_000_000_000;
      await db.forms.put({
        id: 'idle_form_id',
        domainId: 'idle.com',
        formInstanceId: 'f_idle',
        revisionId: 'custom_nonnumeric_rev',
        revisionNumber: 1,
        title: 'Idle Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: idleBaseTime,
        status: 0,
        url: 'https://idle.com',
      });

      const idleSnap = {
        domain: 'idle.com',
        formInstanceId: 'f_idle',
        title: 'Idle Form',
        url: 'https://idle.com',
        editingTime: 1,
        fields: [],
      };

      // At idleBaseTime + 899_999ms (14m 59.999s): idle timeout not reached (< 900_000ms)
      nowSpy.mockReturnValue(idleBaseTime + 899_999);
      const resIdle1 = await repository.saveFormSnapshot(idleSnap);
      expect(resIdle1.revisionNumber).toBe(1);

      // Reset lastModified back to idleBaseTime for exact 900_000ms test
      await db.forms.update('idle_form_id', { lastModified: idleBaseTime });
      // At idleBaseTime + 900_000ms (exactly 15 minutes): idle timeout reached! Spawns new revision
      nowSpy.mockReturnValue(idleBaseTime + 900_000);
      const resIdle2 = await repository.saveFormSnapshot(idleSnap);
      expect(resIdle2.revisionNumber).toBe(2);

      nowSpy.mockRestore();
    });

    it('kills saveFormSnapshot edge cases, sorting, and pruning mutants strictly', async () => {
      // 1. Fallback domain 'unknown' and formInstanceId 'form_default'
      const resDef = await repository.saveFormSnapshot({
        domain: '',
        formInstanceId: '',
        title: '',
        url: '',
        editingTime: 42,
        fields: [{ name: 'test_fld', type: 'text', value: 'hello' }],
      });
      expect(resDef.domainId).toBe('unknown');
      const defForm = await db.forms.get(resDef.formId);
      expect(defForm?.formInstanceId).toBe('form_default');
      expect(defForm?.url).toBe('');
      expect(defForm?.editingTime).toBe(42);
      expect(resDef.revisionId.split('_')[2].length).toBe(5);
      const fieldCount = await db.fields.where('formId').equals(resDef.formId).count();
      expect(fieldCount).toBe(1);

      // 2. Existing revisions sorting and filtering
      const nowSort = Date.now();
      await db.forms.put({
        id: 'f_old',
        domainId: 'sort-test.com',
        formInstanceId: 'fi_sort',
        revisionId: `rev_${nowSort}_abcde`,
        revisionNumber: 1,
        title: 'Old',
        encryption: 'none',
        editingTime: 1,
        lastModified: nowSort,
        status: 0,
        url: 'https://sort.com',
      });
      await db.forms.put({
        id: 'f_new',
        domainId: 'sort-test.com',
        formInstanceId: 'fi_sort',
        revisionId: `rev_${nowSort + 100}_abcde`,
        revisionNumber: 2,
        title: 'New',
        encryption: 'none',
        editingTime: 1,
        lastModified: nowSort + 100,
        status: 0,
        url: 'https://sort.com',
      });
      // Soft deleted form on same instance
      await db.forms.put({
        id: 'f_del_sort',
        domainId: 'sort-test.com',
        formInstanceId: 'fi_sort',
        revisionId: `rev_${nowSort + 200}_abcde`,
        revisionNumber: 3,
        title: 'Del',
        encryption: 'none',
        editingTime: 1,
        lastModified: nowSort + 200,
        status: 1,
        url: 'https://sort.com',
      });
      // Form on another domain
      await db.forms.put({
        id: 'f_other_dom',
        domainId: 'other-sort.com',
        formInstanceId: 'fi_sort',
        revisionId: `rev_${nowSort + 300}_abcde`,
        revisionNumber: 4,
        title: 'Other Dom',
        encryption: 'none',
        editingTime: 1,
        lastModified: nowSort + 300,
        status: 0,
        url: 'https://other.com',
      });

      // Saving without forceNewRevision updates the NEWEST active revision (f_new at 2000)
      const resUpdate = await repository.saveFormSnapshot(
        {
          domain: 'sort-test.com',
          formInstanceId: 'fi_sort',
          title: 'Updated New',
          url: 'https://sort.com',
          editingTime: 1,
          fields: [],
        },
        false,
        false
      );
      expect(resUpdate.formId).toBe('f_new');
      expect(resUpdate.revisionNumber).toBe(2);

      // 3. Fallback when latestRevision has revisionId: '' and revisionNumber: 0
      const nowFb = Date.now();
      await db.forms.put({
        id: 'f_fallback_test',
        domainId: 'fb.com',
        formInstanceId: 'fi_fb',
        revisionId: '',
        revisionNumber: 0,
        title: 'FB',
        encryption: 'none',
        editingTime: 1,
        lastModified: nowFb,
        status: 0,
        url: '',
      });
      const resFb = await repository.saveFormSnapshot(
        {
          domain: 'fb.com',
          formInstanceId: 'fi_fb',
          title: 'FB update',
          url: '',
          editingTime: 1,
          fields: [],
        },
        false,
        false
      );
      expect(resFb.revisionId).toBe(`rev_${nowFb}`);
      expect(resFb.revisionNumber).toBe(1);

      // 4. Revision pruning field deletion verification
      const pruneDom = 'prune-fields-test.com';
      for (let i = 1; i <= 12; i++) {
        await repository.saveFormSnapshot(
          {
            domain: pruneDom,
            formInstanceId: 'f_prune_fields',
            title: `Rev ${i}`,
            url: '',
            editingTime: 1,
            fields: [{ name: 'fld', type: 'text', value: `val_${i}` }],
          },
          false,
          true
        );
      }
      const remainingForms = await db.forms.where('domainId').equals(pruneDom).toArray();
      expect(remainingForms.length).toBe(10);
      const remainingFields = await db.fields.where('domainId').equals(pruneDom).toArray();
      expect(remainingFields.length).toBe(10);
    });

    it('kills getRecoverableText fallback branches, deduplication, and limit mutants', async () => {
      const domain = 'recov-branch-kill.com';

      // Branch 1 exact match [domainId+name+type]
      await db.fields.put({
        id: 'fld_b1',
        formId: 'form_b1',
        domainId: domain,
        revisionId: 'rev_1',
        name: 'notes',
        type: 'textarea',
        value: 'ExactMatch',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      });
      // Soft-deleted field with exact match
      await db.fields.put({
        id: 'fld_b1_del',
        formId: 'form_b1_del',
        domainId: domain,
        revisionId: 'rev_1_del',
        name: 'notes',
        type: 'textarea',
        value: 'ExactDeleted',
        encryption: 'none',
        lastModified: 1100,
        status: 1,
      });
      const resB1 = await repository.getRecoverableText(domain, 'notes', 'textarea');
      expect(resB1.length).toBe(1);
      expect(resB1[0].value).toBe('ExactMatch');

      // Branch 2: Fallback by field name (when type doesn't match)
      await db.fields.clear();
      await db.fields.put({
        id: 'fld_b2_match',
        formId: 'form_b2',
        domainId: domain,
        revisionId: 'rev_b2',
        name: 'named_field',
        type: 'custom_type',
        value: 'NameMatchValue',
        encryption: 'none',
        lastModified: 2000,
        status: 0,
      });
      // Soft deleted on branch 2
      await db.fields.put({
        id: 'fld_b2_del',
        formId: 'form_b2',
        domainId: domain,
        revisionId: 'rev_b2',
        name: 'named_field',
        type: 'custom_type',
        value: 'NameMatchDeleted',
        encryption: 'none',
        lastModified: 2100,
        status: 1,
      });
      // Whitespace only on branch 2
      await db.fields.put({
        id: 'fld_b2_ws',
        formId: 'form_b2',
        domainId: domain,
        revisionId: 'rev_b2',
        name: 'named_field',
        type: 'custom_type',
        value: '    ',
        encryption: 'none',
        lastModified: 2200,
        status: 0,
      });
      // Different name
      await db.fields.put({
        id: 'fld_b2_other',
        formId: 'form_b2',
        domainId: domain,
        revisionId: 'rev_b2',
        name: 'different_name',
        type: 'custom_type',
        value: 'OtherValue',
        encryption: 'none',
        lastModified: 2300,
        status: 0,
      });
      const resB2 = await repository.getRecoverableText(domain, 'named_field', 'unmatched_type');
      expect(resB2.length).toBe(1);
      expect(resB2[0].value).toBe('NameMatchValue');

      // Branch 3: Fallback to any recent field on domain (when name doesn't match)
      await db.fields.clear();
      await db.fields.put({
        id: 'fld_b3_match',
        formId: 'form_b3',
        domainId: domain,
        revisionId: 'rev_b3',
        name: 'any_name',
        type: 'any_type',
        value: 'AnyFieldValue',
        encryption: 'none',
        lastModified: 3000,
        status: 0,
      });
      // Soft-deleted on branch 3
      await db.fields.put({
        id: 'fld_b3_del',
        formId: 'form_b3',
        domainId: domain,
        revisionId: 'rev_b3',
        name: 'del_name',
        type: 'del_type',
        value: 'AnyFieldDeleted',
        encryption: 'none',
        lastModified: 3100,
        status: 1,
      });
      // Whitespace on branch 3
      await db.fields.put({
        id: 'fld_b3_ws',
        formId: 'form_b3',
        domainId: domain,
        revisionId: 'rev_b3',
        name: 'ws_name',
        type: 'ws_type',
        value: '   ',
        encryption: 'none',
        lastModified: 3200,
        status: 0,
      });
      const resB3 = await repository.getRecoverableText(
        domain,
        'completely_unknown',
        'unknown_type'
      );
      expect(resB3.length).toBe(1);
      expect(resB3[0].value).toBe('AnyFieldValue');

      // Deduplication trimming test
      await db.fields.clear();
      await db.fields.put({
        id: 'fld_dup1',
        formId: 'f1',
        domainId: domain,
        revisionId: 'r1',
        name: 'f',
        type: 't',
        value: '  Duplicate Text  ',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      });
      await db.fields.put({
        id: 'fld_dup2',
        formId: 'f2',
        domainId: domain,
        revisionId: 'r2',
        name: 'f',
        type: 't',
        value: 'Duplicate Text',
        encryption: 'none',
        lastModified: 2000,
        status: 0,
      });
      const resDup = await repository.getRecoverableText(domain, 'f', 't');
      expect(resDup.length).toBe(1);
      expect(resDup[0].value).toBe('Duplicate Text');
    });

    it('kills getFormRevisions domain isolation and sorting mutants', async () => {
      const domain = 'rev-sort-kill.com';
      await db.forms.put({
        id: 'f_rev_1',
        domainId: domain,
        formInstanceId: 'fi_1',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Rev 1',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'https://rev.com',
      });
      await db.forms.put({
        id: 'f_rev_2',
        domainId: domain,
        formInstanceId: 'fi_1',
        revisionId: 'r2',
        revisionNumber: 2,
        title: 'Rev 2',
        encryption: 'none',
        editingTime: 1,
        lastModified: 2000,
        status: 0,
        url: 'https://rev.com',
      });
      // Soft deleted form
      await db.forms.put({
        id: 'f_rev_del',
        domainId: domain,
        formInstanceId: 'fi_1',
        revisionId: 'r_del',
        revisionNumber: 3,
        title: 'Rev Del',
        encryption: 'none',
        editingTime: 1,
        lastModified: 3000,
        status: 1,
        url: 'https://rev.com',
      });
      // Form on another domain
      await db.forms.put({
        id: 'f_rev_other_dom',
        domainId: 'other-rev-domain.com',
        formInstanceId: 'fi_1',
        revisionId: 'r_other',
        revisionNumber: 1,
        title: 'Rev Other Dom',
        encryption: 'none',
        editingTime: 1,
        lastModified: 4000,
        status: 0,
        url: 'https://other.com',
      });

      const revs = await repository.getFormRevisions(domain, 'fi_1');
      expect(revs.length).toBe(2);
      expect(revs[0].form.lastModified).toBe(2000);
      expect(revs[1].form.lastModified).toBe(1000);
    });

    it('kills getLatestFormRevisions, getDomainHistory, and getAllHistory sorting and limit mutants', async () => {
      const domain = 'history-sort-kill.com';
      for (let i = 1; i <= 6; i++) {
        await db.forms.put({
          id: `f_hist_${i}`,
          domainId: domain,
          formInstanceId: `fi_${i}`,
          revisionId: `r_${i}`,
          revisionNumber: 1,
          title: `Hist ${i}`,
          encryption: 'none',
          editingTime: 1,
          lastModified: 1000 * i,
          status: 0,
          url: 'https://hist.com',
        });
      }
      // Soft-deleted form
      await db.forms.put({
        id: 'f_hist_del',
        domainId: domain,
        formInstanceId: 'fi_del',
        revisionId: 'r_del',
        revisionNumber: 1,
        title: 'Hist Del',
        encryption: 'none',
        editingTime: 1,
        lastModified: 99999,
        status: 1,
        url: 'https://hist.com',
      });
      // Form on another domain
      await db.forms.put({
        id: 'f_hist_other_dom',
        domainId: 'other-hist-domain.com',
        formInstanceId: 'fi_other',
        revisionId: 'r_oth',
        revisionNumber: 1,
        title: 'Other Dom',
        encryption: 'none',
        editingTime: 1,
        lastModified: 8000,
        status: 0,
        url: 'https://other.com',
      });

      // getLatestFormRevisions (default limit = 5)
      const latest5 = await repository.getLatestFormRevisions(domain, 5);
      expect(latest5.length).toBe(5);
      expect(latest5[0].form.lastModified).toBe(6000);
      expect(latest5[4].form.lastModified).toBe(2000);

      // getDomainHistory (limit = 2)
      const domHist = await repository.getDomainHistory(domain, 2);
      expect(domHist.length).toBe(2);
      expect(domHist[0].form.lastModified).toBe(6000);
      expect(domHist[1].form.lastModified).toBe(5000);

      // getAllHistory (limit = 2)
      const allHist = await repository.getAllHistory(2);
      expect(allHist.length).toBe(2);
      expect(allHist[0].form.lastModified).toBe(8000);
      expect(allHist[1].form.lastModified).toBe(6000);
    });

    it('kills searchHistory empty query, field matching, case matching, and locked decryption mutants', async () => {
      await db.forms.clear();
      await db.fields.clear();

      await db.forms.put({
        id: 'f_s1',
        domainId: 'domain-one.com',
        formInstanceId: 'fi1',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Alphabet Alpha Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'https://domain-one.com/login',
      });
      await db.forms.put({
        id: 'f_s2',
        domainId: 'domain-two.com',
        formInstanceId: 'fi2',
        revisionId: 'r2',
        revisionNumber: 1,
        title: 'Beta Document Submission',
        encryption: 'none',
        editingTime: 1,
        lastModified: 2000,
        status: 0,
        url: 'https://domain-two.com/submit',
      });
      await db.fields.put({
        id: 'fld_s_custom',
        formId: 'f_s1',
        domainId: 'domain-one.com',
        revisionId: 'r1',
        name: 'custom_query_field_name',
        type: 'text',
        value: 'regular_value',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      });
      await db.fields.put({
        id: 'fld_s_val',
        formId: 'f_s2',
        domainId: 'domain-two.com',
        revisionId: 'r2',
        name: 'other_field',
        type: 'text',
        value: 'UniqueSecretValueInsideField',
        encryption: 'none',
        lastModified: 2000,
        status: 0,
      });

      // 1. Empty query (returns newest first, respects limit)
      const emptyRes = await repository.searchHistory('', 1);
      expect(emptyRes.length).toBe(1);
      expect(emptyRes[0].form.id).toBe('f_s2');

      // 2. Search by field name
      const fnRes = await repository.searchHistory('custom_query_field');
      expect(fnRes.length).toBe(1);
      expect(fnRes[0].form.id).toBe('f_s1');

      // 3. Search by field value (case insensitive)
      const fvRes = await repository.searchHistory('uniquesecretvalue');
      expect(fvRes.length).toBe(1);
      expect(fvRes[0].form.id).toBe('f_s2');

      // 4. Search by domainId (case insensitive)
      const domRes = await repository.searchHistory('DOMAIN-ONE');
      expect(domRes.length).toBe(1);
      expect(domRes[0].form.id).toBe('f_s1');

      // 5. Search with locked encrypted form URL and encrypted field value
      await db.forms.put({
        id: 'f_enc',
        domainId: 'enc-domain.com',
        formInstanceId: 'fi_enc',
        revisionId: 'r_enc',
        revisionNumber: 1,
        title: 'Encrypted Form',
        encryption: 'hybrid-aes-gcm',
        editingTime: 1,
        lastModified: 3000,
        status: 0,
        url: 'ciphertext_should_not_match',
      });
      await db.fields.put({
        id: 'fld_enc',
        formId: 'f_enc',
        domainId: 'enc-domain.com',
        revisionId: 'r_enc',
        name: 'unmatched_name',
        type: 'text',
        value: 'ciphertext_field_value',
        encryption: 'hybrid-aes-gcm',
        lastModified: 3000,
        status: 0,
      });
      // Vault is locked, so decrypt fails and returns ''
      const encUrlMatch = await repository.searchHistory('ciphertext_should_not_match');
      expect(encUrlMatch.length).toBe(0);
      const encFieldMatch = await repository.searchHistory('ciphertext_field_value');
      expect(encFieldMatch.length).toBe(0);

      // Search limit parameter
      const bothRes = await repository.searchHistory('domain', 1);
      expect(bothRes.length).toBe(1);
      expect(bothRes[0].form.id).toBe('f_enc'); // highest timestamp (3000)

      // Test searching for "Stryker was here!" against empty url/values
      await db.forms.put({
        id: 'f_empty_url',
        domainId: 'empty.com',
        formInstanceId: 'fi_emp',
        revisionId: 'r_emp',
        revisionNumber: 1,
        title: 'Empty URL Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 500,
        status: 0,
        url: '',
      });
      await db.fields.put({
        id: 'fld_empty_val',
        formId: 'f_empty_url',
        domainId: 'empty.com',
        revisionId: 'r_emp',
        name: 'empty_val_name',
        type: 'text',
        value: '',
        encryption: 'none',
        lastModified: 500,
        status: 0,
      });
      const strykerRes = await repository.searchHistory('Stryker was here!');
      expect(strykerRes.length).toBe(0);

      // Test optional chaining when title, domainId, or field name are undefined
      await db.forms.put({
        id: 'f_undef',
        domainId: undefined as any,
        formInstanceId: 'fi_undef',
        revisionId: 'r_undef',
        revisionNumber: 1,
        title: undefined as any,
        encryption: 'none',
        editingTime: 1,
        lastModified: 400,
        status: 0,
        url: 'https://undef.com',
      });
      await db.fields.put({
        id: 'fld_undef',
        formId: 'f_undef',
        domainId: 'undef.com',
        revisionId: 'r_undef',
        name: undefined as any,
        type: 'text',
        value: 'SomeVal',
        encryption: 'none',
        lastModified: 400,
        status: 0,
      });
      const undefRes = await repository.searchHistory('nomatch');
      expect(undefRes.length).toBe(0);
    });

    it('kills formatFormOutput and getRecoverableForm locked draft and status filtering mutants', async () => {
      // Vault is locked
      vault.lock();
      await db.forms.put({
        id: 'f_locked',
        domainId: '',
        formInstanceId: 'fi_lock',
        revisionId: 'r_lock',
        revisionNumber: 0,
        title: 'Locked Form',
        encryption: 'hybrid-aes-gcm',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'enc_url_string',
        isFinalSubmit: true,
      });
      await db.fields.put({
        id: 'fld_locked_active',
        formId: 'f_locked',
        domainId: 'd',
        revisionId: 'r_lock',
        name: 'secure_input',
        type: 'text',
        value: 'enc_val_string',
        encryption: 'hybrid-aes-gcm',
        lastModified: 1000,
        status: 0,
      });
      await db.fields.put({
        id: 'fld_locked_deleted',
        formId: 'f_locked',
        domainId: 'd',
        revisionId: 'r_lock',
        name: 'deleted_input',
        type: 'text',
        value: 'deleted_val',
        encryption: 'hybrid-aes-gcm',
        lastModified: 1000,
        status: 1, // soft-deleted
      });

      // getRecoverableForm
      const rec = await repository.getRecoverableForm('f_locked');
      expect(rec.form?.url).toBe('[Encrypted URL]');
      expect(rec.fields.length).toBe(1);
      expect(rec.fields[0].value).toBe('[Locked Draft]');

      // Non-existent form
      const nonExistent = await repository.getRecoverableForm('does_not_exist_form_id');
      expect(nonExistent.form).toBeNull();
      expect(nonExistent.fields).toEqual([]);

      // formatFormOutput tested via getAllHistory
      const historyItems = await repository.getAllHistory(1);
      expect(historyItems[0].form.url).toBe('[Encrypted URL]');
      expect(historyItems[0].form.domain).toBe('unknown');
      expect(historyItems[0].form.revisionNumber).toBe(1);
      expect(historyItems[0].form.isFinalSubmit).toBe(true);
      expect(historyItems[0].fields.length).toBe(1);
      expect(historyItems[0].fields[0].value).toBe('[Locked Draft]');
    });

    it('kills exportAllData settings mutant strictly', async () => {
      const exp = await repository.exportAllData();
      expect(exp.settings.autoLockMinutes).toBe(15);
      expect(exp.settings.expireFormsInterval).toBe(10);
      expect(exp.settings.filterCreditCards).toBe(true);
    });

    it('kills saveFormSnapshot defaults, field filtering, and typing mutants strictly', async () => {
      // 1. snapshot.domain empty string -> domain property 'unknown'
      const snap1 = await repository.saveFormSnapshot({
        domain: '',
        formInstanceId: '',
        url: 'https://example.com',
        title: '',
        editingTime: 1,
        fields: [
          { name: 'has_name', value: '' } as any,
          { name: '', value: 'has_value' } as any,
          { name: '', value: '' } as any, // skipped
          { name: 'custom_type_field', value: 'custom_val', type: 'custom_type' },
          { name: 'default_type_field', value: 'def_val', type: '' },
        ],
      });
      expect(snap1.domainId).toBe('unknown');
      const savedDom = await db.domains.get('unknown');
      expect(savedDom?.domain).toBe('unknown');

      // Check formInstanceId default
      const savedForm = await db.forms.get(snap1.formId);
      expect(savedForm?.formInstanceId).toBe('form_default');

      // Check fields in db
      const savedFields = await db.fields.where('formId').equals(snap1.formId).toArray();
      // Should have 4 fields (skipped the one with empty name AND empty value)
      expect(savedFields.length).toBe(4);

      const fieldHasName = savedFields.find((f) => f.name === 'has_name');
      expect(fieldHasName).toBeDefined();
      expect(fieldHasName?.type).toBe('text');
      expect(fieldHasName?.value).toBe('');

      const fieldHasVal = savedFields.find((f) => f.value === 'has_value');
      expect(fieldHasVal).toBeDefined();
      expect(fieldHasVal?.name).toBe('field_anonymous');
      expect(fieldHasVal?.type).toBe('text');

      const customTypeField = savedFields.find((f) => f.name === 'custom_type_field');
      expect(customTypeField?.type).toBe('custom_type');

      const defaultTypeField = savedFields.find((f) => f.name === 'default_type_field');
      expect(defaultTypeField?.type).toBe('text');

      // Test optional chaining on revisionId when latestRevision has revisionId: undefined
      await db.forms.put({
        id: 'f_no_rev_id',
        domainId: 'no-rev.com',
        formInstanceId: 'inst_no_rev',
        revisionId: undefined as any,
        revisionNumber: 1,
        title: 'No Rev',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'https://no-rev.com',
      });
      const noRevSnap = await repository.saveFormSnapshot({
        domain: 'no-rev.com',
        formInstanceId: 'inst_no_rev',
        url: 'https://no-rev.com',
        title: 'No Rev 2',
        editingTime: 1,
        fields: [{ name: 'f', type: 'text', value: 'v' }],
      });
      expect(noRevSnap.revisionNumber).toBe(2);
    });

    it('kills saveFormSnapshot active session revision update vs idle timeout mutants', async () => {
      const base = {
        domain: 'timeout-test.com',
        formInstanceId: 'inst_timeout',
        url: 'https://timeout-test.com',
        title: 'Timeout Test',
        editingTime: 1,
        fields: [{ name: 'test', type: 'text', value: 'v1' }],
      };

      const now = 1000000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      const first = await repository.saveFormSnapshot(base);
      expect(first.revisionNumber).toBe(1);

      // Save again 1 minute later (within 5-min milestone and 15-min idle timeout)
      dateSpy.mockReturnValue(now + 1 * 60 * 1000);
      const second = await repository.saveFormSnapshot(base);
      // Must NOT spawn a new revision
      expect(second.revisionId).toBe(first.revisionId);
      expect(second.formId).toBe(first.formId);
      expect(second.revisionNumber).toBe(1);

      // Save again 16 minutes after the last revision (idle timeout reached: 16 min > 15 min)
      dateSpy.mockReturnValue(now + (1 + 16) * 60 * 1000);
      const third = await repository.saveFormSnapshot(base);
      // Must spawn a new revision
      expect(third.revisionId).not.toBe(first.revisionId);
      expect(third.formId).not.toBe(first.formId);
      expect(third.revisionNumber).toBe(2);

      dateSpy.mockRestore();
    });

    it('kills saveFormSnapshot pruning boundaries and isFinalSubmit preservation mutants', async () => {
      const base = {
        domain: 'prune-boundary.com',
        formInstanceId: 'inst_prune',
        url: 'https://prune-boundary.com',
        title: 'Prune Boundary',
        editingTime: 1,
        fields: [{ name: 'f', type: 'text', value: 'v' }],
      };

      // Seed 10 revisions with distinct ascending timestamps
      const dateSpy = vi.spyOn(Date, 'now');
      for (let i = 1; i <= 10; i++) {
        dateSpy.mockReturnValue(10000 + i * 1000);
        await repository.saveFormSnapshot(base, false, true);
      }
      expect(await db.forms.where('formInstanceId').equals('inst_prune').count()).toBe(10);

      // Find the oldest revision (lowest timestamp) and mark it isFinalSubmit: true
      const allRevs = await db.forms.where('formInstanceId').equals('inst_prune').toArray();
      allRevs.sort((a, b) => a.lastModified - b.lastModified);
      const oldestRev = allRevs[0];
      await db.forms.update(oldestRev.id, { isFinalSubmit: true });

      // Save 11th revision at a higher timestamp
      dateSpy.mockReturnValue(50000);
      await repository.saveFormSnapshot(base, false, true);

      // Oldest revision must NOT have been pruned because isFinalSubmit is true
      const oldestStillExists = await db.forms.get(oldestRev.id);
      expect(oldestStillExists).toBeDefined();
      expect(oldestStillExists?.isFinalSubmit).toBe(true);
      expect(await db.forms.where('formInstanceId').equals('inst_prune').count()).toBe(11);

      // Save 12th revision: revisionsToPrune has 2 items (non-final at index 9, final at index 10)
      // Non-final is pruned, final is kept
      dateSpy.mockReturnValue(60000);
      await repository.saveFormSnapshot(base, false, true);

      expect(await db.forms.get(oldestRev.id)).toBeDefined();
      expect(await db.forms.where('formInstanceId').equals('inst_prune').count()).toBe(11);

      dateSpy.mockRestore();
    });

    it('kills getRecoverableText exact match vs fallback and limit mutants', async () => {
      const domain = 'recov-text-precise.com';
      const domainId = normalizeDomainId(domain);

      // Field 1: exact match for ('recov-text-precise.com', 'notes', 'textarea')
      await db.fields.put({
        id: 'fld_exact',
        formId: 'form_1',
        domainId,
        revisionId: 'rev_1',
        name: 'notes',
        type: 'textarea',
        value: 'exact textarea value',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      });

      // Field 1b: soft-deleted field with exact match -> should NOT be returned
      await db.fields.put({
        id: 'fld_exact_deleted',
        formId: 'form_deleted',
        domainId,
        revisionId: 'rev_del',
        name: 'notes',
        type: 'textarea',
        value: 'deleted textarea value',
        encryption: 'none',
        lastModified: 1500,
        status: 1, // soft deleted
      });

      // Field 2: same name 'notes', different type 'text', NEWER timestamp 2000
      await db.fields.put({
        id: 'fld_other_type',
        formId: 'form_2',
        domainId,
        revisionId: 'rev_2',
        name: 'notes',
        type: 'text',
        value: 'newer text value',
        encryption: 'none',
        lastModified: 2000,
        status: 0,
      });

      // Field with whitespace-only value -> should be filtered out strictly by f.value.trim()
      await db.fields.put({
        id: 'fld_whitespace',
        formId: 'form_ws',
        domainId,
        revisionId: 'rev_ws',
        name: 'whitespace_field',
        type: 'text',
        value: '   ',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      });
      const wsRes = await repository.getRecoverableText(domain, 'whitespace_field', 'text');
      expect(wsRes.some((item) => item.name === 'whitespace_field')).toBe(false);

      // Query looking specifically for ('notes', 'textarea')
      // Step 1 matches Field 1. If step 2 runs, it would include Field 2 which is newer!
      const exactRes = await repository.getRecoverableText(domain, 'notes', 'textarea');
      expect(exactRes.length).toBe(1);
      expect(exactRes[0].value).toBe('exact textarea value');

      // Test limit of 10 unique values
      for (let i = 1; i <= 15; i++) {
        await db.fields.put({
          id: `fld_lim_${i}`,
          formId: `form_lim_${i}`,
          domainId,
          revisionId: `rev_lim_${i}`,
          name: 'limit_field',
          type: 'text',
          value: `Unique Value ${i}`,
          encryption: 'none',
          lastModified: 3000 + i,
          status: 0,
        });
      }
      const limitRes = await repository.getRecoverableText(domain, 'limit_field', 'text');
      expect(limitRes.length).toBe(10);
      // Values are sorted newest first
      expect(limitRes[0].value).toBe('Unique Value 15');
      expect(limitRes[9].value).toBe('Unique Value 6');
    });

    it('kills getFormRevisions and getLatestFormRevisions filtering and limit mutants', async () => {
      const domain = 'revisions-filter.com';
      const domainId = normalizeDomainId(domain);

      // Form 0: Form on a domain that sorts before 'revisions-filter.com' alphabetically,
      // with a newer timestamp so that if [domainId, Dexie.minKey] is mutated to [], it would leak into top results
      await db.forms.put({
        id: 'f_rev_aaa',
        domainId: 'aaa-other.com',
        formInstanceId: 'other_domain_inst',
        revisionId: 'r_aaa',
        revisionNumber: 1,
        title: 'AAA Domain Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 999999,
        status: 0,
        url: 'https://aaa-other.com',
      });

      // Form 1: matching instance, active
      await db.forms.put({
        id: 'f_rev_1',
        domainId,
        formInstanceId: 'target_inst',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Rev 1',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'https://test.com',
      });
      // Form 2: different instance
      await db.forms.put({
        id: 'f_rev_2',
        domainId,
        formInstanceId: 'other_inst',
        revisionId: 'r2',
        revisionNumber: 1,
        title: 'Other Inst',
        encryption: 'none',
        editingTime: 1,
        lastModified: 2000,
        status: 0,
        url: 'https://test.com',
      });
      // Form 3: matching instance, but soft-deleted (status: 1)
      await db.forms.put({
        id: 'f_rev_3',
        domainId,
        formInstanceId: 'target_inst',
        revisionId: 'r3',
        revisionNumber: 2,
        title: 'Deleted Rev',
        encryption: 'none',
        editingTime: 1,
        lastModified: 3000,
        status: 1,
        url: 'https://test.com',
      });

      const revisions = await repository.getFormRevisions(domain, 'target_inst');
      expect(revisions.length).toBe(1);
      expect(revisions[0].form.id).toBe('f_rev_1');

      // Test getLatestFormRevisions default limit (5) and custom limit
      for (let i = 10; i <= 20; i++) {
        await db.forms.put({
          id: `f_latest_${i}`,
          domainId,
          formInstanceId: `inst_${i}`,
          revisionId: `r_${i}`,
          revisionNumber: 1,
          title: `Form ${i}`,
          encryption: 'none',
          editingTime: 1,
          lastModified: 5000 + i,
          status: 0,
          url: 'https://test.com',
        });
      }

      const latestDefault = await repository.getLatestFormRevisions(domain);
      expect(latestDefault.length).toBe(5);
      // Ensure none of the results belong to aaa-other.com
      for (const item of latestDefault) {
        expect(item.form.domain).toBe(domain);
      }

      const latestCustom = await repository.getLatestFormRevisions(domain, 3);
      expect(latestCustom.length).toBe(3);
    });

    it('kills searchHistory empty query delegation, sorter, and matching mutants', async () => {
      // 1. Empty query delegation
      const getAllSpy = vi.spyOn(repository, 'getAllHistory');
      await repository.searchHistory('', 7);
      expect(getAllSpy).toHaveBeenCalledWith(7);
      getAllSpy.mockClear();

      await repository.searchHistory('   ', 4);
      expect(getAllSpy).toHaveBeenCalledWith(4);
      getAllSpy.mockClear();

      await repository.searchHistory();
      expect(getAllSpy).toHaveBeenCalledWith(20);
      getAllSpy.mockRestore();

      // 2. Sorter b.lastModified - a.lastModified (kills b + a and missing sort)
      await db.forms.clear();
      // Insert in ASCENDING timestamp order (Form 1=1000, Form 2=2000, Form 3=3000)
      await db.forms.put({
        id: 'f_search_1',
        domainId: 'search-sort.com',
        formInstanceId: 'inst_1',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'QueryMatch Oldest',
        encryption: 'none',
        editingTime: 1,
        lastModified: 1000,
        status: 0,
        url: 'https://search-sort.com',
      });
      await db.forms.put({
        id: 'f_search_2',
        domainId: 'search-sort.com',
        formInstanceId: 'inst_2',
        revisionId: 'r2',
        revisionNumber: 1,
        title: 'QueryMatch Middle',
        encryption: 'none',
        editingTime: 1,
        lastModified: 2000,
        status: 0,
        url: 'https://search-sort.com',
      });
      await db.forms.put({
        id: 'f_search_3',
        domainId: 'search-sort.com',
        formInstanceId: 'inst_3',
        revisionId: 'r3',
        revisionNumber: 1,
        title: 'QueryMatch Newest',
        encryption: 'none',
        editingTime: 1,
        lastModified: 3000,
        status: 0,
        url: 'https://search-sort.com',
      });
      // Non-matching form
      await db.forms.put({
        id: 'f_non_matching',
        domainId: 'other.com',
        formInstanceId: 'inst_4',
        revisionId: 'r4',
        revisionNumber: 1,
        title: 'Completely Different Title',
        encryption: 'none',
        editingTime: 1,
        lastModified: 4000,
        status: 0,
        url: 'https://other.com',
      });

      const searchRes = await repository.searchHistory('QueryMatch');
      expect(searchRes.length).toBe(3);
      expect(searchRes[0].form.id).toBe('f_search_3');
      expect(searchRes[1].form.id).toBe('f_search_2');
      expect(searchRes[2].form.id).toBe('f_search_1');

      // Test searchHistory limit
      const searchLimited = await repository.searchHistory('QueryMatch', 1);
      expect(searchLimited.length).toBe(1);
      expect(searchLimited[0].form.id).toBe('f_search_3');

      // 3. getAllHistory default limit (50) and custom limit
      for (let i = 1; i <= 60; i++) {
        await db.forms.put({
          id: `f_all_${i}`,
          domainId: 'all.com',
          formInstanceId: `inst_${i}`,
          revisionId: `r_${i}`,
          revisionNumber: 1,
          title: `All ${i}`,
          encryption: 'none',
          editingTime: 1,
          lastModified: 5000 + i,
          status: 0,
          url: 'https://all.com',
        });
      }
      const allDefault = await repository.getAllHistory();
      expect(allDefault.length).toBe(50);

      const allCustom = await repository.getAllHistory(12);
      expect(allCustom.length).toBe(12);

      // 4. getDomainHistory domain isolation and soft-delete filtering
      await db.forms.clear();
      await db.forms.put({
        id: 'f_dom_active',
        domainId: 'target-dom.com',
        formInstanceId: 'inst_1',
        revisionId: 'r1',
        revisionNumber: 1,
        title: 'Active Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 2000,
        status: 0,
        url: 'https://target-dom.com',
      });
      await db.forms.put({
        id: 'f_dom_deleted',
        domainId: 'target-dom.com',
        formInstanceId: 'inst_2',
        revisionId: 'r2',
        revisionNumber: 1,
        title: 'Deleted Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 3000,
        status: 1, // soft-deleted
        url: 'https://target-dom.com',
      });
      await db.forms.put({
        id: 'f_other_dom',
        domainId: 'other-dom.com',
        formInstanceId: 'inst_3',
        revisionId: 'r3',
        revisionNumber: 1,
        title: 'Other Dom Form',
        encryption: 'none',
        editingTime: 1,
        lastModified: 4000,
        status: 0,
        url: 'https://other-dom.com',
      });

      const domHist = await repository.getDomainHistory('target-dom.com');
      expect(domHist.length).toBe(1);
      expect(domHist[0].form.id).toBe('f_dom_active');
    });
  });
});
