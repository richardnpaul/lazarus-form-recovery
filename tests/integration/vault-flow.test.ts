import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/common/db/lazarus-db';
import '../../src/background/service-worker';

describe('Vault Security & Encryption Integration Flow', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
  });

  it('should encrypt form records when Master Password is set and lock/unlock transparently', async () => {
    // 1. Configure Master Password via background message
    const setPassRes = await chrome.runtime.sendMessage({
      type: 'SET_MASTER_PASSWORD',
      payload: { password: 'TopSecretPassword99!' },
    });
    expect(setPassRes.success).toBe(true);

    // 2. Save a form snapshot while unlocked
    const saveRes = await chrome.runtime.sendMessage({
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'secure-login-form',
          url: 'https://secure.example.com/login',
          domain: 'secure.example.com',
          title: 'Secure Account Form',
          editingTime: 20,
          fields: [
            { name: 'sensitive_memo', type: 'textarea', value: 'My private encrypted note' },
          ],
        },
      },
    });
    expect(saveRes.success).toBe(true);

    // 3. Inspect raw IndexedDB record to verify it is NOT plaintext
    const rawFields = await db.fields.toArray();
    expect(rawFields.length).toBe(1);
    expect(rawFields[0].encryption).toBe('hybrid-aes-gcm');
    expect(rawFields[0].value).not.toBe('My private encrypted note');

    // 4. Query history while vault is still unlocked
    const openHistoryRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
    expect(openHistoryRes.success).toBe(true);
    expect(openHistoryRes.data[0].fields[0].value).toBe('My private encrypted note');

    // 5. Lock the vault
    const lockRes = await chrome.runtime.sendMessage({ type: 'LOCK_VAULT' });
    expect(lockRes.success).toBe(true);

    // 6. Query history while locked: should yield '[Locked Draft]' placeholder
    const lockedHistoryRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
    expect(lockedHistoryRes.success).toBe(true);
    expect(lockedHistoryRes.data[0].fields[0].value).toBe('[Locked Draft]');

    // 7. Unlock the vault with the correct password
    const unlockRes = await chrome.runtime.sendMessage({
      type: 'UNLOCK_VAULT',
      payload: { password: 'TopSecretPassword99!' },
    });
    expect(unlockRes.success).toBe(true);

    // 8. Query history again: should now be decrypted
    const restoredHistoryRes = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY' });
    expect(restoredHistoryRes.success).toBe(true);
    expect(restoredHistoryRes.data[0].fields[0].value).toBe('My private encrypted note');
  });
});
