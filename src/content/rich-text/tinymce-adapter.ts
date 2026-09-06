import { safeSetHtml } from '../../common/utils/dom';
import { RichTextAdapter } from './adapter';

export class TinyMceAdapter implements RichTextAdapter {
  public readonly name = 'tinymce';

  public matches(element: HTMLElement): boolean {
    return (
      element.id === 'tinymce' ||
      element.classList.contains('mce-content-body') ||
      element.classList.contains('tox-edit-area') ||
      element.closest('.ck-editor') !== null ||
      element.classList.contains('ck-content')
    );
  }

  public getValue(element: HTMLElement): string {
    return element.innerHTML || element.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    safeSetHtml(element, value);
  }

  public getName(element: HTMLElement): string {
    return (
      element.getAttribute('data-id') ||
      element.id ||
      element.getAttribute('name') ||
      'tinymce_ckeditor_field'
    );
  }
}
