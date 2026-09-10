import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { container } from '../core/container';
import { updateDynamicContextMenus } from './context-menus';
import { repository } from '../common/db/repository';
import { FormRevisionPolicy } from '../core/domain/form-revision';

/**
 * Extracts and normalizes the sender's hostname if the message originated from a web tab.
 * Returns null if the sender is not a web tab (e.g. extension internal pages like sidepanel,
 * options page, background worker, or test mocks without tab information).
 */
export function getSenderDomain(sender?: chrome.runtime.MessageSender): string | null {
  if (!sender) return null;
  const urlStr = sender.tab?.url || sender.url;
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    // Only enforce for HTTP / HTTPS web content tabs
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return FormRevisionPolicy.normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

export async function handleRuntimeMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  try {
    switch (message.type) {
      case 'FORM_SAVED' as any: {
        return { success: true };
      }

      case 'SAVE_AUTOSAVE': {
        const { form } = message.payload;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(form.domain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in SAVE_AUTOSAVE: payload domain "${form.domain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          form.domain = senderDomain;
        }
        const result = await container.saveFormDraftUseCase.execute(form, sender.tab?.id, false);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'SUBMIT_FORM': {
        const { form } = message.payload;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(form.domain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in SUBMIT_FORM: payload domain "${form.domain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          form.domain = senderDomain;
        }
        const result = await container.submitFormUseCase.execute(form, sender.tab?.id);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'FORCE_SAVE_SNAPSHOT': {
        const { form } = message.payload;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(form.domain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in FORCE_SAVE_SNAPSHOT: payload domain "${form.domain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          form.domain = senderDomain;
        }
        const result = await container.saveFormDraftUseCase.execute(form, sender.tab?.id, true);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'UPDATE_CONTEXT_MENU': {
        const { domain, formInstanceId, fieldName, fieldType } = message.payload;
        let effectiveDomain = domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(domain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in UPDATE_CONTEXT_MENU: payload domain "${domain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        await updateDynamicContextMenus(effectiveDomain, formInstanceId, fieldName, fieldType);
        return { success: true };
      }

      case 'GET_RECOVERABLE_TEXT': {
        const { domain, fieldName, fieldType } = message.payload;
        let effectiveDomain = domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(domain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in GET_RECOVERABLE_TEXT: payload domain "${domain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        const items = await container.restoreFormUseCase.getRecoverableText(
          effectiveDomain,
          fieldName,
          fieldType
        );
        return { success: true, data: items };
      }

      case 'GET_RECOVERABLE_FORM': {
        const { formId } = message.payload;
        const result = await container.restoreFormUseCase.getRecoverableForm(formId);
        return { success: true, data: result };
      }

      case 'CHECK_VAULT_STATUS': {
        const status = await container.vaultSecurityUseCase.getStatus();
        return {
          success: true,
          data: status,
        };
      }

      case 'UNLOCK_VAULT': {
        const { password } = message.payload;
        const result = await container.vaultSecurityUseCase.unlock(password);
        return { success: result.success, error: result.error };
      }

      case 'LOCK_VAULT': {
        container.vaultSecurityUseCase.lock();
        return { success: true };
      }

      case 'SET_MASTER_PASSWORD': {
        const { password } = message.payload;
        const result = await container.vaultSecurityUseCase.setupMasterPassword(password);
        return { success: result.success, error: result.error };
      }

      case 'REMOVE_MASTER_PASSWORD': {
        const { currentPassword } = message.payload;
        if (currentPassword) {
          const unlocked = await container.vaultSecurityUseCase.unlock(currentPassword);
          if (!unlocked.success) {
            return { success: false, error: 'Current password incorrect' };
          }
        }
        const result = await container.vaultSecurityUseCase.removeMasterPassword();
        return { success: result.success, error: result.error };
      }

      case 'IS_DOMAIN_ENABLED': {
        let effectiveDomain = message.payload.domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(effectiveDomain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in IS_DOMAIN_ENABLED: payload domain "${effectiveDomain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        const enabled = await container.domainPolicyUseCase.isDomainEnabled(effectiveDomain);
        return { success: true, data: { enabled } };
      }

      case 'DISABLE_DOMAIN': {
        let effectiveDomain = message.payload.domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(effectiveDomain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in DISABLE_DOMAIN: payload domain "${effectiveDomain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        await container.domainPolicyUseCase.setDomainEnabled(
          effectiveDomain,
          false,
          message.payload.wipeExisting
        );
        return { success: true };
      }

      case 'ENABLE_DOMAIN': {
        let effectiveDomain = message.payload.domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(effectiveDomain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in ENABLE_DOMAIN: payload domain "${effectiveDomain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        await container.domainPolicyUseCase.setDomainEnabled(effectiveDomain, true);
        return { success: true };
      }

      case 'SEARCH_HISTORY': {
        const items = await container.historyQueryUseCase.searchHistory(
          message.payload.query,
          message.payload.limit
        );
        return { success: true, data: items };
      }

      case 'GET_ALL_HISTORY': {
        const items = await container.historyQueryUseCase.getAllHistory(message.payload?.limit);
        return { success: true, data: items };
      }

      case 'GET_DOMAIN_HISTORY': {
        let effectiveDomain = message.payload.domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(effectiveDomain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in GET_DOMAIN_HISTORY: payload domain "${effectiveDomain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        const items = await container.historyQueryUseCase.getDomainHistory(
          effectiveDomain,
          message.payload.limit
        );
        return { success: true, data: items };
      }

      case 'GET_FORM_REVISIONS': {
        let effectiveDomain = message.payload.domain;
        const senderDomain = getSenderDomain(sender);
        if (senderDomain && FormRevisionPolicy.normalizeDomain(effectiveDomain) !== senderDomain) {
          console.warn(
            `[MessageRouter] Domain mismatch in GET_FORM_REVISIONS: payload domain "${effectiveDomain}" does not match sender tab domain "${senderDomain}". Overriding with sender domain.`
          );
          effectiveDomain = senderDomain;
        }
        const items = await container.historyQueryUseCase.getFormRevisions(
          effectiveDomain,
          message.payload.formInstanceId
        );
        return { success: true, data: items };
      }

      case 'DELETE_FORM': {
        await container.historyQueryUseCase.deleteForm(message.payload.formId);
        return { success: true };
      }

      case 'CLEAR_ALL_HISTORY': {
        await container.historyQueryUseCase.clearAll();
        return { success: true };
      }

      case 'GET_SETTINGS': {
        const settings = await repository.getSettings();
        return { success: true, data: settings };
      }

      case 'UPDATE_SETTINGS': {
        const updated = await repository.updateSettings(message.payload.settings);
        return { success: true, data: updated };
      }

      case 'EXPORT_DATA': {
        const exportData = await repository.exportAllData();
        return { success: true, data: exportData };
      }

      case 'OPEN_OPTIONS_PAGE': {
        if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
        }
        return { success: true };
      }

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
