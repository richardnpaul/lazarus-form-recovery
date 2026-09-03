# Lazarus: Form Recovery — Modern WebExtension (Manifest V3) Specification v2.2.0

> **Document Version:** 2.2.0  
> **Status:** Final Architectural Blueprint & Implemented Specification  
> **Target Manifest:** Manifest V3 (Cross-Browser: Firefox Gecko, Chromium, Safari WebKit)  
> **Target Toolchain:** TypeScript 5+, Vite / `@crxjs/vite-plugin`, Dexie.js (IndexedDB), Web Crypto API, Vitest

---

## 1. Specification Reconciliations & Architectural Directives

During full implementation, testing, and debugging against browser engines (Chromium and Firefox Gecko), five critical architectural requirements were identified, reconciled, and codified into this specification:

### 1.1 Firefox Manifest V3 Background Scripts vs. Chromium Service Workers
- **Original Specification (v2.0.0, Section 6):** Prescribed a static Chrome-only `manifest.json` referencing `"background": { "service_worker": "..." }`.
- **The Firefox Constraint:** In Firefox Gecko's Manifest V3 implementation, `background.service_worker` is **disabled by default** (gated behind the `extensions.manifestV3.backgroundServiceWorker` flag in `about:config`). Attempting to load an MV3 extension with `background.service_worker` as a temporary add-on in Firefox (`about:debugging`) triggers a fatal installation error:
  ```text
  background.service_worker is currently disabled. Add background.scripts.
  ```
- **Cross-Browser Specification Directive:**
  - **Firefox Build Target (`dist/`):** Manifest must use event page scripts:
    ```json
    "background": {
      "scripts": ["assets/service-worker.ts-[hash].js"]
    },
    "sidebar_action": {
      "default_panel": "src/sidepanel/sidepanel.html",
      "default_title": "Lazarus: Form Recovery"
    },
    "browser_specific_settings": {
      "gecko": {
        "id": "lazarus-form-recovery@personal-code",
        "strict_min_version": "109.0"
      }
    }
    ```
  - **Chromium Build Target (`dist-chrome/`):** Manifest must use a service worker:
    ```json
    "background": {
      "service_worker": "service-worker-loader.js",
      "type": "module"
    },
    "side_panel": {
      "default_path": "src/sidepanel/sidepanel.html"
    },
    "permissions": ["storage", "alarms", "contextMenus", "sidePanel", "tabs"]
    ```
  - Dynamic generation is handled via `manifest.config.ts`, where `process.env.BROWSER !== 'chrome'` produces the Firefox distribution (`dist/`) and `process.env.BROWSER === 'chrome'` produces the Chromium distribution (`dist-chrome/`).

### 1.2 Disambiguated Entrypoint Naming (Vite / Bundler Chunk Collision Prevention)
- **Problem Statement:** Naming multiple extension entrypoints with the generic name `index.ts` (specifically `src/background/index.ts` and `src/content/index.ts`) causes Rollup / `@crxjs/vite-plugin` chunk naming collisions. The bundler generates a shared or misrouted loader (`service-worker-loader.js`) that imports the **content script** instead of the background script.
- **Consequence:** The background service worker attempts to execute DOM-dependent logic (`document.addEventListener`), crashing on boot with:
  ```text
  ReferenceError: document is not defined
  ```
  This immediately terminates the background process, leaving no active `chrome.runtime.onMessage` listener, silently preventing all autosaves from persisting to IndexedDB.
- **Specification Directive:** Extension entrypoint files **MUST NOT** use generic `index.ts` basenames. They must be explicitly named after their execution contexts:
  - Background Service Worker / Event Page: `src/background/service-worker.ts`
  - Content Script: `src/content/content-script.ts`

### 1.3 Mandatory Multi-Tier Testing: Unit & Integration Test Architecture
- **Problem Statement:** Pure unit tests operating in JSDOM with isolated mocks can pass 100% while the extension fails completely at runtime due to cross-boundary messaging, async timer deadlocks, or bundling misroutes.
- **Specification Directive:** The test suite must enforce a **3-Tier Testing Pyramid**:
  1. **Tier 1: Unit Tests (`tests/unit/`)**: Verify isolated functions, classes, and crypto algorithms (Luhn validator, WebCrypto vault, pure Dexie schemas).
  2. **Tier 2: Integration Tests (`tests/integration/`)**: Verify multi-component communication across execution boundaries:
     - `tests/integration/form-recovery-flow.test.ts`: Validates DOM input capture → 500ms debounce timer → background service worker message passing → Dexie IndexedDB commit → `GET_ALL_HISTORY` and `GET_RECOVERABLE_TEXT` retrieval, as well as sidebar playground autosaving.
     - `tests/integration/vault-flow.test.ts`: Validates Master Password setup → database encryption (`hybrid-aes-gcm`) → locked vault state returning `[Locked Draft]` → password unlock restoring plaintext drafts.
  3. **Tier 3: End-to-End Tests (`tests/e2e/`)**: Browser-level validation using Playwright launching unpacked browser instances.

### 1.4 Domain Identification & Normalization (`IDBDomain.id`)
- **Original Specification (v2.0.0, Section 5.2):** Specified `id: string; // SHA-256 hash of hostname` for domains.
- **Implementation & Better Rationale:** Asynchronously computing a SHA-256 cryptographic hash on every debounced keystroke introduces pipeline lag and complicates human-readable compound indexing `[domainId+lastModified]` and wildcard pattern matching.
- **Resolution:** `IDBDomain.id` is standardized on normalized hostname strings (e.g. `github.com`), with domain wildcard matching (`*.example.com`) evaluated via regex matching in `repository.ts`.

### 1.5 Design System Standardization (Emerald / Teal Palette)
- **Original Specification (v2.0.0, Section 4.6.1):** Prescribed an Emerald/Teal brand theme (`--lz-accent-primary: hsl(160, 84%, 39%)`).
- **Resolution:** Removed legacy orange/amber styles across all surfaces. Centralized styling in `src/common/styles/theme.css` using Emerald/Teal tokens, supporting dark/light modes and glassmorphic styling (`var(--lz-blur-glass)`).

### 1.6 Side Panel Interactive Playground Integration
- **Specification Directive:** In addition to search, filtering, and revision diffing, the side panel (`src/sidepanel/sidepanel.html`) includes an interactive test playground form. This allows real-time manual and automated verification of autosaving, database persistence, and form restoration directly inside the extension UI.

---

## 2. Implemented Subsystems & Component Architecture

### 2.1 Cryptographic Vault (`src/common/crypto/`)
- **Native WebCrypto (`web-crypto.ts`):** Constant-time AES-GCM-256 encryption/decryption with random 12-byte IVs and PBKDF2 (SHA-256, 100,000 iterations).
- **Vault Manager (`vault.ts`):**
  - Zero-knowledge storage: Master Password is never persisted. Only a random 32-byte salt and an encrypted verification sentinel (`LAZARUS_VAULT_VERIFIED_v1`) are stored in IndexedDB.
  - Inactivity Auto-Lock: Configurable inactivity timer (5m, 15m, 30m, 1h, never) automatically purges the derived CryptoKey from memory.

### 2.2 Content Script & Form Tracking Engine (`src/content/`)
- **Capture-Phase Listeners (`form-tracker.ts`):**
  - Intercepts `input`, `compositionend`, and `change` with 500ms debounce.
  - Intercepts `reset` to snapshot state before native reset clears fields.
  - Intercepts `submit` to immediately commit finalized forms.
  - Tracks active editing time ($\sum(\text{lastEdit} - \text{startEdit})$) with 5-minute idle pause.
- **Field Extractor (`field-extractor.ts`):**
  - Handles `input` (text, search, url, tel, email, number, date, checkbox, radio), `<textarea>`, and `<select>` (single/multi).
  - PII Protection: Validates 13–19 digit cards using the Luhn algorithm and redacts CVVs/card numbers before storage.
  - Password Fields: Ignored by default unless user explicitly enables password saving.
  - Detached Inputs ("Fake Forms"): Synthesizes virtual forms for orphaned elements outside `<form>` tags.
- **Rich-Text Adapters (`src/content/rich-text/`):**
  - Dedicated adapters for Quill (`.ql-editor`), TinyMCE/CKEditor (`.mce-content-body`, `.ck-content`), ProseMirror/Lexical/Slate (`.ProseMirror`, `[data-lexical-editor]`), and generic `contenteditable` elements.
- **Closed Shadow DOM Recovery UI (`src/content/shadow-ui/`):**
  - Encapsulated custom element `<lazarus-recovery-host>` with a **Closed Shadow Root**.
  - Trigger Button (`recovery-button.ts`): Dynamic coordinate positioning, boundary clamping, non-passive scroll tracking, and `ResizeObserver`.
  - Dropdown Menu (`recovery-menu.ts`): Glassmorphic card, live search, relative time formatting (`formatTimeAgo`), word count, full keyboard accessibility (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`).
  - Live Preview Engine (`live-preview.ts`): Non-destructive hover stash (`targetField._lazarusOriginalValue`), preview styling, rollback on mouseleave, and synthetic `input`+`change` event dispatch on commit.

### 2.3 Storage Pipeline & Background Service Worker (`src/background/`)
- **Tier 1 (Ephemeral Session Buffer):** `chrome.storage.session` stores volatile drafts under `autosaves:{tabId}:{formInstanceId}`. Cleared automatically on tab close.
- **Tier 2 (Permanent Vault):** Encrypted or plain records persisted into Dexie.js IndexedDB.
- **Automated Alarms (`alarms.ts`):** 30-minute periodic alarm purges records older than user-defined retention policy (`expireFormsInterval` days).
- **Context Menus (`context-menus.ts`):** Context menu shortcuts on editable elements to recover drafts, save drafts, or block domains.
- **Keyboard Shortcuts:** `Alt+Shift+L` to recover the last edited form on the current page.

### 2.4 User Interface Surfaces
- **Action Popup (`src/popup/`):** Fixed 380px width, Emerald theme, active domain toggle, tabbed switcher (`Current Tab` vs `Global Search`), expandable accordion cards with one-click copy and restore.
- **Side Panel (`src/sidepanel/`):** Full-height control center with date filter chips, revision timeline, interactive diff viewer, and integrated testing playground.
- **Options Management (`src/options/`):** 5-tab settings center:
  1. *General Preferences:* Password toggle with warning banner, Luhn credit card redaction, 1–30 day retention slider.
  2. *Security & Vault:* Standard vs Master Password (AES-GCM-256) selector, password setup modal with strength meter, auto-lock timeout.
  3. *Disabled Domains:* Wildcard domain exclusion table and unblock management.
  4. *Storage & Maintenance:* Storage estimate meter (`navigator.storage.estimate()`), encrypted JSON backup export, and nuclear wipe modal requiring typing `DELETE`.
  5. *About & Diagnostics:* Build versions and service worker heartbeat diagnostics.

---

## 3. Test Suite Verification & Hierarchy Architecture

The automated test suite enforces the testing pyramid with **49 passing tests across 9 test suites**:

### 3.1 Unit Tests (7 Suites, 46 Tests)
- `tests/unit/lazarus-db.test.ts`: Compound indexes, soft-deletion, and TTL expiration.
- `tests/unit/web-crypto.test.ts`: Key derivation, AES-GCM encryption/decryption, tampered ciphertext rejection.
- `tests/unit/vault.test.ts`: Master password lifecycle, unlock verification, and auto-lock inactivity.
- `tests/unit/field-extractor.test.ts`: Form controls, Luhn algorithm scrubbing, rich-text adapters, fake forms.
- `tests/unit/form-tracker.test.ts`: Input debouncing, submit immediate dispatch, in-situ UI focus attachment.
- `tests/unit/background.test.ts`: Storage router, recoverable text queries, search, and wipe.
- `tests/unit/alarms.test.ts`: Scheduled retention cleanup of expired forms.

### 3.2 Integration Tests (2 Suites, 3 Tests)
- `tests/integration/form-recovery-flow.test.ts`:
  - **Full Capture-to-Storage Lifecycle:** Validates DOM input typing → 500ms debounce timer → background message dispatch → IndexedDB record write → history retrieval (`GET_ALL_HISTORY`) → in-situ restore lookup (`GET_RECOVERABLE_TEXT`).
  - **Sidebar Playground Autosave:** Validates that saving from the side panel playground persists to IndexedDB and immediately populates the history feed.
- `tests/integration/vault-flow.test.ts`:
  - **End-to-End Encryption Lifecycle:** Validates Master Password activation → raw IndexedDB AES-GCM ciphertext verification → locked vault state returning `[Locked Draft]` → password unlock restoring plaintext drafts.

---

## 4. Build Targets & Browser Installation Guide

### 4.1 Firefox Gecko Installation
```bash
npm run build
```
- **Output Directory:** `dist/`
- **Manifest Background Configuration:** `"background": { "scripts": ["assets/service-worker.ts-[hash].js"] }`
- **Installation Steps:**
  1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
  2. Click **"Load Temporary Add-on..."**.
  3. Select the file: `/workspaces/lazarus-form-recovery/dist/manifest.json`.

### 4.2 Chromium / Chrome Installation
```bash
npm run build:chrome
```
- **Output Directory:** `dist-chrome/`
- **Manifest Background Configuration:** `"background": { "service_worker": "service-worker-loader.js", "type": "module" }`
- **Installation Steps:**
  1. Open Chrome/Chromium and navigate to `chrome://extensions/`.
  2. Enable **Developer mode** in the top right.
  3. Click **"Load unpacked"**.
  4. Select the directory: `/workspaces/lazarus-form-recovery/dist-chrome`.
