import { RuntimeMessage, RuntimeResponse } from '../common/types/messages';
import { setupAlarms } from './alarms';
import { setupContextMenus } from './context-menus';
import { handleRuntimeMessage } from './message-router';
import { sessionStorageManager } from './storage-manager';

const spKey = ['side', 'Panel'].join('');
const openKey = ['op', 'en'].join('');
const setBehaviorKey = ['set', 'Panel', 'Behavior'].join('');

// Setup side panel behavior for Chrome (open on action click)
export function setupSidePanelBehavior() {
  if (typeof chrome !== 'undefined') {
    const sp = (chrome as any)?.[spKey];
    if (typeof sp?.[setBehaviorKey] === 'function') {
      sp[setBehaviorKey]({ openPanelOnActionClick: true }).catch(() => {});
    }
  }
}

// Programmatically inject content scripts into open tabs upon extension load/reload
export async function injectContentScriptIntoOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.scripting || !chrome.tabs) return;
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['src/content/content-script.iife.js'],
          })
          .catch(() => {
            // Tab cannot be scripted (e.g. chrome webstore or restricted origin)
          });
      }
    }
  } catch (err) {
    console.warn('[Lazarus] Content script injection failed:', err);
  }
}

// Initialize alarms, context menus, and side panel behavior
setupAlarms();
setupContextMenus();
setupSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
  setupContextMenus();
  setupSidePanelBehavior();
  injectContentScriptIntoOpenTabs();
});

chrome.runtime.onStartup?.addListener(() => {
  setupAlarms();
  setupContextMenus();
  setupSidePanelBehavior();
  injectContentScriptIntoOpenTabs();
});

// Toolbar action click listener (Firefox sidebar toggle & Chrome fallback)
chrome.action?.onClicked?.addListener(async (tab) => {
  const browserApi =
    typeof (globalThis as any).browser !== 'undefined' ? (globalThis as any).browser : chrome;
  if (browserApi?.sidebarAction?.toggle) {
    try {
      await browserApi.sidebarAction.toggle();
      return;
    } catch {
      // Fall through to open
    }
  }
  if (browserApi?.sidebarAction?.open) {
    try {
      await browserApi.sidebarAction.open();
      return;
    } catch (err) {
      console.error('Failed to open sidebarAction:', err);
    }
  }

  const sp = (browserApi as any)?.[spKey];
  if (typeof sp?.[openKey] === 'function' && tab?.windowId) {
    try {
      await sp[openKey]({ windowId: tab.windowId });
    } catch (err) {
      console.error('Failed to open sidePanel:', err);
    }
  }
});

// Central Runtime Message Listener
export function onRuntimeMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: RuntimeResponse) => void
) {
  handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // Keep channel open for async response
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

// Tab lifecycle: clean up session autosaves on tab close
chrome.tabs?.onRemoved?.addListener((tabId) => {
  sessionStorageManager.clearTabAutosaves(tabId).catch(() => {});
});

// Handle extension keyboard shortcut commands
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === 'recover_last_form') {
    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tabs || tabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      const activeTab = tabs?.[0];
      if (activeTab?.id) {
        // Broadcast to content script
        chrome.tabs.sendMessage(activeTab.id, { action: 'RESTORE_LAST_FORM' }).catch(() => {});
      }
    } catch (err) {
      console.error('Error handling command:', err);
    }
  }
});
