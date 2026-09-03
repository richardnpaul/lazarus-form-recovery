# Lazarus: Form Recovery — Modern WebExtension (Manifest V3) Specification

> **Document Version:** 2.0.0
> **Status:** Approved Architectural Blueprint & Implementation Specification
> **Target Manifest:** Manifest V3 (Cross-Browser: Chromium, Firefox Gecko, Safari WebKit)
> **Target Toolchain:** TypeScript 5+, Vite / `@crxjs/vite-plugin`, Dexie.js (IndexedDB), Web Crypto API, Playwright, Vitest

---

## 1. Executive Overview & Mission

### 1.1 Purpose

**Lazarus: Form Recovery** is a browser extension designed to eliminate catastrophic loss of user input in web forms. It operates as a local, secure, and privacy-first background recorder that transparently captures input across traditional HTML forms, single-page application (SPA) dynamic inputs, `contenteditable` elements, WYSIWYG rich-text editors (Quill, TinyMCE, CKEditor, ProseMirror, Slate, Lexical), and AJAX/Fetch-driven form flows.

When a user encounters a browser crash, power outage, accidental tab/window closure, session expiration, network failure, or unintentional form reset, Lazarus allows them to restore either the entire form state or individual field contents with a single click or keyboard shortcut.

### 1.2 Modernization Imperative

The legacy codebase (`v2.x`/`v3.2.x`) was authored around deprecated browser extension APIs (XUL/XPCOM, Safari 5 `.safariextz`, Manifest V2 persistent background pages, WebSQL `openDatabase`, unmaintained Lovefield IndexedDB wrappers, custom JavaScript crypto string manipulations, and synchronous storage).

This specification provides an exhaustive, unambiguous blueprint for rebuilding the extension from scratch to modern browser extension standards (**Manifest V3** across Chrome, Brave, Edge, Firefox, and Safari) with:

1. **Zero-leak sandboxing** via Closed Shadow DOM.
2. **Hardware-accelerated native cryptography** via the W3C Web Crypto API (AES-GCM-256 + PBKDF2/Argon2id).
3. **Structured asynchronous storage** via IndexedDB with typed schemas.
4. **Service Worker lifecycle compliance** (stateless event dispatching, ephemeral alarms, zero reliance on in-memory background persistence).
5. **Modern reactive frontend architectures** (TypeScript, Vite, Tailwind/Modern CSS, Web Components).
6. **Automated CI/CD and multi-browser signing pipelines** (Playwright E2E, Vitest, GitHub Actions, CWS CLI, `web-ext`).

---

## 2. Legacy Codebase Audit & Functional Deconstruction

To guarantee that no historical feature or edge-case handling is lost during reimplementation, the existing codebase has been reverse-engineered and cataloged below:

```
lazarus_addon/
├── manifest.json              # Legacy Manifest V2 with background page & open permissions
├── background.html            # Persistent background HTML loading ~20 scripts
├── options.html               # Options UI with jQuery + jquery.msg modal
├── login.html / disable-*.html # Dialog pages injected via host iframe + postMessage
├── js/
│   ├── lazarus.js             # Core namespace, constants, states, version definitions
│   ├── background.js          # Persistent background controller (~1600 lines)
│   ├── content.js             # Content script: DOM listeners, button, menu (~1500 lines)
│   ├── db.js / db-adapter.js  # WebSQL (openDatabase) & Lovefield IndexedDB connector
│   ├── crypto.js / aes.js / rsa.js / sjcl.js # Custom JS string-based cryptography
│   ├── menu.js                # Custom DOM floating menu attached to document.documentElement
│   ├── dialog.js              # In-page iframe modal generator
│   ├── prefs.js / preferences.js # Preference manager backed by localStorage
│   ├── platform-*.js          # Platform shims (chrome, firefox, safari)
│   ├── sync.js                # Legacy cloud sync logic (obsolete backend)
│   └── fix-undefined-frames.js# Polling hack for cross-frame iframe access
```

### 2.1 Core Subsystems in Legacy Code

1. **Form Tracking Engine (`content.js`):**
   - Intercepts `input`, `keyup`, `change`, `focus`, `blur`, `submit`, `reset`, and `scroll`.
   - Distinguishes standard inputs from rich text (`textarea`, `contenteditable`, `iframe[designMode="on"]`).
   - Generates "Fake Forms" (`FakeForm`) for orphaned inputs not encapsulated in `<form>` tags.
   - Computes active typing duration (`editingTime`) while factoring out idle periods (`EDITING_IDLE_TIME = 5 min`).
2. **Two-Tier Autosave Pipeline (`background.js`):**
   - **Tier 1 (Autosave / Session Buffer):** Debounced memory cache (500ms delay) encrypted with a local session hash seed, persisted to `localStorage` under `autosaves`. Kept for emergency tab recovery.
   - **Tier 2 (Permanent Vault):** Triggered on form `submit` or when an autosave exceeds 5 minutes without modification (`saveExpiredAutosaves`). Saved into the database with full hashing and encryption.
3. **In-Situ Recovery UI (`menu.js`, `content.js`):**
   - Injects a `<lazarusbutton>` icon at the top-right bounding box of focused fields.
   - Clicking reveals a `<lazarusmenu>` dropdown displaying recent text snippets / form versions with timestamps.
   - Mousing over a menu item triggers a live preview in the form (highlighting restored fields in `#FFFFDD`); mousing out reverts to the user's current draft.
4. **Security & Cryptography Subsystem (`crypto.js`, `aes.js`, `rsa.js`):**
   - "None" mode: plain text.
   - "Hybrid" mode: master password encrypts an RSA private key with AES; field values are encrypted with a random AES session key, which is in turn encrypted with the RSA public key.
5. **Site Exclusion & Expiration Subsystem:**
   - Blacklisting domains from recording (`disabledDomains`).
   - Automated expiration worker running every 30 minutes to drop records older than `expireFormsInterval` days.

### 2.2 Legacy UI/UX Audit & Technical Deficiencies

A rigorous examination of the legacy user interface files (`options.html`, `options.css`, `login.html`, `disable-on-site.html`, `menu.js`, `dialog.js`) reveals severe architectural flaws, obsolete styling, and security vulnerabilities that must be discarded:

1. **Host DOM Pollution & Bidirectional CSS Bleed:**
   - The legacy content script (`content.js`, `menu.js`) directly injected unscoped custom elements (`<lazarusbutton>`, `<lazarusmenu>`, `<lazarusoverlay>`) into the host page's `document.documentElement`.
   - Global stylesheet rules leaked into the host page (e.g. resetting properties or conflicting with host classes). Conversely, host page CSS (e.g. `* { box-sizing: border-box !important; }`, reset stylesheets, or dark reader filters) corrupted the extension's button placement, fonts, and dropdown rendering.
   - Any malicious or compromised script running in the host page could inspect, intercept, or forge click events on `<lazarusmenu>`, completely compromising decrypted form data.
2. **Injected Iframe Modals & Broken CSP:**
   - In-page dialogs (`login.html` master password prompt, `disable-on-site.html` confirmation) were appended to the host DOM as raw `<iframe>` elements referencing `chrome-extension://...` via `dialog.js`.
   - Modern website Content Security Policies (`frame-src 'none'`, `frame-src https:`, or trusted-types directives) block extensions from embedding web-accessible iframes, rendering the legacy modal invisible and unusable on sites like GitHub, Google, or banking portals.
   - Cross-frame communication relied on loose `window.postMessage` listeners vulnerable to spoofing and timing attacks.
3. **Rigid, Non-Responsive Layouts:**
   - `options.html` hardcoded a fixed-width container (`#container { width: 860px; margin: 0px 0px 0px 110px; }`) relying on float clears (`float: left; width: 150px;`) and fixed line heights.
   - The layout failed entirely on mobile viewports, narrow side panels, or window tiling/splitting.
4. **Obsolete Web 2.0 & Skeuomorphic Aesthetics:**
   - Backgrounds utilized repeating PNG textures (`background: #eee url('../images/options-bg.png') repeat-x;`).
   - Buttons used image-sliced fixed-size sprites (`button-green-small.png` 48px height sprite with hardcoded `-80px` hover coordinate offsets).
   - System default fonts (`Helvetica, sans-serif 13px`) with text shadows (`text-shadow: #fff -1px -1px;`) produced a dated, low-contrast appearance.
   - Loading states and status messages relied on animated `.gif` images (`loading.gif`, `loading-horizontal.gif`) and fixed colored borders rather than semantic, accessible component states.
5. **Obsolete jQuery & Modal Plugin Dependencies:**
   - The UI relied on jQuery 1.x and `jquery.msg.js` (an unmaintained modal plugin), violating modern lightweight extension principles and complicating CSP compliance.

---

## 3. Manifest V3 Incompatibilities, Gaps & Modern Alternatives

The table below documents every legacy architectural pattern that is broken or illegal in modern browsers, along with its required modern implementation:

| Legacy Component / Pattern   | Legacy Implementation                                                                                                                                    | MV3 / Modern Limitation                                                                                                                                          | Modern Architectural Replacement                                                                                                                                                              |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background Execution**     | Persistent `background.html` page running continuous in-memory timers (`setTimeout`, `setInterval`) and storing state in `Lazarus.Background.*` globals. | Service workers are **ephemeral** and terminated after ~30 seconds of inactivity. In-memory variables are lost on sleep; `window` and `document` do not exist.   | **Stateless MV3 Service Worker (`background.ts`)**. All state persisted to `chrome.storage.session` (ephemeral) and `IndexedDB` (permanent). Background timers replaced with `chrome.alarms`. |
| **Database Layer**           | WebSQL (`openDatabase("lazarus3.sqlite")`) and Lovefield.                                                                                                | **WebSQL is completely removed** from all modern Chromium builds and WebKit. Lovefield is deprecated.                                                            | **IndexedDB** using **Dexie.js** or a typed native wrapper (`idb`). Fully accessible from both Service Workers and extension UI pages.                                                        |
| **Cryptography**             | Custom JavaScript implementations of RSA (`rsa.js`) and AES (`aes.js`) manipulating raw strings and binary conversions. Vulnerable to timing attacks.    | Extension CSP strictly forbids `eval()` and insecure scripting. CPU-heavy synchronous JS crypto blocks Service Worker event loops.                               | **W3C Web Crypto API (`crypto.subtle`)**. Hardware-accelerated AES-GCM (256-bit) with PBKDF2 (SHA-256, 100k+ iterations) or Argon2id via WASM for key derivation. Constant-time execution.    |
| **In-Page Dialogs**          | Injected `iframe` referencing `chrome-extension://.../login.html` directly into host pages via `dialog.js`, communicating via `window.postMessage`.      | Modern web CSP (`frame-src`, `trusted-types`) blocks extension iframes on high-security sites (GitHub, banks, Google). Injected iframes leak extension presence. | **Closed Shadow DOM Overlay** or **Native Extension Action Popup / Side Panel** (`chrome.sidePanel`). Password prompts rendered in isolated Shadow Root or extension popup.                   |
| **In-Situ Button & Menu**    | Unscoped custom HTML tags (`<lazarusbutton>`, `<lazarusmenu>`, `<lazarusoverlay>`) appended to `doc.documentElement` with global stylesheets.            | Host page CSS leaks into Lazarus UI (breaking layouts/fonts); Lazarus styles can corrupt host page rendering. Host JS can inspect/hijack menu events.            | **Encapsulated Custom Element with Closed Shadow DOM** (`<lazarus-recovery-host>`). Injected Shadow Root isolates all CSS and DOM events from the host page.                                  |
| **Storage & Preferences**    | Synchronous `localStorage` in background page and content scripts.                                                                                       | `localStorage` is **not available** in MV3 Service Workers.                                                                                                      | **`chrome.storage.local`** (persistent settings/flags) and **`chrome.storage.session`** (in-memory fast cache, cleared on browser close).                                                     |
| **Cross-Frame Tracking**     | `fix-undefined-frames.js` recursive traversal of `iframe.contentDocument` across the DOM tree.                                                           | Violates cross-origin iframe security boundaries (SOP). Throws cross-origin `DOMException`.                                                                      | Content scripts declared with `"all_frames": true` and `"match_about_blank": true`. Each frame operates independently and communicates directly with the Service Worker.                      |
| **Rich Text Editor Support** | Hardcoded DOM queries (`textarea`, `div.isContentEditable`) and Facebook-specific hacks (`kludgeIsFacebookCommentField`).                                | Modern web uses complex virtual DOM and Rich Text frameworks (Lexical, ProseMirror, Slate, Monaco, CodeMirror, Shadow DOM components).                           | **Modern MutationObserver + Composed Path Event Delegation** + Dedicated adapters for Quill, TinyMCE, CKEditor, Lexical, DraftJS, and Monaco.                                                 |
| **Backend Cloud Sync**       | Obsolete proprietary XMLHttpRequests to decommissioned server (`getlazarus.com`) with SJCL PBKDF2.                                                       | Inactive endpoints, insecure HTTP fallback, unmaintained SJCL library.                                                                                           | **Optional Modern End-to-End Encrypted (E2EE) Sync Protocol** using WebCrypto + user-controlled WebDAV / Cloudflare Workers / Supabase, or omitted in Core to guarantee 100% offline privacy. |

---

## 4. Comprehensive Functional & Behavioral Specification

```
                               ┌──────────────────────────────────────────────────────────┐
                               │                    USER INTERACTION                      │
                               │  (Typing, Pasting, Selecting, Submitting, Resetting)     │
                               └────────────────────────────┬─────────────────────────────┘
                                                            │
                                                            ▼
                               ┌──────────────────────────────────────────────────────────┐
                               │                 CONTENT SCRIPT RUNTIME                   │
                               │                                                          │
                               │  ┌──────────────────────┐    ┌────────────────────────┐  │
                               │  │ Form & Field Engine  │    │ Shadow DOM UI Host     │  │
                               │  │ - Input Listeners    │    │ - <lazarus-button>     │  │
                               │  │ - Rich Text Adapters │    │ - <lazarus-menu>       │  │
                               │  │ - Debounce Controller│    │ - Live Preview Stash   │  │
                               │  └──────────┬───────────┘    └──────────▲─────────────┘  │
                               └─────────────┼───────────────────────────┼────────────────┘
                         Runtime Message (Save)│                           │ Runtime Message (Restore)
                                             │                           │
                                             ▼                           │
┌────────────────────────────────────────────────────────────────────────┴─────────────────────────────────┐
│                                    BACKGROUND SERVICE WORKER                                             │
│                                                                                                          │
│  ┌─────────────────────────┐   ┌───────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │   Message Router & RPC  ├───►   Crypto Engine (Subtle)  ├───►   IndexedDB Storage (Dexie.js)       │  │
│  │   - Save/Autosave Form  │   │   - AES-GCM-256 Vault     │   │   - Database: `lazarus_db`           │  │
│  │   - Fetch History/Text  │   │   - PBKDF2 Master Pass    │   │   - Tables: forms, fields, domains   │  │
│  │   - Check Pass/Lockout  │   │   - Session Key Unwrapping│   │   - Full-text search indices         │  │
│  └───────────┬─────────────┘   └───────────────────────────┘   └──────────────────▲───────────────────┘  │
│              │                                                                    │                      │
│              ▼                                                                    │                      │
│  ┌─────────────────────────┐   ┌───────────────────────────┐                      │                      │
│  │   Alarms & Maintenance  ├───►  Ephemeral Buffer Engine  │                      │                      │
│  │   - Expiration Cleaner  │   │  - `storage.session`      ├──────────────────────┘                      │
│  │   - Autosave Promoter   │   │  - Unsaved crash recovery │                                             │
│  └─────────────────────────┘   └───────────────────────────┘                                             │
└──────────────────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                               │
                        ┌──────────────────────┴──────────────────────┐
                        ▼                                             ▼
         ┌─────────────────────────────┐               ┌─────────────────────────────┐
         │     ACTION POPUP & SEARCH   │               │    OPTIONS & SECURITY UI    │
         │  - Full History Search      │               │  - Master Password Manager  │
         │  - Manual Domain Restore    │               │  - Retention Policy (Days)  │
         │  - Export / Wipe Data       │               │  - Domain Blocklist Manager │
         └─────────────────────────────┘               └─────────────────────────────┘
```

### 4.1 Form & Input Interception Engine

#### 4.1.1 Supported Field Types

The extension must track and capture:

1. **Standard HTML Form Controls:**
   - Text inputs: `type="text"`, `search`, `url`, `tel`, `email`, `password` (configurable), `number`, `date`, `datetime-local`, `month`, `week`, `color`.
   - Multiline inputs: `<textarea>`.
   - Selection inputs: `<select>` (single and multi-select).
   - Boolean inputs: `<input type="checkbox">` and `<input type="radio">` (storing `value` and `checked` state).
2. **Rich Text & ContentEditable Elements:**
   - Elements with `contenteditable="true"` or `contenteditable=""`.
   - Iframes with `designMode="on"` or editable body documents.
   - Component-level rich text editors:
     - **Quill:** Intercepting inner HTML / Delta changes.
     - **TinyMCE / CKEditor:** Intercepting inner iframe or editable body changes.
     - **ProseMirror / Slate / Lexical:** Intercepting root node DOM mutations and `input` events.
     - **Monaco / CodeMirror:** Intercepting underlying textarea or model change events where accessible.
3. **Orphaned / Detached Inputs ("Fake Forms"):**
   - Inputs existing outside a `<form>` tag (common in modern React/Vue applications) must be automatically synthesized into a virtual form entity keyed by `window.location.href` and container DOM path.

#### 4.1.2 Input Event Handling & Debouncing

- **Typing Events:** The content script listens for `input`, `compositionend`, and `change` events in the capture phase (`useCapture: true`).
- **Autosave Debounce:** Keystrokes reset an autosave timer (`AUTOSAVE_DELAY = 500ms`). When the user pauses typing for 500ms, the field state is bundled and transmitted to the Service Worker.
- **Form Submission:** Listening to the `submit` event on `document`. When intercepted, all field values in the form are immediately collected and flagged as a finalized submission.
- **Form Reset:** Listening to the `reset` event on `document`. Before the native reset clears values, Lazarus captures a snapshot so accidental resets can be reversed.

#### 4.1.3 Active Editing Time Calculation

To calculate saved user time without recording keylog timestamps:

- Maintain `startEditTime` and `lastEditTime` timestamps per form instance.
- If no input occurs for `EDITING_IDLE_TIME` (300,000ms / 5 minutes), the active timer pauses.
- Total editing time is aggregated as $\sum (\text{lastEdit} - \text{startEdit})$ across all active editing intervals.

---

### 4.2 Storage Pipeline & Two-Tier Lifecycle

#### 4.2.1 Tier 1: Ephemeral Autosave Buffer (`chrome.storage.session`)

- As the user types, forms are saved to `chrome.storage.session` under `autosaves:{tabId}:{formInstanceId}`.
- Autosaves represent volatile, in-progress drafts.
- If the browser crashes or the tab is closed without submission, the session store preserves the text.

#### 4.2.2 Tier 2: Permanent Encrypted Vault (IndexedDB)

- An autosave is migrated to permanent IndexedDB storage when:
  1. The form fires a `submit` event.
  2. The form remains unedited for longer than `AUTOSAVE_EXPIRY_TIME` (5 minutes) and contains more than 10 characters of text.
  3. The user explicitly requests saving via the context menu.
- Expired records are deleted based on `expireFormsInterval` (default: 10 days; maximum: 30 days).

---

### 4.3 In-Situ Recovery UI (Shadow DOM)

#### 4.3.1 Floating Icon (`<lazarus-button>`)

- When an editable field receives `focus`, a custom element `<lazarus-recovery-host>` is attached to the document root if not already present.
- Inside the Closed Shadow Root, a floating trigger button (`<button class="lazarus-icon">`) is positioned relative to the focused element's `getBoundingClientRect()`.
- **Positioning Logic:**
  - Default: Attached inside or immediately adjacent to the top-right corner of the target field.
  - Viewport Boundary Handling: If the field is near the edge of the viewport or scrolled, the icon adjusts dynamically via `ResizeObserver` and `IntersectionObserver`.
  - Opacity: Transitions from `opacity: 0.3` (idle) to `opacity: 1.0` (hover/focus).

#### 4.3.2 Dropdown Recovery Menu (`<lazarus-menu>`)

- Clicking the button displays an isolated dropdown menu.
- **Menu Contents:**
  - List of past entries for this specific field / form, ordered by `lastModified` descending (max 10 entries).
  - Each item displays:
    - Truncated text preview (sanitized of HTML tags).
    - Relative timestamp (e.g., "2 minutes ago", "Yesterday 4:15 PM").
    - Word / character count.
  - Special Actions:
    - _Recover Entire Form_ (if multiple fields match).
    - _Disable on [domain.com]_ (quick blocklist shortcut).
    - _Extension Settings_ (opens `options.html`).
    - _Lock / Unlock Vault_ (if Master Password is enabled).

#### 4.3.3 Live Hover-Preview & Rollback

- **Hover:** When the user hovers over a menu item, the content script stashes the current field value into a temporary variable (`field._lazarusDraft`) and temporarily writes the historical text into the field with a visual indicator (`background-color: #FFF9D2; color: #333; outline: 2px dashed #E5A500;`).
- **Mouse Out:** If the user moves the mouse away without clicking, the field reverts instantly to `field._lazarusDraft` and styling is restored.
- **Click:** The chosen historical text is committed, `_lazarusDraft` is cleared, and an `input` + `change` event is dispatched so host framework bindings (React, Vue, etc.) register the update.

---

### 4.4 Cryptography & Security Subsystem

#### 4.4.1 Encryption Modes

The user can select between two security tiers in settings:

1. **Standard Mode (`none`):**
   - Data is stored in local IndexedDB without application-layer encryption.
   - Relies on OS-level disk encryption (FileVault, BitLocker, LUKS) and browser profile isolation.
2. **Master Password Encrypted Mode (`hybrid` / AES-GCM):**
   - All saved form values, URLs, and field text are encrypted using **AES-256-GCM** before writing to IndexedDB.
   - **Key Derivation:** The user's Master Password is fed into **PBKDF2** (using SHA-256, 100,000 iterations, and a cryptographically random 32-byte salt generated during vault initialization).
   - **Master Key Unwrapping:**
     - On successful password entry, an AES-256 CryptoKey is derived and retained in memory within the Service Worker / Session Store.
     - An inactivity lock timer (default: 15 minutes) automatically purges the derived key from memory, requiring the user to re-authenticate before reading or restoring encrypted forms.
   - **Zero Knowledge:** The Master Password is never written to disk or storage. Only the salt and an encrypted verification token (to validate correct password entry) are persisted.

#### 4.4.2 Privacy & Sensitive Data Scrubbing

- **Password Fields:** By default, `input[type="password"]` is **ignored and never saved** unless the user explicitly toggles `savePasswords: true` in settings.
- **Credit Card / PII Detection:** Text matching the Luhn algorithm (13–19 digit credit card sequences) or CVV patterns is automatically redacted or blocked from storage.
- **Private / Incognito Browsing:** When a tab is in incognito mode (`tab.incognito === true`), Lazarus is **automatically disabled** by default unless the user explicitly enables incognito permissions and toggles incognito capture in options.

---

---

### 4.5 Extension Popup, Side Panel & Management UI Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Lazarus: Form Recovery               [ 🔍 Search history ] │
├─────────────────────────────────────────────────────────────┤
│  Current Site: github.com/lazarus-recovery/lazarus_addon    │
│  Status: ● Active (Autosaving)         [ Disable on Domain] │
├─────────────────────────────────────────────────────────────┤
│  RECENT FORM SAVES (THIS TAB)                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Issue #42: Rebuilding Lazarus for Manifest V3         │  │
│  │ "The rebuilding project requires replacing WebSQL..." │  │
│  │ 🕒 3 minutes ago • 142 words              [Restore]   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Pull Request Comment                                  │  │
│  │ "LGTM, verified Web Crypto and Dexie integration..."  │  │
│  │ 🕒 1 hour ago • 38 words                  [Restore]   │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  GLOBAL SEARCH & RESCUE                                     │
│  [ Filter by keyword, URL, or date range...               ] │
├─────────────────────────────────────────────────────────────┤
│  ⚙️ Options   |   🔒 Lock Vault   |   🗑️ Wipe History       │
└─────────────────────────────────────────────────────────────┘
```

1. **Popup (`popup.html`):**
   - Quick access to current tab's recoverable forms.
   - Real-time status indicator (Active, Disabled on Domain, Private Browsing).
   - Instant search across all historical entries.
2. **Side Panel (`sidepanel.html`):**
   - Expanded search interface for browsing long form histories while simultaneously viewing a webpage.
   - Side-by-side comparison of past form revisions with visual text diffing.
3. **Options Page (`options.html`):**
   - **General:** Toggle password capture, credit card filtering, retention duration slider (1–30 days).
   - **Security:** Master Password setup, change password, auto-lock timeout.
   - **Disabled Domains:** Table of excluded sites with add/delete functionality.
   - **Data Management:** Rebuild database, export all history to encrypted JSON, wipe all data.

---

### 4.6 Comprehensive Modern UI/UX Design System & Surface Specification for LLMs

To guarantee a world-class, premium, and zero-conflict user experience across all extension surfaces, the implementation must adhere strictly to the following design system tokens, component contracts, and interaction state machines.

#### 4.6.1 CSS Design Tokens & Theming (`src/common/styles/theme.css`)

All extension interfaces must utilize unified CSS custom properties supporting dynamic system theme switching (`@media (prefers-color-scheme: dark)` or manual `.theme-dark` class toggle):

```css
:root {
  /* Surface & Background Colors (HSL) */
  --lz-bg-canvas: hsl(210, 20%, 98%);
  --lz-bg-surface: hsl(0, 0%, 100%);
  --lz-bg-surface-elevated: hsl(210, 20%, 96%);
  --lz-bg-surface-glass: hsla(0, 0%, 100%, 0.82);
  --lz-bg-overlay: hsla(220, 20%, 10%, 0.45);

  /* Text & Foreground Hierarchy */
  --lz-text-primary: hsl(222, 47%, 11%);
  --lz-text-secondary: hsl(215, 16%, 37%);
  --lz-text-muted: hsl(215, 16%, 57%);
  --lz-text-inverse: hsl(0, 0%, 100%);

  /* Lazarus Brand Accent (Emerald / Teal Recovery Theme) */
  --lz-accent-primary: hsl(160, 84%, 39%);
  --lz-accent-hover: hsl(160, 84%, 32%);
  --lz-accent-active: hsl(160, 84%, 26%);
  --lz-accent-subtle: hsl(160, 84%, 94%);
  --lz-accent-ring: hsla(160, 84%, 39%, 0.35);

  /* Semantic State Colors */
  --lz-status-success: hsl(142, 71%, 45%);
  --lz-status-warning: hsl(38, 92%, 50%);
  --lz-status-danger: hsl(0, 84%, 60%);
  --lz-status-info: hsl(217, 91%, 60%);

  /* In-Situ Live Preview Tokens */
  --lz-preview-bg: hsl(48, 100%, 94%);
  --lz-preview-outline: hsl(38, 92%, 50%);
  --lz-preview-text: hsl(38, 92%, 18%);

  /* Borders & Dividers */
  --lz-border-subtle: hsl(214, 32%, 91%);
  --lz-border-strong: hsl(214, 20%, 82%);
  --lz-border-glass: hsla(0, 0%, 100%, 0.3);

  /* Typography Stack */
  --lz-font-sans:
    'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --lz-font-mono: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
  --lz-font-size-xs: 11px;
  --lz-font-size-sm: 12px;
  --lz-font-size-base: 13px;
  --lz-font-size-md: 14px;
  --lz-font-size-lg: 16px;
  --lz-font-size-xl: 20px;
  --lz-font-size-2xl: 24px;

  /* Elevation & Glassmorphism Shadows */
  --lz-shadow-sm: 0 1px 2px 0 hsla(0, 0%, 0%, 0.05);
  --lz-shadow-md: 0 4px 6px -1px hsla(0, 0%, 0%, 0.08), 0 2px 4px -1px hsla(0, 0%, 0%, 0.04);
  --lz-shadow-lg: 0 10px 15px -3px hsla(0, 0%, 0%, 0.1), 0 4px 6px -2px hsla(0, 0%, 0%, 0.05);
  --lz-shadow-xl: 0 20px 25px -5px hsla(0, 0%, 0%, 0.15), 0 10px 10px -5px hsla(0, 0%, 0%, 0.04);
  --lz-blur-glass: blur(12px) saturate(180%);

  /* Border Radius */
  --lz-radius-sm: 4px;
  --lz-radius-md: 8px;
  --lz-radius-lg: 12px;
  --lz-radius-full: 9999px;

  /* Animation Curves */
  --lz-ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --lz-ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --lz-duration-fast: 120ms;
  --lz-duration-normal: 220ms;
  --lz-duration-slow: 350ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    --lz-bg-canvas: hsl(222, 47%, 7%);
    --lz-bg-surface: hsl(222, 47%, 10%);
    --lz-bg-surface-elevated: hsl(217, 33%, 15%);
    --lz-bg-surface-glass: hsla(222, 47%, 11%, 0.85);
    --lz-bg-overlay: hsla(222, 47%, 4%, 0.7);

    --lz-text-primary: hsl(210, 40%, 98%);
    --lz-text-secondary: hsl(215, 20%, 72%);
    --lz-text-muted: hsl(215, 16%, 50%);
    --lz-text-inverse: hsl(222, 47%, 11%);

    --lz-accent-primary: hsl(160, 84%, 44%);
    --lz-accent-hover: hsl(160, 84%, 50%);
    --lz-accent-active: hsl(160, 84%, 38%);
    --lz-accent-subtle: hsla(160, 84%, 44%, 0.15);
    --lz-accent-ring: hsla(160, 84%, 44%, 0.4);

    --lz-border-subtle: hsl(217, 33%, 18%);
    --lz-border-strong: hsl(217, 33%, 25%);
    --lz-border-glass: hsla(217, 33%, 30%, 0.4);

    --lz-preview-bg: hsl(48, 90%, 15%);
    --lz-preview-outline: hsl(38, 92%, 55%);
    --lz-preview-text: hsl(48, 100%, 90%);
  }
}
```

#### 4.6.2 In-Situ Shadow DOM Host & Components (`src/content/shadow-ui/`)

The in-page UI must be completely immune to host page CSS bleed and script tampering.

##### A. Closed Shadow Host Initialization (`shadow-host.ts`)

1. Maintain a single custom element `<lazarus-recovery-host>` attached to `document.documentElement`.
2. Attach a **Closed Shadow Root**:
   ```typescript
   const host = document.createElement('lazarus-recovery-host');
   const shadow = host.attachShadow({ mode: 'closed' });
   ```
3. Inject the CSS reset and theme into the Shadow Root:
   ```css
   :host {
     all: initial !important;
     position: absolute !important;
     top: 0 !important;
     left: 0 !important;
     width: 0 !important;
     height: 0 !important;
     z-index: 2147483647 !important;
     pointer-events: none !important;
   }
   * {
     box-sizing: border-box;
     font-family: var(--lz-font-sans);
     margin: 0;
     padding: 0;
   }
   ```

##### B. Floating Trigger Button (`recovery-button.ts`)

1. **DOM Structure:**
   ```html
   <button
     class="lz-trigger-btn"
     aria-label="Lazarus Form Recovery"
     title="Recover field text (Lazarus)"
   >
     <svg
       viewBox="0 0 24 24"
       width="14"
       height="14"
       fill="none"
       stroke="currentColor"
       stroke-width="2.2"
       stroke-linecap="round"
       stroke-linejoin="round"
     >
       <path
         d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
       />
     </svg>
   </button>
   ```
2. **Dynamic Positioning Algorithm:**
   - On target element `focus`, query target element coordinates:
     $$\text{top} = \text{rect.top} + \text{window.scrollY}, \quad \text{left} = \text{rect.left} + \text{window.scrollX}$$
   - **Internal Placement (Default):** Anchor 6px inside the top-right corner of the target field:
     $$\text{btnX} = \text{left} + \text{rect.width} - \text{btnWidth} - 6, \quad \text{btnY} = \text{top} + \frac{\text{rect.height} - \text{btnHeight}}{2}$$
   - **External Placement (Small inputs, height < 28px):** If field height is constrained or scrollbars are present, anchor immediately adjacent to the outside right border:
     $$\text{btnX} = \text{left} + \text{rect.width} + 4, \quad \text{btnY} = \text{top}$$
   - **Viewport Boundary Clamp:** Ensure $\text{btnX} \le \text{window.innerWidth} - \text{btnWidth} - 8$ and $\text{btnY} \ge \text{window.scrollY} + 4$.
   - **Scroll & Resize Tracking:** Bind non-passive `window.addEventListener('scroll', updatePos, { capture: true })` and connect a `ResizeObserver` to target field to guarantee smooth sticky positioning during scroll/zoom.
3. **Visual States & Micro-animations:**
   - **Idle:** `opacity: 0.35; transform: scale(0.92); pointer-events: auto;`
   - **Target Focused:** `opacity: 0.75; transform: scale(1.0);`
   - **Button Hovered:** `opacity: 1.0; transform: scale(1.1); background: var(--lz-accent-primary); color: white; box-shadow: var(--lz-shadow-md);`
   - Transition: `transition: opacity var(--lz-duration-fast) var(--lz-ease-smooth), transform var(--lz-duration-fast) var(--lz-ease-spring), background var(--lz-duration-fast);`

##### C. Dropdown Recovery Menu (`recovery-menu.ts`)

1. **DOM Structure:**
   ```html
   <div class="lz-menu-card" role="dialog" aria-label="Recoverable Drafts">
     <div class="lz-menu-header">
       <div class="lz-menu-title">
         <span class="lz-brand-icon"></span>
         <span>Lazarus Recovery</span>
       </div>
       <span class="lz-item-counter">3 drafts</span>
     </div>
     <div class="lz-search-box">
       <input type="search" class="lz-search-input" placeholder="Search field history..." />
     </div>
     <ul class="lz-snippet-list" role="listbox">
       <!-- Dynamic Item Template -->
       <li class="lz-snippet-item" role="option" tabindex="0" data-field-id="...">
         <div class="lz-snippet-meta">
           <span class="lz-timestamp">3 mins ago</span>
           <span class="lz-badge">142 words</span>
         </div>
         <p class="lz-snippet-preview">
           The rebuilding project requires replacing WebSQL with Dexie.js...
         </p>
       </li>
     </ul>
     <div class="lz-menu-footer">
       <button class="lz-footer-action lz-restore-all-btn">
         <span>Recover entire form</span>
       </button>
       <div class="lz-footer-links">
         <button class="lz-icon-link lz-settings-btn" title="Options">⚙️</button>
         <button class="lz-icon-link lz-disable-btn" title="Disable on this domain">🚫</button>
       </div>
     </div>
   </div>
   ```
2. **Glassmorphic Styling:**
   - `background: var(--lz-bg-surface-glass);`
   - `backdrop-filter: var(--lz-blur-glass); -webkit-backdrop-filter: var(--lz-blur-glass);`
   - `border: 1px solid var(--lz-border-glass);`
   - `border-radius: var(--lz-radius-lg);`
   - `box-shadow: var(--lz-shadow-xl);`
   - `max-height: 380px; width: 320px; overflow: hidden; display: flex; flex-direction: column;`
3. **Keyboard Accessibility Contract:**
   - `ArrowDown` / `ArrowUp`: Cycle focused list item with `.is-active` class.
   - `Enter`: Commit currently focused item into target input.
   - `Escape`: Close menu, revert preview draft, and return focus to target input.

##### D. Live Hover-Preview & Rollback Engine (`live-preview.ts`)

To allow instant visual confirmation before restoring:

1. **Hover Stash (`mouseenter` on `.lz-snippet-item`):**
   - Store active field draft: `targetField._lazarusOriginalValue = targetField.value;`
   - Store active field styling: `targetField._lazarusOriginalBg = targetField.style.backgroundColor;`
   - Set field value to snippet text: `targetField.value = itemData.value;`
   - Apply live-preview indicator style:
     ```typescript
     targetField.style.setProperty('background-color', 'var(--lz-preview-bg)', 'important');
     targetField.style.setProperty('outline', '2px dashed var(--lz-preview-outline)', 'important');
     targetField.style.setProperty('outline-offset', '-1px', 'important');
     ```
2. **Rollback (`mouseleave` on `.lz-snippet-item` or menu dismiss):**
   - Revert field value: `targetField.value = targetField._lazarusOriginalValue;`
   - Revert styling:
     ```typescript
     targetField.style.backgroundColor = targetField._lazarusOriginalBg || '';
     targetField.style.outline = '';
     targetField.style.outlineOffset = '';
     delete targetField._lazarusOriginalValue;
     ```
3. **Commit Selection (`click` on `.lz-snippet-item`):**
   - Clear stash variables without rolling back.
   - Remove preview outline and background styling.
   - **Reactive Dispatch:** Dispatch synthetic input events to ensure frameworks (React, Vue, Angular, Svelte) register the change:
     ```typescript
     targetField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
     targetField.dispatchEvent(new Event('change', { bubbles: true }));
     ```
   - Play a subtle 150ms green flash confirmation animation (`--lz-status-success`).
   - Dismiss dropdown menu.

---

#### 4.6.3 Modern Extension Action Popup (`src/popup/popup.html`)

The popup provides instantaneous inspection and quick actions for the active tab:

- **Dimensions:** Fixed width `380px`, dynamic height (`min-height: 360px; max-height: 560px;`).
- **Header Section:**
  - Lazarus logo with pulsating status beacon (Green = Recording, Yellow = Encrypted/Locked, Grey = Disabled on Site).
  - Active site indicator chip showing favicon and domain (e.g. `github.com`).
  - Search trigger icon.
- **Context Card (Current Site Status):**
  - Toggle Switch: "Enable on this domain". Toggling off prompts immediate domain blocklisting with option to wipe existing tab records.
  - Active form save count: e.g. "2 recoverable forms saved on this page".
- **Tabbed View Switcher:**
  - `[ Current Tab ]` (Default): Shows form snapshots matching active tab URL.
  - `[ Global Search ]`: Expands instant full-text search across all saved records.
- **Form Snapshot Card:**
  - Card Header: Form title, last edited timestamp (`timeAgo()`), total words saved.
  - Action Row: `[ Restore All Fields ]` primary button, `[ Expand Fields ▾ ]` accordion trigger.
  - Accordion Details: Lists individual fields (e.g. `textarea#comment_body`, `input[name="title"]`) with direct copy-to-clipboard button and single-field restore action.
- **Footer Bar:**
  - Master Password lock / unlock trigger with status badge.
  - Shortcut to Options page (`chrome.runtime.openOptionsPage()`).
  - Side Panel launcher shortcut.

---

#### 4.6.4 Modern Extension Side Panel (`src/sidepanel/sidepanel.html`)

Designed for deep recovery, long-term history browsing, and revision diffing alongside the user's active browsing workflow:

- **Registration:** Configured in `manifest.json` under `"side_panel"` and managed via `chrome.sidePanel.setPanelBehavior`.
- **Layout:** Responsive column (`width: 100%; height: 100vh; overflow: hidden; display: flex; flex-direction: column;`).
- **Global Search & Filter Hub:**
  - Input: Instant debounced (200ms) full-text search with clear button.
  - Filter Chips: `[ All Domains ▾ ]`, `[ Today | 7d | 30d ]`, `[ Form Type: All ▾ ]`.
- **Chronological Revision Timeline:**
  - Virtualized list of form snapshots grouped by date (Today, Yesterday, Last Week).
  - Snapshot item displays site favicon, domain, page title, time, and word count.
- **Interactive Revision Diff Viewer:**
  - Selecting any snapshot displays a side-by-side or unified text diff viewer comparing the historical snapshot with the active webpage's current field draft.
  - Additions highlighted in soft green (`hsla(142, 71%, 45%, 0.18)`), deletions in soft red (`hsla(0, 84%, 60%, 0.18)`).
  - Direct "Copy Snapshot Text" and "Inject into Current Tab" actions.

---

#### 4.6.5 Modern Options & Management Page (`src/options/options.html`)

Replaces the legacy 860px fixed-width container with a fluid, modern settings center:

- **Layout Architecture:**
  - Centered responsive container: `max-width: 1040px; margin: 0 auto; padding: 2.5rem 1.5rem; display: grid; grid-template-columns: 240px 1fr; gap: 2rem;`
  - Sticky left sidebar navigation with navigation items:
    - 🛡️ General Preferences
    - 🔐 Security & Vault
    - 🌐 Disabled Domains
    - 💾 Storage & Data Management
    - ℹ️ About & Diagnostics
- **Tab 1: General Preferences:**
  - **Save Passwords:** Toggle switch with prominent amber warning banner detailing risk of storing credentials in local storage.
  - **Automatic PII / Credit Card Redaction:** Toggle switch enabling regex and Luhn algorithm pattern detection to prevent credit card numbers from touching IndexedDB.
  - **Data Retention Duration:** Interactive slider ranging from `1` to `30` days with visual day indicator chip and real-time expiration notice.
- **Tab 2: Security & Vault (Master Password):**
  - **Encryption Mode:** Radio card selector between _Standard Mode_ (Unencrypted local storage) and _Master Password Mode_ (AES-GCM-256 with PBKDF2).
  - **Master Password Configuration:**
    - "Set Master Password" / "Change Password" modal dialog.
    - Real-time password strength meter (entropy estimation, length check, complexity indicator).
    - Cryptographic parameter readout: `PBKDF2-SHA256, 100,000 iterations, 32-byte salt`.
  - **Vault Auto-Lock Inactivity Timer:** Dropdown select (`5 minutes`, `15 minutes`, `30 minutes`, `1 hour`, `Never during browser session`).
- **Tab 3: Disabled Domains:**
  - **Domain Exclusion Table:** Clean, filterable table displaying excluded domains, date added, and an unblock button.
  - **Add Domain Input:** Text input supporting wildcards (e.g. `*.bank.com`, `localhost:*`) with instant domain validation.
- **Tab 4: Storage & Maintenance:**
  - **Storage Usage Bar:** Visual capacity meter querying `navigator.storage.estimate()` showing IndexedDB storage footprint in megabytes.
  - **Database Re-indexing & Optimization:** Button to run background compaction and re-index Dexie tables.
  - **Encrypted JSON Export:** Download complete form history serialized and encrypted with the user's Master Key.
  - **Danger Zone (Wipe All History):** Destructive red card with "Erase All Stored Forms" button, protected by a confirmation modal requiring the user to type `DELETE` to prevent accidental loss.
- **Tab 5: About & Diagnostics:**
  - Current extension version, build hash, active Manifest V3 status, and Service Worker heartbeat check.

---

## 5. Technical Architecture, Schemas & Protocols

### 5.1 Project Layout (TypeScript + Vite)

```
lazarus-form-recovery/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── manifest.config.ts             # Dynamic MV3 manifest generator
├── playwright.config.ts           # E2E test configuration
├── vitest.config.ts               # Unit test configuration
├── src/
│   ├── manifest.json              # Base MV3 manifest
│   ├── background/
│   │   ├── index.ts               # Service Worker entrypoint
│   │   ├── alarms.ts              # Periodic alarms (cleanup, sync)
│   │   ├── context-menus.ts       # Context menu actions
│   │   ├── storage-manager.ts     # Session & IndexedDB orchestration
│   │   └── message-router.ts      # Typed RPC dispatcher
│   ├── content/
│   │   ├── index.ts               # Content script entrypoint
│   │   ├── form-tracker.ts        # DOM listener & debounce controller
│   │   ├── field-extractor.ts     # Input / Select / Textarea value extractor
│   │   ├── rich-text/             # WYSIWYG & Editor adapters
│   │   │   ├── contenteditable.ts
│   │   │   ├── quill-adapter.ts
│   │   │   ├── tinymce-adapter.ts
│   │   │   └── prose-mirror.ts
│   │   ├── shadow-ui/             # In-situ UI inside Closed Shadow Root
│   │   │   ├── shadow-host.ts     # Host element lifecycle & closed shadow root
│   │   │   ├── recovery-button.ts # Floating trigger button & positioning engine
│   │   │   ├── recovery-menu.ts   # Glassmorphic dropdown menu & keyboard navigation
│   │   │   └── shadow-ui.css      # Scoped reset & component styles
│   │   └── live-preview.ts        # Hover-preview stash & rollback logic
│   ├── popup/
│   │   ├── popup.html             # Action popup HTML
│   │   ├── popup.ts               # Tab status & quick recovery controller
│   │   └── popup.css              # Glassmorphic popup layout
│   ├── sidepanel/
│   │   ├── sidepanel.html         # Side panel search & timeline HTML
│   │   ├── sidepanel.ts           # Revision timeline & text diffing controller
│   │   └── sidepanel.css          # Side panel split view styles
│   ├── options/
│   │   ├── options.html           # Settings center HTML
│   │   ├── options.ts             # Vault manager & preferences controller
│   │   └── options.css            # Responsive grid options styles
│   └── common/
│       ├── styles/
│       │   └── theme.css          # Unified design tokens (colors, typography, shadows)
│       ├── types/                 # Shared TypeScript interfaces
│       │   ├── messages.ts
│       │   ├── schema.ts
│       │   └── config.ts
│       ├── crypto/                # W3C WebCrypto implementation
│       │   ├── web-crypto.ts
│       │   └── vault.ts
│       ├── db/                    # IndexedDB Dexie.js database
│       │   ├── lazarus-db.ts
│       │   └── repository.ts
│       └── utils/
│           ├── dom.ts
│           ├── hashing.ts
│           └── text.ts
```

---

### 5.2 IndexedDB Database Schema (Dexie.js)

```typescript
// src/common/types/schema.ts

export interface IDBDomain {
  id: string; // SHA-256 hash of hostname
  domain: string; // Plain or encrypted domain string
  totalEditingTime: number; // Aggregate editing seconds
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBForm {
  id: string; // UUID v4 or deterministic SHA-256 hash
  domainId: string; // Foreign key -> IDBDomain.id
  url: string; // Full URL (plain or AES-GCM encrypted)
  formInstanceId: string; // Runtime DOM instance identifier
  title: string; // Page / Form title
  encryption: 'none' | 'hybrid-aes-gcm';
  editingTime: number; // Seconds spent editing this form
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBField {
  id: string; // SHA-256(domain + name + type + value)
  formId: string; // Foreign key -> IDBForm.id
  domainId: string; // Foreign key -> IDBDomain.id
  name: string; // Field name or selector identifier
  type: string; // 'text' | 'textarea' | 'contenteditable' | 'select' | etc.
  value: string; // Plain text or AES-GCM encrypted ciphertext
  encryption: 'none' | 'hybrid-aes-gcm';
  lastModified: number; // Unix timestamp (ms)
  status: number; // 0: Active, 1: Soft-deleted
}

export interface IDBSetting {
  key: string; // Primary key (e.g. 'expireFormsInterval')
  value: any; // JSON-serializable value
  lastModified: number;
}
```

```typescript
// src/common/db/lazarus-db.ts
import Dexie, { Table } from 'dexie';
import { IDBDomain, IDBForm, IDBField, IDBSetting } from '../types/schema';

export class LazarusDatabase extends Dexie {
  domains!: Table<IDBDomain, string>;
  forms!: Table<IDBForm, string>;
  fields!: Table<IDBField, string>;
  settings!: Table<IDBSetting, string>;

  constructor() {
    super('LazarusDatabase');

    this.version(1).stores({
      domains: 'id, domain, lastModified, status',
      forms: 'id, domainId, url, lastModified, status, [domainId+lastModified]',
      fields: 'id, formId, domainId, name, type, lastModified, status, [domainId+name+type]',
      settings: 'key, lastModified',
    });
  }
}

export const db = new LazarusDatabase();
```

---

### 5.3 Typed Message Passing Protocol

All communication between Content Scripts, Service Worker, Popup, and Options is strictly typed using Discriminated Unions:

```typescript
// src/common/types/messages.ts

export type RuntimeMessage =
  | { type: 'SAVE_AUTOSAVE'; payload: { form: FormSnapshot } }
  | { type: 'SUBMIT_FORM'; payload: { form: FormSnapshot } }
  | {
      type: 'GET_RECOVERABLE_TEXT';
      payload: { domain: string; fieldName: string; fieldType: string };
    }
  | { type: 'GET_RECOVERABLE_FORM'; payload: { formId: string } }
  | { type: 'CHECK_VAULT_STATUS' }
  | { type: 'UNLOCK_VAULT'; payload: { password: string } }
  | { type: 'LOCK_VAULT' }
  | { type: 'IS_DOMAIN_ENABLED'; payload: { domain: string } }
  | { type: 'DISABLE_DOMAIN'; payload: { domain: string; wipeExisting: boolean } }
  | { type: 'SEARCH_HISTORY'; payload: { query: string; limit?: number } };

export interface FormSnapshot {
  formInstanceId: string;
  url: string;
  domain: string;
  title: string;
  editingTime: number;
  fields: FieldSnapshot[];
}

export interface FieldSnapshot {
  name: string;
  type: string;
  value: string;
  selector?: string;
}

export interface RuntimeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
```

---

### 5.4 Web Crypto API Implementation

```typescript
// src/common/crypto/web-crypto.ts

export class WebCryptoVault {
  private static readonly PBKDF2_ITERATIONS = 100_000;
  private static readonly AES_KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12; // 96 bits for AES-GCM

  /**
   * Derives an AES-GCM key from a master password and salt.
   */
  public static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: this.AES_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts plaintext string using AES-GCM-256.
   * Format: base64(IV + Ciphertext + Tag)
   */
  public static async encrypt(plainText: string, key: CryptoKey): Promise<string> {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plainText)
    );

    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypts ciphertext string using AES-GCM-256.
   */
  public static async decrypt(cipherBase64: string, key: CryptoKey): Promise<string> {
    const binary = atob(cipherBase64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    const iv = combined.slice(0, this.IV_LENGTH);
    const cipherBuffer = combined.slice(this.IV_LENGTH);

    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuffer);

    return new TextDecoder().decode(plainBuffer);
  }
}
```

---

## 6. Manifest V3 Configuration (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "Lazarus: Form Recovery",
  "version": "4.0.0",
  "description": "Never lose form data, comments, or rich text drafts again. Secure, encrypted, and local form recovery.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    },
    "default_title": "Lazarus: Form Recovery"
  },
  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  },
  "side_panel": {
    "default_path": "src/sidepanel/sidepanel.html"
  },
  "permissions": ["storage", "alarms", "contextMenus", "sidePanel"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["src/content/index.ts"],
      "all_frames": true,
      "match_about_blank": true,
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "recover_last_form": {
      "suggested_key": {
        "default": "Alt+Shift+L",
        "mac": "Alt+Shift+L"
      },
      "description": "Recover the last edited form on the current page"
    },
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+F",
        "mac": "Command+Shift+F"
      }
    }
  }
}
```

---

## 7. Testing, Toolchain, Signing & CI/CD Strategy

### 7.1 Modern Build Toolchain

- **Vite** + **`@crxjs/vite-plugin`**: Real-time HMR during extension development, producing optimized tree-shaken ES modules for Chrome, Firefox, and Safari.
- **TypeScript (Strict Mode)**: Comprehensive type safety across message contracts, database entities, and DOM interfaces.

### 7.2 Automated Test Suite

#### 7.2.1 Unit Tests (Vitest)

- **WebCrypto Vault Suite:** Validates AES-GCM encryption/decryption, wrong-password rejection, salt generation, and corruption handling.
- **Database Suite:** Validates IndexedDB transactions, TTL record expiration, soft-deletion, and text search queries.
- **Field Extractor Suite:** Unit tests parsing complex HTML forms, nested radio buttons, and multi-select options using JSDOM / Happy-DOM.

#### 7.2.2 End-to-End Tests (Playwright)

Playwright launches an isolated Chromium browser instance loaded with the unpacked extension:

1. **Form Crash Recovery Scenario:**
   - Navigates to a mock form page.
   - Types into multiple textboxes, textareas, and Quill rich text editors.
   - Triggers `page.reload()` (simulating crash or refresh).
   - Verifies `<lazarus-recovery-host>` renders the recovery button.
   - Clicks recovery item and asserts 100% text fidelity restored across all fields.
2. **Master Password Lock Scenario:**
   - Enables Master Password in options.
   - Verifies recovery menu requires password authentication before displaying plaintext previews.
   - Inputs wrong password -> asserts error toast.
   - Inputs correct password -> asserts forms become recoverable.
3. **Domain Blocklist Scenario:**
   - Adds `localhost` to disabled domains.
   - Types into form -> asserts zero writes to IndexedDB and no floating trigger icon rendered.

---

### 7.3 Multi-Browser Signing & Deployment Pipeline

```
                              ┌─────────────────────────────────────────┐
                              │             GIT TAG RELEASE             │
                              │               (e.g. v4.0.0)             │
                              └────────────────────┬────────────────────┘
                                                   │
                                                   ▼
                              ┌─────────────────────────────────────────┐
                              │          GITHUB ACTIONS CI/CD           │
                              │  - TypeCheck (`tsc --noEmit`)           │
                              │  - Unit Tests (`vitest run`)            │
                              │  - E2E Tests (`playwright test`)        │
                              └────────────────────┬────────────────────┘
                                                   │
                         ┌─────────────────────────┼─────────────────────────┐
                         ▼                         ▼                         ▼
            ┌────────────────────────┐┌────────────────────────┐┌────────────────────────┐
            │   CHROME WEB STORE     ││    MOZILLA ADD-ONS     ││   SAFARI / APP STORE   │
            │  - Build Chrome target ││  - Build Firefox target││  - `xcrun safari-web-  │
            │  - ZIP Package Artifact││  - Sign via `web-ext`  ││    extension-converter`│
            │  - Upload via CWS API  ││  - Upload to AMO       ││  - Xcode Archive & Sign│
            └────────────────────────┘└────────────────────────┘└────────────────────────┘
```

#### GitHub Actions Workflow (`.github/workflows/release.yml`):

```yaml
name: Release & Multi-Browser Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      - run: npx playwright install --with-deps
      - run: npm run test:e2e

      - name: Build Extension Packages
        run: npm run build:all

      - name: Publish to Chrome Web Store
        uses: mobilefirstllc/cws-publish@v1.8.0
        with:
          action: 'upload'
          client-id: ${{ secrets.CWS_CLIENT_ID }}
          client-secret: ${{ secrets.CWS_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CWS_REFRESH_TOKEN }}
          extension-id: ${{ secrets.CWS_EXTENSION_ID }}
          zip-path: 'dist/chrome-lazarus-v3.zip'

      - name: Sign & Submit to Mozilla Add-ons (Firefox)
        run: npx web-ext sign --source-dir dist/firefox --api-key ${{ secrets.AMO_JWT_ISSUER }} --api-secret ${{ secrets.AMO_JWT_SECRET }}
```

---

## 8. Step-by-Step Implementation Prompt for LLMs

To reimplement this extension from scratch using an LLM or autonomous coding agent, execute the phases in the following order:

1. **Phase 1: Project Scaffold & Infrastructure**
   - Initialize Vite + TypeScript repository with `@crxjs/vite-plugin`.
   - Configure `manifest.config.ts` for Manifest V3.
   - Establish Dexie.js database schema in `src/common/db/` and typed message models in `src/common/types/`.
2. **Phase 2: Cryptographic Vault & Security**
   - Implement `WebCryptoVault` in `src/common/crypto/web-crypto.ts` utilizing `crypto.subtle` for AES-GCM-256 and PBKDF2.
   - Implement Master Password unlock, lock timers, and encrypted record serialization.
3. **Phase 3: Background Service Worker**
   - Implement `src/background/index.ts` with message handlers for `SAVE_AUTOSAVE`, `SUBMIT_FORM`, `GET_RECOVERABLE_TEXT`, and `SEARCH_HISTORY`.
   - Setup `chrome.alarms` in `src/background/alarms.ts` for 30-minute automated database cleanup of expired forms.
   - Implement session buffering via `chrome.storage.session`.
4. **Phase 4: Content Script & Form Tracking Engine**
   - Implement `src/content/form-tracker.ts` to capture all input/textarea/select changes with a 500ms debounce.
   - Implement WYSIWYG / ContentEditable adapters for Quill, TinyMCE, CKEditor, and ProseMirror in `src/content/rich-text/`.
   - Implement orphaned input detection ("Fake Forms").
5. **Phase 5: Closed Shadow DOM In-Situ UI (`src/content/shadow-ui/`)**
   - Implement `shadow-host.ts`: Append `<lazarus-recovery-host>` to `document.documentElement`, initialize a **Closed Shadow Root**, and inject CSS resets (`:host { all: initial }`) and tokens from `theme.css`.
   - Implement `recovery-button.ts`: Render floating `<button class="lz-trigger-btn">` positioned dynamically via `getBoundingClientRect()` relative to active focused editable fields, with boundary collision clamping and non-passive scroll tracking.
   - Implement `recovery-menu.ts`: Render glassmorphic card with search input, relative timestamp formatting (`timeAgo()`), word/character counts, and full keyboard accessibility (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`).
   - Implement `live-preview.ts`: Non-destructive hover stash protocol (`field._lazarusOriginalValue`), temporary yellow outline/background indicator, instant rollback on mouseleave, and synthetic `input`+`change` event dispatch on item commit.
6. **Phase 6: Extension Popup, Side Panel & Options Management UI**
   - Implement `src/popup/`: Render 380px fixed-width popup with active site context chip, domain toggle, tab-specific form snapshot cards, and expandable field snippets.
   - Implement `src/sidepanel/`: Implement MV3 `side_panel` full-height view with debounced global full-text search, multi-criteria filter chips, chronological revision timeline, and side-by-side text diffing.
   - Implement `src/options/`: Build responsive 2-column layout (`max-width: 1040px`) with sidebar navigation:
     - General tab: Password saving toggle with warning, credit card redaction, 1–30 day retention slider.
     - Security tab: Master Password setup modal with PBKDF2 parameters, live strength meter, and auto-lock timeout selector.
     - Disabled domains tab: Search-filterable exclusion table with wildcard domain support and batch unblock.
     - Storage tab: IndexedDB usage meter, encrypted JSON backup export, and nuclear history wipe modal requiring `DELETE` confirmation.
7. **Phase 7: Test Suite & CI/CD**
   - Author Vitest tests in `tests/unit/` covering WebCrypto and Dexie database operations.
   - Author Playwright E2E tests in `tests/e2e/` testing live form recovery across crashes, refreshes, and rich text editors.
