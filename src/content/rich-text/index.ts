import { RichTextAdapter } from './adapter';
import { ContentEditableAdapter } from './contenteditable';
import { QuillAdapter } from './quill-adapter';
import { TinyMceAdapter } from './tinymce-adapter';
import { ProseMirrorAdapter } from './prose-mirror';

export * from './adapter';
export * from './contenteditable';
export * from './quill-adapter';
export * from './tinymce-adapter';
export * from './prose-mirror';

const adapters: RichTextAdapter[] = [
  new QuillAdapter(),
  new TinyMceAdapter(),
  new ProseMirrorAdapter(),
  new ContentEditableAdapter(), // Fallback for generic contenteditable
];

export function findRichTextAdapter(element: HTMLElement): RichTextAdapter | null {
  for (const adapter of adapters) {
    if (adapter.matches(element)) {
      return adapter;
    }
  }
  return null;
}
