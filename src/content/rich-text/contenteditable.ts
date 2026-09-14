import { safeSetHtml } from '../../common/utils/dom';
import { RichTextAdapter } from './adapter';

export class ContentEditableAdapter implements RichTextAdapter {
  public readonly name = 'contenteditable';

  public matches(element: HTMLElement): boolean {
    if (!element || typeof element.getAttribute !== 'function') return false;
    return (
      element.isContentEditable === true ||
      element.closest('[contenteditable="true"], [contenteditable=""]') !== null
    );
  }

  private getRootElement(element: HTMLElement): HTMLElement {
    return (
      (element.closest(
        '[contenteditable="true"], [contenteditable=""], [role="textbox"]'
      ) as HTMLElement) || element
    );
  }

  public getValue(element: HTMLElement): string {
    const root = this.getRootElement(element);
    return root.innerHTML || root.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    const root = this.getRootElement(element);
    safeSetHtml(root, value);
  }

  public getName(element: HTMLElement): string {
    const root = this.getRootElement(element);
    return (
      root.getAttribute('name') ||
      root.id ||
      root.getAttribute('aria-label') ||
      'contenteditable_field'
    );
  }
}
