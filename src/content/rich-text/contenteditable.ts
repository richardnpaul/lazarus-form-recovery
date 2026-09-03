import { RichTextAdapter } from './adapter';

export class ContentEditableAdapter implements RichTextAdapter {
  public readonly name = 'contenteditable';

  public matches(element: HTMLElement): boolean {
    const ce = element.contentEditable;
    return (
      ce === 'true' ||
      ce === '' ||
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === ''
    );
  }

  public getValue(element: HTMLElement): string {
    return element.innerHTML || element.textContent || '';
  }

  public setValue(element: HTMLElement, value: string): void {
    if (value.includes('<') && value.includes('>')) {
      element.innerHTML = value;
    } else {
      element.textContent = value;
    }
  }

  public getName(element: HTMLElement): string {
    return (
      element.getAttribute('name') ||
      element.id ||
      element.getAttribute('aria-label') ||
      'contenteditable_field'
    );
  }
}
