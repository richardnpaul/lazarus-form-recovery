import { RuntimeMessage } from '../common/types/messages';
import { attachRecoveryUI } from './shadow-ui/shadow-host';
import { FieldExtractor } from './field-extractor';
import { findRichTextAdapter } from './rich-text';
import { escapeCss } from '../common/utils/dom';
import { isExtensionContextValid, safeSendMessage } from '../common/utils/runtime';

export class FormTracker {
  private autosaveTimer: any = null;
  private readonly AUTOSAVE_DELAY = 300; // 300ms debounce
  private readonly EDITING_IDLE_TIME = 300000; // 5 minutes in ms

  // Last focused or right-clicked element
  private lastInteractedElement: HTMLElement | null = null;

  // Active editing time state per form: formInstanceId -> { start, last, totalSec }
  private editingSessions: Map<string, { start: number; last: number; totalSec: number }> =
    new Map();

  private onInput = this.handleInput.bind(this);
  private onCompositionEnd = this.handleInput.bind(this);
  private onChange = this.handleInput.bind(this);
  private onFocus = this.handleFocus.bind(this);
  private onSubmit = this.handleSubmit.bind(this);
  private onReset = this.handleReset.bind(this);
  private onContextMenu = ((e: Event) => this.handleContextMenu(e as MouseEvent)) as EventListener;
  private onRuntimeMessageBound = this.handleRuntimeMessage.bind(this);

  private onBlur = ((event: Event) => {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (target && this.isTrackable(target)) {
      if (this.autosaveTimer) {
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
        this.triggerAutosave(target);
      }
    }
  }) as EventListener;

  private onPaste = ((event: Event) => {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (target && this.isTrackable(target)) {
      this.handleInput(event);
    }
  }) as EventListener;

  private onKeyDown = ((e: KeyboardEvent) => {
    if (!this.ensureContextValid()) return;
    if (e.key === 'Enter') {
      const target = (e.composedPath?.()[0] || e.target) as HTMLElement;
      if (target && this.isTrackable(target)) {
        if (this.autosaveTimer) {
          clearTimeout(this.autosaveTimer);
          this.autosaveTimer = null;
        }
        this.triggerAutosave(target);
      }
    }
  }) as EventListener;

  private onPageHide = (() => {
    if (!this.ensureContextValid()) return;
    if (this.lastInteractedElement && this.isTrackable(this.lastInteractedElement)) {
      if (this.autosaveTimer) {
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
      }
      this.triggerAutosave(this.lastInteractedElement);
    }
  }).bind(this);

  constructor(private root: Document | HTMLElement = document) {}

  /**
   * Validates that the extension context is still alive.
   * If invalidated, automatically stops tracking and removes event listeners to prevent errors.
   */
  private ensureContextValid(): boolean {
    if (!isExtensionContextValid()) {
      this.stop();
      return false;
    }
    return true;
  }

  public start() {
    if (!this.ensureContextValid()) return;

    // Use capture phase for DOM events
    this.root.addEventListener('input', this.onInput, true);
    this.root.addEventListener('compositionend', this.onCompositionEnd, true);
    this.root.addEventListener('change', this.onChange, true);
    this.root.addEventListener('focus', this.onFocus, true);
    this.root.addEventListener('blur', this.onBlur, true);
    this.root.addEventListener('paste', this.onPaste, true);
    this.root.addEventListener('submit', this.onSubmit, true);
    this.root.addEventListener('reset', this.onReset, true);
    this.root.addEventListener('contextmenu', this.onContextMenu, true);
    this.root.addEventListener('keydown', this.onKeyDown, true);

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.onPageHide, true);
      window.addEventListener('pagehide', this.onPageHide, true);
    }

    // Listen for background actions (e.g. from context menus)
    try {
      chrome.runtime.onMessage?.addListener(this.onRuntimeMessageBound);
    } catch {}
  }

  public stop() {
    this.root.removeEventListener('input', this.onInput, true);
    this.root.removeEventListener('compositionend', this.onCompositionEnd, true);
    this.root.removeEventListener('change', this.onChange, true);
    this.root.removeEventListener('focus', this.onFocus, true);
    this.root.removeEventListener('blur', this.onBlur, true);
    this.root.removeEventListener('paste', this.onPaste, true);
    this.root.removeEventListener('submit', this.onSubmit, true);
    this.root.removeEventListener('reset', this.onReset, true);
    this.root.removeEventListener('contextmenu', this.onContextMenu, true);
    this.root.removeEventListener('keydown', this.onKeyDown, true);

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onPageHide, true);
      window.removeEventListener('pagehide', this.onPageHide, true);
    }

    try {
      if (isExtensionContextValid()) {
        chrome.runtime.onMessage?.removeListener(this.onRuntimeMessageBound);
      }
    } catch {}

    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }

    try {
      const host = document.querySelector('lazarus-recovery-host');
      if (host) {
        host.remove();
      }
    } catch {}
  }

  private isTrackable(target: HTMLElement): boolean {
    return FieldExtractor.isTrackable(target, false);
  }

  private updateEditingTime(formInstanceId: string): number {
    const now = Date.now();
    let session = this.editingSessions.get(formInstanceId);

    if (!session) {
      session = { start: now, last: now, totalSec: 0 };
      this.editingSessions.set(formInstanceId, session);
    } else {
      const idleTime = now - session.last;
      if (idleTime > this.EDITING_IDLE_TIME) {
        // Idle period: reset current burst start
        session.start = now;
      } else {
        // Accumulate active seconds
        const deltaSec = Math.round((now - session.last) / 1000);
        session.totalSec += deltaSec;
      }
      session.last = now;
    }

    return session.totalSec;
  }

  private handleFocus(event: Event) {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (!target) return;

    if (this.isTrackable(target)) {
      this.lastInteractedElement = target;
      attachRecoveryUI(target);
    }
  }

  private handleContextMenu(event: MouseEvent) {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (!target) return;

    if (this.isTrackable(target)) {
      this.lastInteractedElement = target;
      const form = target.closest('form');
      const formInstanceId = form?.id || form?.getAttribute('name') || undefined;
      const adapter = findRichTextAdapter(target);
      const fieldName = adapter
        ? adapter.getName(target)
        : target.getAttribute('name') || target.id || undefined;
      const fieldType = adapter ? adapter.name : target.tagName.toLowerCase();

      // Send to background to dynamically populate context submenus
      safeSendMessage({
        type: 'UPDATE_CONTEXT_MENU',
        payload: {
          domain: window.location.hostname,
          formInstanceId,
          fieldName,
          fieldType,
        },
      });
    }
  }

  private handleInput(event: Event) {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (!target || !this.isTrackable(target)) return;

    this.lastInteractedElement = target;
    const formElement = target.closest('form');
    const formId = formElement ? formElement.id || 'form_wrapper' : 'fake_form';
    this.updateEditingTime(formId);

    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
    }

    this.autosaveTimer = setTimeout(() => {
      this.triggerAutosave(target);
    }, this.AUTOSAVE_DELAY);
  }

  private handleReset(event: Event) {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLFormElement;
    if (!target || target.tagName !== 'FORM') return;

    // Capture snapshot right before form reset clears values
    const editingTime = this.updateEditingTime(target.id || 'form_wrapper');
    const formSnapshot = FieldExtractor.buildFormSnapshot(target, editingTime);

    if (formSnapshot.fields.length > 0) {
      const message: RuntimeMessage = {
        type: 'SAVE_AUTOSAVE',
        payload: { form: formSnapshot },
      };
      safeSendMessage(message);
    }
  }

  private handleSubmit(event: Event) {
    if (!this.ensureContextValid()) return;
    const target = (event.composedPath?.()[0] || event.target) as HTMLElement;
    if (!target) return;

    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }

    const formEl = target.tagName === 'FORM' ? (target as HTMLFormElement) : target.closest('form');
    const snapshotTarget = formEl || target;
    const formId = formEl
      ? formEl.id || formEl.getAttribute('name') || 'form_wrapper'
      : 'fake_form';
    const editingTime = this.updateEditingTime(formId);
    const formSnapshot = FieldExtractor.buildFormSnapshot(snapshotTarget, editingTime);

    if (formSnapshot.fields.length > 0) {
      // Trigger full permanent save
      const message: RuntimeMessage = {
        type: 'SUBMIT_FORM',
        payload: { form: formSnapshot },
      };
      safeSendMessage(message);
    }
  }

  private triggerAutosave(target: HTMLElement) {
    if (!this.ensureContextValid()) return;
    const formElement = target.closest('form');
    const formId = formElement ? formElement.id || 'form_wrapper' : 'fake_form';
    const editingTime = this.updateEditingTime(formId);

    const formSnapshot = FieldExtractor.buildFormSnapshot(target, editingTime);

    if (formSnapshot.fields.length > 0) {
      const message: RuntimeMessage = {
        type: 'SAVE_AUTOSAVE',
        payload: { form: formSnapshot },
      };
      safeSendMessage(message);
    }
  }

  /**
   * Handles commands sent from background (e.g. context menu selections)
   */
  private async handleRuntimeMessage(message: any) {
    if (!this.ensureContextValid()) return;
    if (!message || typeof message !== 'object') return;

    if (message.action === 'RESTORE_LAST_FORM') {
      await this.restoreLastForm();
      return;
    }

    if (message.action === 'RESTORE_FORM_REVISION' && message.payload?.formId) {
      await this.restoreFormFromId(message.payload.formId);
      return;
    }

    if (message.action === 'RESTORE_FIELD_TEXT' && typeof message.payload?.value === 'string') {
      this.restoreActiveField(message.payload.value);
      return;
    }

    if (message.action === 'FORCE_SAVE_NOW') {
      this.forceSaveCurrentForm();
      return;
    }
  }

  private async restoreLastForm() {
    if (!this.ensureContextValid()) return;
    try {
      const domain =
        (typeof window !== 'undefined' && window.location?.hostname) ||
        (typeof window !== 'undefined' && window.location?.protocol === 'file:'
          ? 'local file'
          : 'unknown');
      const res = await safeSendMessage({
        type: 'GET_DOMAIN_HISTORY',
        payload: { domain, limit: 1 },
      });
      if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
        const latestItem = res.data[0];
        if (latestItem?.form?.id) {
          await this.restoreFormFromId(latestItem.form.id);
        }
      }
    } catch (err) {
      console.error('Failed to restore last form:', err);
    }
  }

  private async restoreFormFromId(formId: string) {
    if (!this.ensureContextValid()) return;
    try {
      const res = await safeSendMessage({
        type: 'GET_RECOVERABLE_FORM',
        payload: { formId },
      });

      if (!res?.success || !res.data) return;

      const { fields } = res.data;
      if (!Array.isArray(fields) || fields.length === 0) return;

      // Find target form in document
      let targetForm =
        this.lastInteractedElement?.closest('form') || document.querySelector('form');

      fields.forEach((field: any) => {
        let el: HTMLElement | null = null;
        if (targetForm) {
          el = targetForm.querySelector(
            `[name="${escapeCss(field.name)}"], #${escapeCss(field.name)}`
          );
        }
        if (!el) {
          el = document.querySelector(
            `[name="${escapeCss(field.name)}"], #${escapeCss(field.name)}`
          );
        }

        if (el) {
          this.applyValueToElement(el, field.value);
        }
      });
    } catch (err) {
      console.error('Failed to restore form revision:', err);
    }
  }

  private restoreActiveField(value: string) {
    if (!this.ensureContextValid()) return;
    const target = this.lastInteractedElement || (document.activeElement as HTMLElement);
    if (!target) return;
    this.applyValueToElement(target, value);
  }

  private forceSaveCurrentForm() {
    if (!this.ensureContextValid()) return;
    const target =
      this.lastInteractedElement ||
      (document.activeElement as HTMLElement) ||
      document.querySelector('form, input, textarea');
    if (!target) return;

    const formElement = target.closest('form');
    const formId = formElement ? formElement.id || 'form_wrapper' : 'fake_form';
    const editingTime = this.updateEditingTime(formId);
    const formSnapshot = FieldExtractor.buildFormSnapshot(target as HTMLElement, editingTime);

    safeSendMessage({
      type: 'FORCE_SAVE_SNAPSHOT',
      payload: { form: formSnapshot },
    }).then((res) => {
      if (res !== null) {
        this.flashConfirmation(target as HTMLElement);
      }
    });
  }

  private applyValueToElement(element: HTMLElement, value: string) {
    const adapter = findRichTextAdapter(element);
    if (adapter) {
      adapter.setValue(element, value);
    } else if ('value' in element) {
      (element as HTMLInputElement).value = value;
    } else {
      element.textContent = value;
    }

    // Fire synthetic framework events
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    this.flashConfirmation(element);
  }

  private flashConfirmation(element: HTMLElement) {
    const origBg = element.style.backgroundColor;
    element.style.setProperty('background-color', 'hsla(142, 71%, 45%, 0.25)', 'important');
    setTimeout(() => {
      element.style.backgroundColor = origBg;
    }, 300);
  }
}
