import { FieldSnapshot, FormSnapshot } from '../common/types/messages';
import { findRichTextAdapter } from './rich-text';
import { scrubSensitiveData } from '../common/utils/pii';
import { getElementSelector } from '../common/utils/dom';

export interface ExtractorOptions {
  savePasswords?: boolean;
  filterCreditCards?: boolean;
}

export class FieldExtractor {
  public static isTrackable(element: HTMLElement, savePasswords = false): boolean {
    if (!element || !(element instanceof HTMLElement)) return false;

    const tag = element.tagName;
    if (tag === 'INPUT') {
      const input = element as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();
      if (type === 'password') {
        return savePasswords;
      }
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') {
        return false;
      }
      return true;
    }

    if (tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }

    // Rich text or contenteditable
    const adapter = findRichTextAdapter(element);
    if (adapter) return true;

    return false;
  }

  /**
   * Extracts a FieldSnapshot from a single DOM element.
   */
  public static extractField(element: HTMLElement, options: ExtractorOptions = {}): FieldSnapshot | null {
    if (!this.isTrackable(element, options.savePasswords)) {
      return null;
    }

    const tag = element.tagName;
    let name = element.getAttribute('name') || element.id || '';
    let type = tag.toLowerCase();
    let value = '';

    if (tag === 'INPUT') {
      const input = element as HTMLInputElement;
      type = (input.type || 'text').toLowerCase();

      if (type === 'checkbox') {
        value = input.checked ? (input.value || 'on') : '';
      } else if (type === 'radio') {
        value = input.checked ? (input.value || 'on') : '';
      } else {
        value = input.value || '';
      }
    } else if (tag === 'TEXTAREA') {
      const textarea = element as HTMLTextAreaElement;
      value = textarea.value || '';
    } else if (tag === 'SELECT') {
      const select = element as HTMLSelectElement;
      if (select.multiple) {
        const selected = Array.from(select.selectedOptions).map(opt => opt.value);
        value = selected.join(',');
      } else {
        value = select.value || '';
      }
    } else {
      const adapter = findRichTextAdapter(element);
      if (adapter) {
        type = adapter.name;
        name = name || adapter.getName(element);
        value = adapter.getValue(element);
      }
    }

    if (!name) {
      name = element.id || getElementSelector(element);
    }

    // Apply sensitive data scrubbing
    if (options.filterCreditCards !== false) {
      value = scrubSensitiveData(value, name);
    }

    return {
      name,
      type,
      value,
      selector: getElementSelector(element),
    };
  }

  /**
   * Extracts all trackable fields from a form container or virtual form container.
   */
  public static extractAllFields(container: HTMLElement, options: ExtractorOptions = {}): FieldSnapshot[] {
    const fields: FieldSnapshot[] = [];
    const elements = container.querySelectorAll('input, textarea, select, [contenteditable="true"], .ql-editor, .ProseMirror, [data-lexical-editor="true"]');

    elements.forEach((el) => {
      if (el instanceof HTMLElement) {
        const snapshot = this.extractField(el, options);
        if (snapshot && (snapshot.value.trim().length > 0 || snapshot.type === 'checkbox')) {
          fields.push(snapshot);
        }
      }
    });

    return fields;
  }

  /**
   * Builds a full FormSnapshot from an element or form.
   */
  public static buildFormSnapshot(
    target: HTMLElement,
    editingTime = 0,
    options: ExtractorOptions = {}
  ): FormSnapshot {
    const formElement = target.closest('form');
    let formInstanceId = 'fake_form';
    let fields: FieldSnapshot[] = [];

    if (formElement) {
      formInstanceId = formElement.id || formElement.getAttribute('name') || 'form_wrapper';
      fields = this.extractAllFields(formElement, options);
    } else {
      // Orphaned input: check parent container or use target
      const container = target.closest('section, main, article, .form-container, div[role="form"]') as HTMLElement || target.parentElement || target;
      formInstanceId = container.id || `fake_form_${getElementSelector(container)}`;
      fields = this.extractAllFields(container, options);
      if (fields.length === 0) {
        const single = this.extractField(target, options);
        if (single) fields.push(single);
      }
    }

    return {
      formInstanceId,
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title || window.location.hostname,
      editingTime,
      fields,
    };
  }
}
