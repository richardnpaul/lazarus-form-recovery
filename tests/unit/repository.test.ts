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

      const originalWhere = db.forms.where.bind(db.forms);
      vi.spyOn(db.forms, 'where').mockImplementation(((indexName: any) => {
        if (indexName === '[domainId+lastModified]') {
          throw new Error('CompoundIndexUnavailable');
        }
        return originalWhere(indexName);
      }) as any);

      // 1. getLatestFormRevisions should catch error and use domainId fallback, strictly filtering status 0!
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

      // 1. Fallback in getRecoverableFields when [domainId+name+type] throws (exercises line 282)
      const originalFieldsWhere = db.fields.where.bind(db.fields);
      vi.spyOn(db.fields, 'where').mockImplementation(((indexName: any) => {
        if (indexName === '[domainId+name+type]') {
          throw new Error('FieldsCompoundIndexUnavailable');
        }
        return originalFieldsWhere(indexName);
      }) as any);

      const fieldsRes = await repository.getRecoverableText('rev-test.com', 'feedback', 'text');
      expect(fieldsRes.length).toBe(1);
      expect(fieldsRes[0].value).toBe('Fallback Field Value');

      // 2. Fallback in getFormRevisions when [domainId+lastModified] throws (exercises line 368)
      const originalFormsWhere = db.forms.where.bind(db.forms);
      vi.spyOn(db.forms, 'where').mockImplementation(((indexName: any) => {
        if (indexName === '[domainId+lastModified]') {
          throw new Error('FormsCompoundIndexUnavailable');
        }
        return originalFormsWhere(indexName);
      }) as any);

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
});
