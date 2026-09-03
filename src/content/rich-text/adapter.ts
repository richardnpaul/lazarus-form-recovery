export interface RichTextAdapter {
  name: string;
  matches(element: HTMLElement): boolean;
  getValue(element: HTMLElement): string;
  setValue(element: HTMLElement, value: string): void;
  getName(element: HTMLElement): string;
}
