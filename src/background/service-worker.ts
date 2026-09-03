import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { setupAlarms } from './alarms';
import { setupContextMenus } from './context-menus';
import { handleRuntimeMessage } from './message-router';
import { sessionStorageManager } from './storage-manager';

// Initialize alarms and context menus immediately on load and on install / startup
setupAlarms();
setupContextMenus();

chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
  setupContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  setupAlarms();
  setupContextMenus();
});

// Central Runtime Message Listener
chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse) => void
  ) => {
    handleRuntimeMessage(message, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
);

// Tab lifecycle: clean up session autosaves on tab close
chrome.tabs?.onRemoved?.addListener((tabId) => {
  sessionStorageManager.clearTabAutosaves(tabId).catch(() => {});
});

// Handle extension keyboard shortcut commands
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === 'recover_last_form') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        // Broadcast to content script
        chrome.tabs.sendMessage(activeTab.id, { action: 'RESTORE_LAST_FORM' }).catch(() => {});
      }
    } catch (err) {
      console.error('Error handling command:', err);
    }
  }
});
