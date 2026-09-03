import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { LazarusDatabase } from '../../src/common/db/lazarus-db';
import { IDBDomain, IDBForm, IDBField, IDBSetting } from '../../src/common/types/schema';

describe('LazarusDatabase Unit Tests (Dexie + IndexedDB)', () => {
  let db: LazarusDatabase;

  beforeEach(async () => {
    // Unique database name per test to ensure clean isolation
    const dbName = `TestLazarusDb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db = new LazarusDatabase();
    // Re-instantiate with unique name
    (db as any).name = dbName;
    await db.open();
  });

  describe('Domains Table', () => {
    it('should add and retrieve a domain record', async () => {
      const domainRecord: IDBDomain = {
        id: 'hash-github-com',
        domain: 'github.com',
        totalEditingTime: 120,
        lastModified: Date.now(),
        status: 0,
      };

      await db.domains.put(domainRecord);
      const retrieved = await db.domains.get('hash-github-com');

      expect(retrieved).toBeDefined();
      expect(retrieved?.domain).toBe('github.com');
      expect(retrieved?.totalEditingTime).toBe(120);
      expect(retrieved?.status).toBe(0);
    });

    it('should update totalEditingTime for an existing domain', async () => {
      const domainRecord: IDBDomain = {
        id: 'hash-reddit-com',
        domain: 'reddit.com',
        totalEditingTime: 30,
        lastModified: Date.now(),
        status: 0,
      };

      await db.domains.put(domainRecord);
      await db.domains.update('hash-reddit-com', {
        totalEditingTime: 95,
        lastModified: Date.now(),
      });

      const updated = await db.domains.get('hash-reddit-com');
      expect(updated?.totalEditingTime).toBe(95);
    });
  });

  describe('Forms Table & Compound Indexes', () => {
    it('should store and query forms by compound index [domainId+lastModified]', async () => {
      const domainId = 'domain-123';
      const now = Date.now();

      const form1: IDBForm = {
        id: 'form-1',
        domainId,
        url: 'https://example.com/login',
        formInstanceId: 'login-form',
        title: 'Login Page',
        encryption: 'none',
        editingTime: 15,
        lastModified: now - 5000,
        status: 0,
      };

      const form2: IDBForm = {
        id: 'form-2',
        domainId,
        url: 'https://example.com/checkout',
        formInstanceId: 'checkout-form',
        title: 'Checkout Page',
        encryption: 'none',
        editingTime: 60,
        lastModified: now,
        status: 0,
      };

      await db.forms.bulkPut([form1, form2]);

      // Query by compound index
      const results = await db.forms
        .where('[domainId+lastModified]')
        .between([domainId, Dexie.minKey], [domainId, Dexie.maxKey])
        .toArray();

      expect(results.length).toBe(2);
      expect(results.map(f => f.id)).toContain('form-1');
      expect(results.map(f => f.id)).toContain('form-2');
    });

    it('should filter out soft-deleted forms', async () => {
      const activeForm: IDBForm = {
        id: 'active-form',
        domainId: 'domain-abc',
        url: 'https://site.com/post',
        formInstanceId: 'post-form',
        title: 'Post',
        encryption: 'none',
        editingTime: 40,
        lastModified: Date.now(),
        status: 0, // Active
      };

      const deletedForm: IDBForm = {
        id: 'deleted-form',
        domainId: 'domain-abc',
        url: 'https://site.com/post',
        formInstanceId: 'post-form-old',
        title: 'Post Old',
        encryption: 'none',
        editingTime: 10,
        lastModified: Date.now() - 10000,
        status: 1, // Soft-deleted
      };

      await db.forms.bulkPut([activeForm, deletedForm]);

      const activeList = await db.forms.where('status').equals(0).toArray();
      expect(activeList.length).toBe(1);
      expect(activeList[0].id).toBe('active-form');
    });

    it('should identify expired forms based on retention interval', async () => {
      const now = Date.now();
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
      const expiredThreshold = now - tenDaysMs;

      const freshForm: IDBForm = {
        id: 'fresh-form',
        domainId: 'domain-xyz',
        url: 'https://news.ycombinator.com',
        formInstanceId: 'hn-comment',
        title: 'Hacker News',
        encryption: 'none',
        editingTime: 25,
        lastModified: now - 3600000, // 1 hour old
        status: 0,
      };

      const oldForm: IDBForm = {
        id: 'old-form',
        domainId: 'domain-xyz',
        url: 'https://news.ycombinator.com',
        formInstanceId: 'hn-comment-old',
        title: 'Hacker News Old',
        encryption: 'none',
        editingTime: 10,
        lastModified: now - (12 * 24 * 60 * 60 * 1000), // 12 days old
        status: 0,
      };

      await db.forms.bulkPut([freshForm, oldForm]);

      // Query records older than threshold
      const expiredForms = await db.forms
        .where('lastModified')
        .below(expiredThreshold)
        .toArray();

      expect(expiredForms.length).toBe(1);
      expect(expiredForms[0].id).toBe('old-form');
    });
  });

  describe('Fields Table & Compound Indexes', () => {
    it('should query field history by [domainId+name+type]', async () => {
      const domainId = 'domain-gh';
      const field1: IDBField = {
        id: 'field-1',
        formId: 'form-a',
        domainId,
        name: 'issue_title',
        type: 'text',
        value: 'Initial issue draft',
        encryption: 'none',
        lastModified: 1000,
        status: 0,
      };

      const field2: IDBField = {
        id: 'field-2',
        formId: 'form-b',
        domainId,
        name: 'issue_title',
        type: 'text',
        value: 'Revised issue draft with more details',
        encryption: 'none',
        lastModified: 2000,
        status: 0,
      };

      const field3Other: IDBField = {
        id: 'field-3',
        formId: 'form-a',
        domainId,
        name: 'issue_body',
        type: 'textarea',
        value: 'Body text',
        encryption: 'none',
        lastModified: 1500,
        status: 0,
      };

      await db.fields.bulkPut([field1, field2, field3Other]);

      // Query history for issue_title
      const history = await db.fields
        .where('[domainId+name+type]')
        .equals([domainId, 'issue_title', 'text'])
        .sortBy('lastModified');

      expect(history.length).toBe(2);
      expect(history[0].value).toBe('Initial issue draft');
      expect(history[1].value).toBe('Revised issue draft with more details');
    });
  });

  describe('Settings Table', () => {
    it('should store and read configuration flags', async () => {
      const setting: IDBSetting = {
        key: 'expireFormsInterval',
        value: 14,
        lastModified: Date.now(),
      };

      await db.settings.put(setting);
      const retrieved = await db.settings.get('expireFormsInterval');

      expect(retrieved?.value).toBe(14);
    });
  });
});
