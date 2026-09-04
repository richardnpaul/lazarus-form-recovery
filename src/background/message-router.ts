import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { container } from '../core/container';
import { updateDynamicContextMenus } from './context-menus';
import { repository } from '../common/db/repository';

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
        const result = await container.saveFormDraftUseCase.execute(form, sender.tab?.id, false);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'SUBMIT_FORM': {
        const { form } = message.payload;
        const result = await container.submitFormUseCase.execute(form, sender.tab?.id);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'FORCE_SAVE_SNAPSHOT': {
        const { form } = message.payload;
        const result = await container.saveFormDraftUseCase.execute(form, sender.tab?.id, true);
        if (!result.success) {
          return { success: false, error: result.error || 'Domain is disabled' };
        }
        return { success: true, data: result };
      }

      case 'UPDATE_CONTEXT_MENU': {
        const { domain, formInstanceId, fieldName, fieldType } = message.payload;
        await updateDynamicContextMenus(domain, formInstanceId, fieldName, fieldType);
        return { success: true };
      }

      case 'GET_RECOVERABLE_TEXT': {
        const { domain, fieldName, fieldType } = message.payload;
        const items = await container.restoreFormUseCase.getRecoverableText(
          domain,
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
        const enabled = await container.domainPolicyUseCase.isDomainEnabled(message.payload.domain);
        return { success: true, data: { enabled } };
      }

      case 'DISABLE_DOMAIN': {
        await container.domainPolicyUseCase.setDomainEnabled(
          message.payload.domain,
          false,
          message.payload.wipeExisting
        );
        return { success: true };
      }

      case 'ENABLE_DOMAIN': {
        await container.domainPolicyUseCase.setDomainEnabled(message.payload.domain, true);
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
        const items = await container.historyQueryUseCase.getDomainHistory(
          message.payload.domain,
          message.payload.limit
        );
        return { success: true, data: items };
      }

      case 'GET_FORM_REVISIONS': {
        const items = await container.historyQueryUseCase.getFormRevisions(
          message.payload.domain,
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
