import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleRuntimeMessage } from '../../src/background/message-router';
import { container } from '../../src/core/container';
import { FormSnapshot } from '../../src/common/types/messages';
import { repository } from '../../src/common/db/repository';

describe('MessageRouter Mutation Resistance Tests (src/background/message-router.ts)', () => {
  const sampleForm: FormSnapshot = {
    formInstanceId: 'f1',
    url: 'https://example.com/form',
    domain: 'example.com',
    title: 'Example Form',
    editingTime: 5,
    fields: [{ name: 'name', type: 'text', value: 'John' }],
  };

  const matchingSender: chrome.runtime.MessageSender = {
    tab: { id: 101, url: 'https://example.com/form' } as any,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('kills FORM_SAVED boolean literal mutant', async () => {
    const res = await handleRuntimeMessage({ type: 'FORM_SAVED' as any }, {} as any);
    expect(res).toEqual({ success: true });
    expect(res.success).toBe(true);
  });

  it('kills matching domain warnings for all 10 message types strictly', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 1. SAVE_AUTOSAVE
    vi.spyOn(container.saveFormDraftUseCase, 'execute').mockResolvedValue({ success: true } as any);
    await handleRuntimeMessage(
      { type: 'SAVE_AUTOSAVE', payload: { form: { ...sampleForm } } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 2. SUBMIT_FORM
    vi.spyOn(container.submitFormUseCase, 'execute').mockResolvedValue({ success: true } as any);
    await handleRuntimeMessage(
      { type: 'SUBMIT_FORM', payload: { form: { ...sampleForm } } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 3. FORCE_SAVE_SNAPSHOT
    await handleRuntimeMessage(
      { type: 'FORCE_SAVE_SNAPSHOT', payload: { form: { ...sampleForm } } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 4. UPDATE_CONTEXT_MENU
    await handleRuntimeMessage(
      {
        type: 'UPDATE_CONTEXT_MENU',
        payload: {
          domain: 'example.com',
          formInstanceId: 'f1',
          fieldName: 'name',
          fieldType: 'text',
        },
      },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 5. GET_RECOVERABLE_TEXT
    vi.spyOn(container.restoreFormUseCase, 'getRecoverableText').mockResolvedValue([]);
    await handleRuntimeMessage(
      {
        type: 'GET_RECOVERABLE_TEXT',
        payload: { domain: 'example.com', fieldName: 'name', fieldType: 'text' },
      },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 6. IS_DOMAIN_ENABLED
    vi.spyOn(container.domainPolicyUseCase, 'isDomainEnabled').mockResolvedValue(true);
    await handleRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'example.com' } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 7. DISABLE_DOMAIN
    vi.spyOn(container.domainPolicyUseCase, 'setDomainEnabled').mockResolvedValue(undefined as any);
    await handleRuntimeMessage(
      { type: 'DISABLE_DOMAIN', payload: { domain: 'example.com' } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 8. ENABLE_DOMAIN
    const enableRes = await handleRuntimeMessage(
      { type: 'ENABLE_DOMAIN', payload: { domain: 'example.com' } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(enableRes).toEqual({ success: true });

    // 9. GET_DOMAIN_HISTORY
    vi.spyOn(container.historyQueryUseCase, 'getDomainHistory').mockResolvedValue([]);
    await handleRuntimeMessage(
      { type: 'GET_DOMAIN_HISTORY', payload: { domain: 'example.com', limit: 10 } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    // 10. GET_FORM_REVISIONS
    vi.spyOn(container.historyQueryUseCase, 'getFormRevisions').mockResolvedValue([]);
    await handleRuntimeMessage(
      { type: 'GET_FORM_REVISIONS', payload: { domain: 'example.com', formInstanceId: 'f1' } },
      matchingSender
    );
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('kills SAVE_AUTOSAVE and FORCE_SAVE_SNAPSHOT forceNewRevision boolean mutants', async () => {
    const execSpy = vi
      .spyOn(container.saveFormDraftUseCase, 'execute')
      .mockResolvedValue({ success: true } as any);

    // SAVE_AUTOSAVE must call with forceNewRevision = false
    await handleRuntimeMessage({ type: 'SAVE_AUTOSAVE', payload: { form: { ...sampleForm } } }, {
      tab: { id: 77 },
    } as any);
    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'example.com' }),
      77,
      false
    );

    // FORCE_SAVE_SNAPSHOT must call with forceNewRevision = true
    await handleRuntimeMessage(
      { type: 'FORCE_SAVE_SNAPSHOT', payload: { form: { ...sampleForm } } },
      { tab: { id: 88 } } as any
    );
    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'example.com' }),
      88,
      true
    );
  });

  it('kills REMOVE_MASTER_PASSWORD string literal and boolean mutants', async () => {
    // 1. Password incorrect
    vi.spyOn(container.vaultSecurityUseCase, 'unlock').mockResolvedValue({
      success: false,
      error: 'WrongPass',
    });
    const failRes = await handleRuntimeMessage(
      { type: 'REMOVE_MASTER_PASSWORD', payload: { currentPassword: 'incorrect' } },
      {} as any
    );
    expect(failRes.success).toBe(false);
    expect(failRes.error).toBe('Current password incorrect');

    // 2. Password correct -> removes master password
    vi.spyOn(container.vaultSecurityUseCase, 'unlock').mockResolvedValue({ success: true });
    vi.spyOn(container.vaultSecurityUseCase, 'removeMasterPassword').mockResolvedValue({
      success: true,
    });
    const okRes = await handleRuntimeMessage(
      { type: 'REMOVE_MASTER_PASSWORD', payload: { currentPassword: 'correct' } },
      {} as any
    );
    expect(okRes.success).toBe(true);
  });

  it('kills DELETE_FORM and CLEAR_ALL_HISTORY case execution mutants', async () => {
    const deleteSpy = vi
      .spyOn(container.historyQueryUseCase, 'deleteForm')
      .mockResolvedValue(undefined as any);
    const delRes = await handleRuntimeMessage(
      { type: 'DELETE_FORM', payload: { formId: 'target_form_123' } },
      {} as any
    );
    expect(deleteSpy).toHaveBeenCalledWith('target_form_123');
    expect(delRes).toEqual({ success: true });

    const clearSpy = vi
      .spyOn(container.historyQueryUseCase, 'clearAll')
      .mockResolvedValue(undefined as any);
    const clearRes = await handleRuntimeMessage({ type: 'CLEAR_ALL_HISTORY' }, {} as any);
    expect(clearSpy).toHaveBeenCalled();
    expect(clearRes).toEqual({ success: true });

    // GET_ALL_HISTORY
    const allSpy = vi
      .spyOn(container.historyQueryUseCase, 'getAllHistory')
      .mockResolvedValue(['item1'] as any);
    const allRes = await handleRuntimeMessage(
      { type: 'GET_ALL_HISTORY', payload: { limit: 5 } },
      {} as any
    );
    expect(allSpy).toHaveBeenCalledWith(5);
    expect(allRes).toEqual({ success: true, data: ['item1'] });
  });

  it('kills OPEN_OPTIONS_PAGE branches and optional chaining mutants', async () => {
    // 1. chrome.runtime.openOptionsPage is available
    const openOptionsPage = vi.fn();
    (chrome.runtime as any).openOptionsPage = openOptionsPage;
    (chrome.tabs.create as any).mockClear();

    const res1 = await handleRuntimeMessage({ type: 'OPEN_OPTIONS_PAGE' }, {} as any);
    expect(res1).toEqual({ success: true });
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    // 2. chrome.runtime.openOptionsPage is absent, falls back to chrome.tabs.create
    delete (chrome.runtime as any).openOptionsPage;
    (chrome.tabs.create as any).mockClear();

    const res2 = await handleRuntimeMessage({ type: 'OPEN_OPTIONS_PAGE' }, {} as any);
    expect(res2).toEqual({ success: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://mock/src/options/options.html',
    });

    // 3. Both openOptionsPage and chrome.tabs.create absent
    const origTabs = chrome.tabs;
    delete (chrome as any).tabs;
    const res3 = await handleRuntimeMessage({ type: 'OPEN_OPTIONS_PAGE' }, {} as any);
    expect(res3).toEqual({ success: true });
    (chrome as any).tabs = origTabs;

    // 4. chrome.runtime is undefined (tests chrome.runtime?.openOptionsPage optional chaining and empty url fallback)
    const origRuntime = chrome.runtime;
    delete (chrome as any).runtime;
    (chrome.tabs.create as any).mockClear();
    const res4 = await handleRuntimeMessage({ type: 'OPEN_OPTIONS_PAGE' }, {} as any);
    expect(res4).toEqual({ success: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '' });
    (chrome as any).runtime = origRuntime;
    (chrome.runtime as any).openOptionsPage = openOptionsPage;
  });
});
