/**
 * Retrieves the extension version dynamically from the WebExtension runtime manifest.
 * Single source of truth is package.json, which is injected into manifest.json at build time.
 */
export function getExtensionVersion(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version) {
      return manifest.version;
    }
  }
  return '0.0.1';
}
