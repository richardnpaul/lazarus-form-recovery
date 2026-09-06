/**
 * Runtime utilities for safe messaging and extension context validation.
 * Prevents unhandled "Extension context invalidated" errors when extensions
 * are reloaded, updated, or uninstalled while content scripts are active.
 */

/**
 * Checks whether the extension context is currently valid.
 * When an extension is reloaded or uninstalled, chrome.runtime.id becomes undefined
 * or falsy, and calling chrome APIs throws "Extension context invalidated" synchronously.
 */
export function isExtensionContextValid(): boolean {
  try {
    return Boolean(
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      typeof chrome.runtime.id === 'string' &&
      chrome.runtime.id.length > 0
    );
  } catch {
    return false;
  }
}

function isContextInvalidatedError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('Extension context invalidated') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('Could not establish connection')
  );
}

/**
 * Safely sends a message to the background service worker or extension runtime.
 * Catches both synchronous and asynchronous errors when the context is invalidated
 * or ports are disconnected. Re-throws other application-level errors for caller handling.
 *
 * @param message The message object to send
 * @returns The response from the runtime or null if delivery failed/context invalidated
 */
export async function safeSendMessage<T = any>(message: any): Promise<T | null> {
  if (!isExtensionContextValid()) {
    return null;
  }

  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof (result as Promise<any>).then === 'function') {
      return await (result as Promise<any>).catch((err) => {
        if (isContextInvalidatedError(err)) {
          return null;
        }
        throw err;
      });
    }
    return null;
  } catch (err: any) {
    // Synchronous throw in Chromium when extension context is invalidated
    if (isContextInvalidatedError(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * Safely gets an extension URL with context validation.
 *
 * @param path Relative path inside the extension
 * @returns The fully qualified extension URL or null if context is invalid
 */
export function safeGetURL(path: string): string | null {
  if (!isExtensionContextValid()) {
    return null;
  }
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return null;
  }
}
