import DOMPurify from 'dompurify';
import { RichTextAdapter } from './adapter';

export class ProseMirrorAdapter implements RichTextAdapter {
  public readonly name = 'prose-mirror';

  public matches(element: HTMLElement): boolean {
    return (
      element.classList.contains('ProseMirror') ||
      element.getAttribute('data-slate-editor') === 'true' ||
      element.getAttribute('data-lexical-editor') === 'true' ||
      element.closest('.ProseMirror') !== null
    );
  }

  public getValue(element: HTMLElement): string {
    const editor = element.classList.contains('ProseMirror')
      ? element
      : (element.closest('.ProseMirror') as HTMLElement) || element;
    return editor.innerHTML || editor.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    const editor = element.classList.contains('ProseMirror')
      ? element
      : (element.closest('.ProseMirror') as HTMLElement) || element;
    if (value.includes('<') && value.includes('>')) {
      editor.innerHTML = DOMPurify.sanitize(value);
    } else {
      editor.textContent = value;
    }
  }

  public getName(element: HTMLElement): string {
    return element.id || element.getAttribute('name') || 'prosemirror_editor';
  }
}
