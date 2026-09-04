import { describe, it, expect, beforeEach } from 'vitest';
import { FieldExtractor } from '../../src/content/field-extractor';
import { isValidLuhn, scrubSensitiveData } from '../../src/common/utils/pii';

describe('FieldExtractor & PII Security Unit Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  describe('Luhn Algorithm & PII Scrubbing', () => {
    it('should validate valid credit card numbers with Luhn check', () => {
      // Visa test card
      expect(isValidLuhn('4532015112830366')).toBe(true);
      // Mastercard test card
      expect(isValidLuhn('5425233430109903')).toBe(true);
      // Invalid numbers
      expect(isValidLuhn('4532015112830367')).toBe(false);
      expect(isValidLuhn('12345')).toBe(false);
    });

    it('should scrub credit card numbers from form text when filtering is enabled', () => {
      const rawText = 'Please charge card 4532-0151-1283-0366 for order #1234.';
      const scrubbed = scrubSensitiveData(rawText, 'billing_notes');
      expect(scrubbed).toContain('[REDACTED CREDIT CARD]');
      expect(scrubbed).not.toContain('4532');
    });

    it('should redact CVV and security codes when field name matches', () => {
      const cvvValue = '789';
      const scrubbed = scrubSensitiveData(cvvValue, 'cvv');
      expect(scrubbed).toBe('[REDACTED CVV]');
    });
  });

  describe('Field Extraction Across Form Controls', () => {
    it('should extract text, textarea, and select fields', () => {
      const form = document.createElement('form');
      form.id = 'registration-form';

      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'username';
      input.value = 'phoenix_user';

      const textarea = document.createElement('textarea');
      textarea.name = 'bio';
      textarea.value = 'Software engineer & extension builder';

      const select = document.createElement('select');
      select.name = 'role';
      const option1 = document.createElement('option');
      option1.value = 'dev';
      option1.selected = true;
      select.appendChild(option1);

      form.appendChild(input);
      form.appendChild(textarea);
      form.appendChild(select);
      document.body.appendChild(form);

      const snapshot = FieldExtractor.buildFormSnapshot(input);
      expect(snapshot.formInstanceId).toBe('registration-form');
      expect(snapshot.fields.length).toBe(3);

      const uField = snapshot.fields.find((f) => f.name === 'username');
      expect(uField?.value).toBe('phoenix_user');

      const bField = snapshot.fields.find((f) => f.name === 'bio');
      expect(bField?.value).toBe('Software engineer & extension builder');

      const rField = snapshot.fields.find((f) => f.name === 'role');
      expect(rField?.value).toBe('dev');
    });

    it('should extract checkbox and radio buttons state', () => {
      const form = document.createElement('form');
      form.id = 'survey-form';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'subscribe';
      cb.value = 'newsletter';
      cb.checked = true;

      const radio1 = document.createElement('input');
      radio1.type = 'radio';
      radio1.name = 'plan';
      radio1.value = 'pro';
      radio1.checked = true;

      form.appendChild(cb);
      form.appendChild(radio1);
      document.body.appendChild(form);

      const snapshot = FieldExtractor.buildFormSnapshot(cb);
      expect(snapshot.fields.find((f) => f.name === 'subscribe')?.value).toBe('newsletter');
      expect(snapshot.fields.find((f) => f.name === 'plan')?.value).toBe('pro');
    });

    it('should ignore password fields by default', () => {
      const pwd = document.createElement('input');
      pwd.type = 'password';
      pwd.name = 'secret';
      pwd.value = 'SuperSecret123!';
      document.body.appendChild(pwd);

      const field = FieldExtractor.extractField(pwd, { savePasswords: false });
      expect(field).toBeNull();

      const allowedField = FieldExtractor.extractField(pwd, { savePasswords: true });
      expect(allowedField).not.toBeNull();
      expect(allowedField?.value).toBe('SuperSecret123!');
    });

    it('should extract rich text from Quill editor containers', () => {
      const container = document.createElement('div');
      container.className = 'ql-container';
      container.id = 'quill-box';

      const editor = document.createElement('div');
      editor.className = 'ql-editor';
      editor.innerHTML = '<p>Formatted <strong>bold</strong> text</p>';
      container.appendChild(editor);
      document.body.appendChild(container);

      const snapshot = FieldExtractor.buildFormSnapshot(editor);
      expect(snapshot.fields.length).toBe(1);
      expect(snapshot.fields[0].value).toContain('<strong>bold</strong>');
    });

    it('should synthesize virtual forms for orphaned inputs ("Fake Forms")', () => {
      const orphan = document.createElement('input');
      orphan.type = 'text';
      orphan.name = 'search_query';
      orphan.value = 'modern web extension';
      document.body.appendChild(orphan);

      const snapshot = FieldExtractor.buildFormSnapshot(orphan);
      expect(snapshot.formInstanceId).toContain('fake_form');
      expect(snapshot.fields.length).toBe(1);
      expect(snapshot.fields[0].name).toBe('search_query');
      expect(snapshot.fields[0].value).toBe('modern web extension');
    });

    it('should handle multi-select and ignore non-trackable button input types', () => {
      // Button types
      ['hidden', 'submit', 'button', 'reset', 'image'].forEach((t) => {
        const btn = document.createElement('input');
        btn.type = t;
        expect(FieldExtractor.isTrackable(btn)).toBe(false);
      });

      // Multi-select
      const select = document.createElement('select');
      select.multiple = true;
      select.name = 'skills';
      const o1 = document.createElement('option');
      o1.value = 'ts';
      o1.selected = true;
      const o2 = document.createElement('option');
      o2.value = 'rust';
      o2.selected = true;
      select.appendChild(o1);
      select.appendChild(o2);
      document.body.appendChild(select);

      const field = FieldExtractor.extractField(select);
      expect(field?.value).toBe('ts,rust');
    });

    it('should generate action-aware form identifiers when id/name are absent', () => {
      const form = document.createElement('form');
      form.setAttribute('action', '/search?q=test');
      const textarea = document.createElement('textarea');
      textarea.name = 'q';
      textarea.value = 'google query';
      form.appendChild(textarea);
      document.body.appendChild(form);

      const snapshot = FieldExtractor.buildFormSnapshot(textarea);
      expect(snapshot.formInstanceId).toBe('form_search');
      expect(snapshot.fields.length).toBe(1);
      expect(snapshot.fields[0].value).toBe('google query');
    });

    it('should generate non-colliding index-aware names for unnamed inputs in containers', () => {
      const container = document.createElement('div');
      container.className = 'form-container';

      const wrap1 = document.createElement('div');
      const in1 = document.createElement('input');
      in1.type = 'text';
      in1.value = 'First Part';
      wrap1.appendChild(in1);

      const wrap2 = document.createElement('div');
      const in2 = document.createElement('input');
      in2.type = 'text';
      in2.value = 'Second Part';
      wrap2.appendChild(in2);

      container.appendChild(wrap1);
      container.appendChild(wrap2);
      document.body.appendChild(container);

      const fields = FieldExtractor.extractAllFields(container);
      expect(fields.length).toBe(2);
      expect(fields[0].name).not.toBe(fields[1].name);
      expect(fields[0].value).toBe('First Part');
      expect(fields[1].value).toBe('Second Part');
    });

    it('should resolve nested child elements inside contenteditable to the root content', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.id = 'rich-editor';
      const p = document.createElement('p');
      p.innerHTML = 'Hello from <span>inner rich text</span>';
      editor.appendChild(p);
      document.body.appendChild(editor);

      // Typing event target is the inner span
      const span = p.querySelector('span') as HTMLElement;
      const snapshot = FieldExtractor.buildFormSnapshot(span);
      expect(snapshot.fields.length).toBe(1);
      expect(snapshot.fields[0].name).toBe('rich-editor');
      expect(snapshot.fields[0].value).toContain('inner rich text');
    });
  });
});
