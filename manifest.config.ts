import { defineManifest } from '@crxjs/vite-plugin';

const isFirefox = process.env.BROWSER !== 'chrome';

export default defineManifest({
  manifest_version: 3,
  name: "Lazarus: Form Recovery",
  version: "0.0.1",
  description: "Never lose form data, comments, or rich text drafts again. Secure, encrypted, and local form recovery.",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  background: isFirefox
    ? {
      scripts: ["src/background/service-worker.ts"],
      type: "module"
    }
    : {
      service_worker: "src/background/service-worker.ts",
      type: "module"
    },
  action: {
    default_popup: "src/popup/popup.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    },
    default_title: "Lazarus: Form Recovery"
  },
  options_ui: {
    page: "src/options/options.html",
    open_in_tab: true
  },
  ...(isFirefox
    ? {
      sidebar_action: {
        default_panel: "src/sidepanel/sidepanel.html",
        default_title: "Lazarus: Form Recovery"
      }
    }
    : {
      side_panel: {
        default_path: "src/sidepanel/sidepanel.html"
      }
    }),
  browser_specific_settings: {
    gecko: {
      id: "lazarus-form-recovery@personal-code",
      strict_min_version: "109.0"
    }
  },
  permissions: isFirefox
    ? [
      "storage",
      "alarms",
      "contextMenus",
      "tabs"
    ]
    : [
      "storage",
      "alarms",
      "contextMenus",
      "sidePanel",
      "tabs"
    ],
  host_permissions: [
    "<all_urls>"
  ],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content-script.ts"],
      all_frames: true,
      match_about_blank: true,
      run_at: "document_idle"
    }
  ],
  commands: {
    recover_last_form: {
      suggested_key: {
        default: "Alt+Shift+L",
        mac: "Alt+Shift+L"
      },
      description: "Recover the last edited form on the current page"
    },
    "_execute_action": {
      suggested_key: {
        default: "Ctrl+Shift+F",
        mac: "Command+Shift+F"
      }
    }
  }
});
