import { safeSetHtml } from '../../common/utils/dom';
import { RichTextAdapter } from './adapter';

export class ProseMirrorAdapter implements RichTextAdapter {
  public readonly name = 'prose-mirror';

  public matches(element: HTMLElement): boolean {
    return (
      element.closest('.ProseMirror') !== null ||
      element.getAttribute('data-slate-editor') === 'true' ||
      element.getAttribute('data-lexical-editor') === 'true'
    );
  }

  public getValue(element: HTMLElement): string {
    const editor = (element.closest('.ProseMirror') as HTMLElement) || element;
    return editor.innerHTML || editor.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    const editor = (element.closest('.ProseMirror') as HTMLElement) || element;
    safeSetHtml(editor, value);
  }

  public getName(element: HTMLElement): string {
    return element.id || element.getAttribute('name') || 'prosemirror_editor';
  }
}
