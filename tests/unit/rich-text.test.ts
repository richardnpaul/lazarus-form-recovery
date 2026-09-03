import { describe, it, expect } from 'vitest';
import { ProseMirrorAdapter } from '../../src/content/rich-text/prose-mirror';
import { TinyMceAdapter } from '../../src/content/rich-text/tinymce-adapter';
import { ContentEditableAdapter } from '../../src/content/rich-text/contenteditable';
import { QuillAdapter } from '../../src/content/rich-text/quill-adapter';
import { findRichTextAdapter } from '../../src/content/rich-text';

describe('Rich Text Adapters (src/content/rich-text/)', () => {
  describe('ProseMirrorAdapter', () => {
    const adapter = new ProseMirrorAdapter();

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

    it('matches contenteditable elements', () => {
      const el1 = document.createElement('div');
      el1.contentEditable = 'true';
      expect(adapter.matches(el1)).toBe(true);

      const el2 = document.createElement('div');
      el2.setAttribute('contenteditable', '');
      expect(adapter.matches(el2)).toBe(true);

      const normal = document.createElement('div');
      expect(adapter.matches(normal)).toBe(false);
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

      const standalone = document.createElement('div');
      adapter.setValue(standalone, 'text');
      expect(adapter.getValue(standalone)).toBe('text');
    });

    it('gets name from container or element', () => {
      const container = document.createElement('div');
      container.className = 'ql-container';
      container.id = 'quill-box';
      const child = document.createElement('div');
      container.appendChild(child);
      expect(adapter.getName(child)).toBe('quill-box');

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
