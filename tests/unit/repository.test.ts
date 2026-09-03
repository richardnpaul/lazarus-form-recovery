import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import { repository, normalizeDomainId, matchesDomainPattern } from '../../src/common/db/repository';
import { vault } from '../../src/common/crypto/vault';

describe('LazarusRepository Full Branch Coverage (src/common/db/repository.ts)', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
    vault.lock();
  });

  describe('Utility functions', () => {
    it('normalizes domain identifiers correctly', () => {
      expect(normalizeDomainId('')).toBe('unknown');
      expect(normalizeDomainId('https://SUB.EXAMPLE.COM:8080/path?q=1')).toBe('sub.example.com');
      expect(normalizeDomainId('http://localhost:3000/')).toBe('localhost');
      expect(normalizeDomainId('example.org')).toBe('example.org');
    });

    it('matches wildcard domain patterns', () => {
      expect(matchesDomainPattern('mail.google.com', '*.google.com')).toBe(true);
      expect(matchesDomainPattern('google.com', 'google.com')).toBe(true);
      expect(matchesDomainPattern('evil-google.com', '*.google.com')).toBe(false);
      expect(matchesDomainPattern('sub.mail.google.com', '*.google.com')).toBe(true);
    });
  });

  describe('CRUD & Revisions & Pruning', () => {
    it('handles default domain, milestones, and pruning beyond 10 revisions', async () => {
      const baseSnapshot = {
        formInstanceId: 'prune-form',
        url: 'https://example.com/form',
        domain: '', // triggers 'unknown' domain
        title: '',
        editingTime: 5,
        fields: [{ name: 'notes', type: 'textarea', value: 'v1' }],
      };

      // Save 12 revisions to trigger pruning
      for (let i = 1; i <= 12; i++) {
        await repository.saveFormSnapshot(
          {
            ...baseSnapshot,
            fields: [{ name: 'notes', type: 'textarea', value: `Revision note ${i}` }],
          },
          false,
          true // forceNewRevision
        );
      }

      const forms = await db.forms.toArray();
      // Should cap at 10 or 9
      expect(forms.length).toBeLessThanOrEqual(10);
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
      expect(res.form.url).toBe('[Encrypted URL]');
      expect(res.fields[0].value).toBe('[Locked Draft]');

      // Decrypt succeeds
      vi.spyOn(vault, 'decrypt').mockImplementation(async (val: string) => {
        if (val === 'ciphertext_url') return 'https://secure.com/decrypted';
        if (val === 'ciphertext_val') return 'Decrypted Secret Value';
        return val;
      });

      const resDecrypted = await repository.getRecoverableForm('enc_form');
      expect(resDecrypted.form.url).toBe('https://secure.com/decrypted');
      expect(resDecrypted.fields[0].value).toBe('Decrypted Secret Value');
    });

    it('searches history matching by title, domain, field name, and field value', async () => {
      const snap1 = {
        formInstanceId: 'f1',
        url: 'https://alpha.org/edit',
        domain: 'alpha.org',
        title: 'Alpha Form Title',
        editingTime: 1,
        fields: [{ name: 'user_bio', type: 'text', value: 'SpecialKeywordInValue' }],
      };
      await repository.saveFormSnapshot(snap1);

      // Search by domain
      const matchDomain = await repository.searchHistory('alpha.org');
      expect(matchDomain.length).toBe(1);

      // Search by title
      const matchTitle = await repository.searchHistory('Alpha Form');
      expect(matchTitle.length).toBe(1);

      // Search by field name
      const matchFieldName = await repository.searchHistory('user_bio');
      expect(matchFieldName.length).toBe(1);

      // Search by field value
      const matchVal = await repository.searchHistory('SpecialKeyword');
      expect(matchVal.length).toBe(1);

      // No match
      const noMatch = await repository.searchHistory('NonexistentQuery123');
      expect(noMatch.length).toBe(0);
    });

    it('handles domain history, all history, and domain wiping', async () => {
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

      const allHist = await repository.getAllHistory();
      expect(allHist.length).toBeGreaterThan(0);

      // Disable domain with wipe
      await repository.disableDomain('wipe-me.com', true);
      const afterWipe = await repository.getDomainHistory('wipe-me.com');
      expect(afterWipe.length).toBe(0);
    });
  });
});
