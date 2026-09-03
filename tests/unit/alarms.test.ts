import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import { repository } from '../../src/common/db/repository';

describe('Alarms & Retention Cleanup Unit Tests', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.settings.clear();
  });

  it('should clean up form records older than the retention policy', async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Set retention to 7 days
    await repository.updateSettings({ expireFormsInterval: 7 });

    // Recent form (1 day old)
    await db.forms.put({
      id: 'recent-form',
      domainId: 'site.com',
      url: 'https://site.com/recent',
      formInstanceId: 'f1',
      revisionId: 'rev_1',
      revisionNumber: 1,
      title: 'Recent Form',
      encryption: 'none',
      editingTime: 10,
      lastModified: now - 1 * dayMs,
      status: 0,
    });
    await db.fields.put({
      id: 'field-recent',
      formId: 'recent-form',
      domainId: 'site.com',
      revisionId: 'rev_1',
      name: 'input1',
      type: 'text',
      value: 'Fresh value',
      encryption: 'none',
      lastModified: now - 1 * dayMs,
      status: 0,
    });

    // Expired form (10 days old, > 7 days threshold)
    await db.forms.put({
      id: 'expired-form',
      domainId: 'site.com',
      url: 'https://site.com/expired',
      formInstanceId: 'f2',
      revisionId: 'rev_2',
      revisionNumber: 1,
      title: 'Expired Form',
      encryption: 'none',
      editingTime: 5,
      lastModified: now - 10 * dayMs,
      status: 0,
    });
    await db.fields.put({
      id: 'field-expired',
      formId: 'expired-form',
      domainId: 'site.com',
      revisionId: 'rev_2',
      name: 'input2',
      type: 'text',
      value: 'Old value',
      encryption: 'none',
      lastModified: now - 10 * dayMs,
      status: 0,
    });

    expect(await db.forms.count()).toBe(2);
    expect(await db.fields.count()).toBe(2);

    const cleaned = await repository.cleanupExpiredForms();
    expect(cleaned).toBe(1);

    // Verify only recent form remains
    const remainingForms = await db.forms.toArray();
    expect(remainingForms.length).toBe(1);
    expect(remainingForms[0].id).toBe('recent-form');

    const remainingFields = await db.fields.toArray();
    expect(remainingFields.length).toBe(1);
    expect(remainingFields[0].id).toBe('field-recent');
  });

  it('registers periodic alarms and handles onAlarm events', async () => {
    const { setupAlarms } = await import('../../src/background/alarms');
    setupAlarms();
    expect(chrome.alarms.create).toHaveBeenCalledWith('cleanup-expired-forms', {
      periodInMinutes: 30,
    });

    const alarmListeners = (chrome.alarms.onAlarm.addListener as any).mock?.calls || [];
    if (alarmListeners.length > 0) {
      const alarmHandler = alarmListeners[0][0];
      // 1. Alarm with cleanedCount > 0
      vi.spyOn(repository, 'cleanupExpiredForms').mockResolvedValueOnce(5);
      await alarmHandler({ name: 'cleanup-expired-forms' });

      // 2. Alarm with error
      vi.spyOn(repository, 'cleanupExpiredForms').mockRejectedValueOnce(new Error('CleanupFailed'));
      await alarmHandler({ name: 'cleanup-expired-forms' });

      // 3. Non-matching alarm name
      await alarmHandler({ name: 'unknown-alarm' });
    }
  });
});
