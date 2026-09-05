import DOMPurify from 'dompurify';
import { RichTextAdapter } from './adapter';

export class QuillAdapter implements RichTextAdapter {
  public readonly name = 'quill';

  public matches(element: HTMLElement): boolean {
    return element.classList.contains('ql-editor') || element.closest('.ql-container') !== null;
  }

  public getValue(element: HTMLElement): string {
    const editor = element.classList.contains('ql-editor')
      ? element
      : (element.querySelector('.ql-editor') as HTMLElement) || element;
    return editor.innerHTML || editor.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    const editor = element.classList.contains('ql-editor')
      ? element
      : (element.querySelector('.ql-editor') as HTMLElement) || element;
    editor.innerHTML = DOMPurify.sanitize(value);
  }

  public getName(element: HTMLElement): string {
    const container = element.closest('.ql-container') || element;
    return container.id || container.getAttribute('name') || 'quill_editor';
  }
}
