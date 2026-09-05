import { describe, it, expect, beforeEach } from 'vitest';
import { FieldExtractor } from '../../src/content/field-extractor';
import { isValidLuhn, scrubSensitiveData } from '../../src/common/utils/pii';

describe('FieldExtractor & PII Security Unit Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Luhn Algorithm & PII Scrubbing', () => {
    it('should validate valid credit card numbers with Luhn check', () => {
      expect(isValidLuhn('4532015112830366')).toBe(true);
      expect(isValidLuhn('5425233430109903')).toBe(true);
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
    it('handles isTrackable edge cases strictly', () => {
      expect(FieldExtractor.isTrackable(null as any)).toBe(false);
      expect(FieldExtractor.isTrackable(undefined as any)).toBe(false);
      expect(FieldExtractor.isTrackable({} as any)).toBe(false); // not HTMLElement
      expect(FieldExtractor.isTrackable(document.createElement('div'))).toBe(false);
    });

    it('should extract text, textarea, and select fields strictly', () => {
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

      // Select without value
      const selectEmpty = document.createElement('select');
      selectEmpty.name = 'empty_role';
      const optionEmpty = document.createElement('option');
      optionEmpty.selected = true;
      selectEmpty.appendChild(optionEmpty); // value is ''

      form.appendChild(input);
      form.appendChild(textarea);
      form.appendChild(select);
      form.appendChild(selectEmpty);
      document.body.appendChild(form);

      const snapshot = FieldExtractor.buildFormSnapshot(input);
      expect(snapshot.formInstanceId).toBe('registration-form');
      expect(snapshot.fields.length).toBe(3); // empty_role value is empty, so it's filtered!

      const uField = snapshot.fields.find((f) => f.name === 'username');
      expect(uField?.value).toBe('phoenix_user');
      expect(uField?.type).toBe('text');

      const bField = snapshot.fields.find((f) => f.name === 'bio');
      expect(bField?.value).toBe('Software engineer & extension builder');
      expect(bField?.type).toBe('textarea');

      const rField = snapshot.fields.find((f) => f.name === 'role');
      expect(rField?.value).toBe('dev');
      expect(rField?.type).toBe('select');
    });

    it('should extract checkbox and radio buttons state strictly (including fallbacks)', () => {
      const form = document.createElement('form');
      form.id = 'survey-form';

      const cb = document.createElement('input');
      // Mix case to test .toLowerCase()
      cb.type = 'CHECKBOX';
      cb.name = 'subscribe';
      cb.value = 'newsletter';
      cb.checked = true;

      const cbFallback = document.createElement('input');
      cbFallback.type = 'checkbox';
      cbFallback.name = 'subscribe_fallback';
      cbFallback.checked = true; // no value, should fallback to 'on'

      const cbUnchecked = document.createElement('input');
      cbUnchecked.type = 'checkbox';
      cbUnchecked.name = 'subscribe_no';
      cbUnchecked.checked = false;

      const radio1 = document.createElement('input');
      radio1.type = 'RADIO';
      radio1.name = 'plan';
      radio1.value = 'pro';
      radio1.checked = true;

      const radioFallback = document.createElement('input');
      radioFallback.type = 'radio';
      radioFallback.name = 'plan_fallback';
      radioFallback.checked = true; // no value, should fallback to 'on'

      const radioUnchecked = document.createElement('input');
      radioUnchecked.type = 'radio';
      radioUnchecked.name = 'plan_no';
      radioUnchecked.checked = false;

      form.appendChild(cb);
      form.appendChild(cbFallback);
      form.appendChild(cbUnchecked);
      form.appendChild(radio1);
      form.appendChild(radioFallback);
      form.appendChild(radioUnchecked);
      document.body.appendChild(form);

      // Check extractField manually for unchecked ones (since buildFormSnapshot filters empty radio values)
      const exUncheckedCb = FieldExtractor.extractField(cbUnchecked);
      expect(exUncheckedCb?.value).toBe('');

      const exUncheckedRadio = FieldExtractor.extractField(radioUnchecked);
      expect(exUncheckedRadio?.value).toBe('');

      const snapshot = FieldExtractor.buildFormSnapshot(cb);
      // Wait, unchecked checkboxes ARE included with empty value! 'subscribe_no' is included
      // But unchecked radios have empty value and ARE filtered!
      const subscribeField = snapshot.fields.find((f) => f.name === 'subscribe');
      expect(subscribeField?.value).toBe('newsletter');

      const fallbackCbField = snapshot.fields.find((f) => f.name === 'subscribe_fallback');
      expect(fallbackCbField?.value).toBe('on');

      const uncheckedCbField = snapshot.fields.find((f) => f.name === 'subscribe_no');
      expect(uncheckedCbField?.value).toBe(''); // checkbox is kept even if empty

      const planField = snapshot.fields.find((f) => f.name === 'plan');
      expect(planField?.value).toBe('pro');

      const fallbackRadioField = snapshot.fields.find((f) => f.name === 'plan_fallback');
      expect(fallbackRadioField?.value).toBe('on');

      const uncheckedRadioField = snapshot.fields.find((f) => f.name === 'plan_no');
      expect(uncheckedRadioField).toBeUndefined(); // filtered!
    });

    it('should ignore password fields by default strictly', () => {
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
      expect(allowedField?.type).toBe('password');
    });

    it('should extract rich text from Quill editor containers strictly', () => {
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
      expect(snapshot.fields[0].type).toBe('quill');
      expect(snapshot.fields[0].name).toBe('quill-box');
    });

    it('should synthesize virtual forms for orphaned inputs strictly', () => {
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

    it('should handle multi-select and ignore non-trackable button input types strictly', () => {
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
      const o3 = document.createElement('option');
      o3.value = 'go';
      o3.selected = false; // Not selected
      select.appendChild(o1);
      select.appendChild(o2);
      select.appendChild(o3);
      document.body.appendChild(select);

      const field = FieldExtractor.extractField(select);
      expect(field?.value).toBe('ts,rust'); // 'go' should not be present
    });

    it('should generate action-aware form identifiers when id/name are absent strictly', () => {
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

    it('should generate non-colliding index-aware names for unnamed inputs strictly', () => {
      const container = document.createElement('section'); // Use section
      container.className = 'form-container';

      const in1 = document.createElement('input');
      in1.type = 'text';
      in1.value = 'First Part';
      // no name, no id, no placeholder

      const in2 = document.createElement('textarea'); // different tag
      in2.value = 'Second Part';

      const in3 = document.createElement('input'); // outside container completely
      in3.value = 'Third Part';
      in3.id = 'orphan_in3';

      container.appendChild(in1);
      container.appendChild(in2);
      document.body.appendChild(container);
      document.body.appendChild(in3);

      const fields = FieldExtractor.extractAllFields(container);
      expect(fields.length).toBe(2);
      expect(fields[0].name).toBe('text_1'); // 1-indexed
      expect(fields[1].name).toBe('textarea_2'); // 1-indexed
      expect(fields[0].value).toBe('First Part');
      expect(fields[1].value).toBe('Second Part');

      // Fallback name if container logic fails entirely (e.g. no parent)
      const orphanInput = document.createElement('input');
      orphanInput.type = 'text';
      orphanInput.value = 'Orphan';
      // NOT APPENDED TO DOM
      const orphanSnapshot = FieldExtractor.extractField(orphanInput);
      expect(orphanSnapshot?.name).toBe('input'); // getElementSelector fallback
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

    it('forces target inclusion in buildFormSnapshot even if missing from container', () => {
      // Sometimes the target element is detached or tricky
      const form = document.createElement('form');
      document.body.appendChild(form);

      const detachedInput = document.createElement('input');
      detachedInput.name = 'detached';
      detachedInput.value = 'still here';

      // Target is not in form, but we pass it anyway
      // Actually buildFormSnapshot uses closest('form'), so if it's detached it won't find form
      // Let's mock extractAllFields to return empty
      const spy = vi.spyOn(FieldExtractor, 'extractAllFields').mockReturnValue([]);

      const container = document.createElement('div');
      container.id = 'loose-container';
      document.body.appendChild(container);
      container.appendChild(detachedInput);

      const snapshot = FieldExtractor.buildFormSnapshot(detachedInput);
      expect(snapshot.fields.length).toBe(1);
      expect(snapshot.fields[0].name).toBe('detached');

      spy.mockRestore();
    });
  });
});
