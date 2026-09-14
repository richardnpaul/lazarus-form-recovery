import { describe, it, expect, vi } from 'vitest';
import { ProseMirrorAdapter } from '../../src/content/rich-text/prose-mirror';
import { TinyMceAdapter } from '../../src/content/rich-text/tinymce-adapter';
import { ContentEditableAdapter } from '../../src/content/rich-text/contenteditable';
import { QuillAdapter } from '../../src/content/rich-text/quill-adapter';
import { findRichTextAdapter } from '../../src/content/rich-text';

describe('Rich Text Adapters (src/content/rich-text/)', () => {
  describe('ProseMirrorAdapter', () => {
    const adapter = new ProseMirrorAdapter();

    it('has the correct adapter name', () => {
      expect(adapter.name).toBe('prose-mirror');
    });

    it('matches ProseMirror, Slate, Lexical elements and child elements', () => {
      const el1 = document.createElement('div');
      el1.className = 'ProseMirror';
      expect(adapter.matches(el1)).toBe(true);

      const el2 = document.createElement('div');
      el2.setAttribute('data-slate-editor', 'true');
      expect(adapter.matches(el2)).toBe(true);

      const el3 = document.createElement('div');
      el3.setAttribute('data-lexical-editor', 'true');
      expect(adapter.matches(el3)).toBe(true);

      const parent = document.createElement('div');
      parent.className = 'ProseMirror';
      const child = document.createElement('p');
      parent.appendChild(child);
      expect(adapter.matches(child)).toBe(true);

      const normal = document.createElement('div');
      expect(adapter.matches(normal)).toBe(false);
    });

    it('gets value from ProseMirror and fallback child elements', () => {
      const el = document.createElement('div');
      el.className = 'ProseMirror';
      el.innerHTML = '<p>Editor text</p>';
      expect(adapter.getValue(el)).toBe('<p>Editor text</p>');

      const child = document.createElement('span');
      el.appendChild(child);
      expect(adapter.getValue(child)).toBe(el.innerHTML);

      const plain = document.createElement('div');
      plain.textContent = 'Plain text';
      expect(adapter.getValue(plain)).toBe('Plain text');

      // Test when innerHTML is empty but textContent is present
      const textOnly = document.createElement('div');
      Object.defineProperty(textOnly, 'innerHTML', { value: '', configurable: true });
      textOnly.textContent = 'ProseMirror plain fallback';
      expect(adapter.getValue(textOnly)).toBe('ProseMirror plain fallback');

      // Test when both innerHTML and textContent are empty
      const emptyEl = document.createElement('div');
      Object.defineProperty(emptyEl, 'innerHTML', { value: '', configurable: true });
      Object.defineProperty(emptyEl, 'textContent', { value: '', configurable: true });
      expect(adapter.getValue(emptyEl)).toBe('');
    });

    it('sets value with HTML or plain text', () => {
      const el = document.createElement('div');
      el.className = 'ProseMirror';
      adapter.setValue(el, '<b>bold</b>');
      expect(el.innerHTML).toBe('<b>bold</b>');

      adapter.setValue(el, 'plain string');
      expect(el.textContent).toBe('plain string');

      // Test with child element
      const child = document.createElement('span');
      el.appendChild(child);
      adapter.setValue(child, '<i>italic</i>');
      expect(el.innerHTML).toBe('<i>italic</i>');

      // Test with element having data-slate-editor without .ProseMirror container
      const slateEl = document.createElement('div');
      slateEl.setAttribute('data-slate-editor', 'true');
      adapter.setValue(slateEl, 'slate content');
      expect(slateEl.textContent).toBe('slate content');
    });

    it('gets names with fallbacks', () => {
      const el1 = document.createElement('div');
      el1.id = 'editor-1';
      expect(adapter.getName(el1)).toBe('editor-1');

      const el2 = document.createElement('div');
      el2.setAttribute('name', 'article_body');
      expect(adapter.getName(el2)).toBe('article_body');

      const el3 = document.createElement('div');
      expect(adapter.getName(el3)).toBe('prosemirror_editor');
    });
  });

  describe('TinyMceAdapter', () => {
    const adapter = new TinyMceAdapter();

    it('has the correct adapter name', () => {
      expect(adapter.name).toBe('tinymce');
    });

    it('matches TinyMCE and CKEditor markers', () => {
      const el1 = document.createElement('div');
      el1.id = 'tinymce';
      expect(adapter.matches(el1)).toBe(true);

      const el2 = document.createElement('div');
      el2.className = 'mce-content-body';
      expect(adapter.matches(el2)).toBe(true);

      const el3 = document.createElement('div');
      el3.className = 'tox-edit-area';
      expect(adapter.matches(el3)).toBe(true);

      const parent = document.createElement('div');
      parent.className = 'ck-editor';
      const child = document.createElement('div');
      parent.appendChild(child);
      expect(adapter.matches(child)).toBe(true);

      const el4 = document.createElement('div');
      el4.className = 'ck-content';
      expect(adapter.matches(el4)).toBe(true);

      const normal = document.createElement('div');
      expect(adapter.matches(normal)).toBe(false);
    });

    it('gets and sets value', () => {
      const el = document.createElement('div');
      adapter.setValue(el, '<p>content</p>');
      expect(adapter.getValue(el)).toBe('<p>content</p>');

      const empty = document.createElement('div');
      expect(adapter.getValue(empty)).toBe('');
    });

    it('gets names with data-id, id, name, or fallback', () => {
      const el1 = document.createElement('div');
      el1.setAttribute('data-id', 'tiny-data-id');
      expect(adapter.getName(el1)).toBe('tiny-data-id');

      const el2 = document.createElement('div');
      el2.id = 'tiny-id';
      expect(adapter.getName(el2)).toBe('tiny-id');

      const el3 = document.createElement('div');
      el3.setAttribute('name', 'tiny-name');
      expect(adapter.getName(el3)).toBe('tiny-name');

      const el4 = document.createElement('div');
      expect(adapter.getName(el4)).toBe('tinymce_ckeditor_field');
    });
  });

  describe('ContentEditableAdapter', () => {
    const adapter = new ContentEditableAdapter();

    it('has the correct adapter name', () => {
      expect(adapter.name).toBe('contenteditable');
    });

    it('matches contenteditable elements across conditions', () => {
      // 1. isContentEditable is true when closest returns null
      const mockCe = document.createElement('div');
      Object.defineProperty(mockCe, 'isContentEditable', { value: true, configurable: true });
      mockCe.closest = vi.fn().mockReturnValue(null);
      expect(adapter.matches(mockCe)).toBe(true);

      // 2. isContentEditable is false but closest returns parent with contenteditable
      const parent = document.createElement('div');
      parent.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      Object.defineProperty(child, 'isContentEditable', { value: false, configurable: true });
      parent.appendChild(child);
      expect(adapter.matches(child)).toBe(true);

      // 3. contenteditable attribute with empty string
      const parentEmpty = document.createElement('div');
      parentEmpty.setAttribute('contenteditable', '');
      const childEmpty = document.createElement('span');
      Object.defineProperty(childEmpty, 'isContentEditable', { value: false, configurable: true });
      parentEmpty.appendChild(childEmpty);
      expect(adapter.matches(childEmpty)).toBe(true);

      // 4. Normal element (neither true)
      const normal = document.createElement('div');
      expect(adapter.matches(normal)).toBe(false);

      // 5. Edge cases: null, non-object, object without getAttribute
      expect(adapter.matches(null as any)).toBe(false);
      expect(adapter.matches({} as any)).toBe(false);
    });

    it('gets and sets values with HTML and text', () => {
      const el = document.createElement('div');
      adapter.setValue(el, '<b>Rich</b>');
      expect(adapter.getValue(el)).toBe('<b>Rich</b>');

      adapter.setValue(el, 'Plain text');
      expect(adapter.getValue(el)).toBe('Plain text');

      const empty = document.createElement('div');
      expect(adapter.getValue(empty)).toBe('');
    });

    it('gets names with name, id, aria-label, or fallback', () => {
      const el1 = document.createElement('div');
      el1.setAttribute('name', 'field-name');
      expect(adapter.getName(el1)).toBe('field-name');

      const el2 = document.createElement('div');
      el2.id = 'field-id';
      expect(adapter.getName(el2)).toBe('field-id');

      const el3 = document.createElement('div');
      el3.setAttribute('aria-label', 'Compose message');
      expect(adapter.getName(el3)).toBe('Compose message');

      const el4 = document.createElement('div');
      expect(adapter.getName(el4)).toBe('contenteditable_field');
    });
  });

  describe('QuillAdapter', () => {
    const adapter = new QuillAdapter();

    it('has the correct adapter name', () => {
      expect(adapter.name).toBe('quill');
    });

    it('matches Quill editor container or child', () => {
      const el1 = document.createElement('div');
      el1.className = 'ql-editor';
      expect(adapter.matches(el1)).toBe(true);

      const container = document.createElement('div');
      container.className = 'ql-container';
      const child = document.createElement('div');
      container.appendChild(child);
      expect(adapter.matches(child)).toBe(true);

      const normal = document.createElement('div');
      expect(adapter.matches(normal)).toBe(false);
    });

    it('gets and sets values on editor or querySelector', () => {
      const container = document.createElement('div');
      container.className = 'ql-container';
      const editor = document.createElement('div');
      editor.className = 'ql-editor';
      container.appendChild(editor);

      adapter.setValue(container, '<p>Quill Content</p>');
      expect(adapter.getValue(container)).toBe('<p>Quill Content</p>');

      // Call setValue directly on element with ql-editor class
      adapter.setValue(editor, '<p>Direct Editor Content</p>');
      expect(adapter.getValue(editor)).toBe('<p>Direct Editor Content</p>');

      // When element itself has class ql-editor and contains a nested ql-editor child
      const parentEditor = document.createElement('div');
      parentEditor.className = 'ql-editor';
      parentEditor.innerHTML = '<p>Parent</p><div class="ql-editor"><p>Child</p></div>';
      expect(adapter.getValue(parentEditor)).toBe(
        '<p>Parent</p><div class="ql-editor"><p>Child</p></div>'
      );

      adapter.setValue(parentEditor, '<p>Updated Parent</p>');
      expect(parentEditor.innerHTML).toBe('<p>Updated Parent</p>');

      const standalone = document.createElement('div');
      adapter.setValue(standalone, 'text');
      expect(adapter.getValue(standalone)).toBe('text');

      // Test when innerHTML is empty but textContent is present
      const textOnly = document.createElement('div');
      Object.defineProperty(textOnly, 'innerHTML', { value: '', configurable: true });
      textOnly.textContent = 'Quill plain fallback';
      expect(adapter.getValue(textOnly)).toBe('Quill plain fallback');

      // Test when both innerHTML and textContent are empty
      const emptyEl = document.createElement('div');
      Object.defineProperty(emptyEl, 'innerHTML', { value: '', configurable: true });
      Object.defineProperty(emptyEl, 'textContent', { value: '', configurable: true });
      expect(adapter.getValue(emptyEl)).toBe('');
    });

    it('gets name from container or element with id, name, or fallback', () => {
      const container = document.createElement('div');
      container.className = 'ql-container';
      container.id = 'quill-box';
      const child = document.createElement('div');
      container.appendChild(child);
      expect(adapter.getName(child)).toBe('quill-box');

      const elWithName = document.createElement('div');
      elWithName.setAttribute('name', 'custom-quill-field');
      expect(adapter.getName(elWithName)).toBe('custom-quill-field');

      const plain = document.createElement('div');
      expect(adapter.getName(plain)).toBe('quill_editor');
    });
  });

  describe('findRichTextAdapter', () => {
    it('finds appropriate adapter or returns null', () => {
      const quill = document.createElement('div');
      quill.className = 'ql-editor';
      expect(findRichTextAdapter(quill)?.name).toBe('quill');

      const normal = document.createElement('input');
      expect(findRichTextAdapter(normal)).toBeNull();
    });
  });
});
