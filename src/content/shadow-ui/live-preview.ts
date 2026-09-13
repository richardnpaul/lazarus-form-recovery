import { findRichTextAdapter } from '../rich-text';

export class LivePreviewManager {
  private target: HTMLElement | null = null;
  private originalValue: string | null = null;
  private originalStyles: { bg: string; outline: string; offset: string } | null = null;

  public setTarget(target: HTMLElement | null) {
    this.revert();
    this.target = target;
  }

  public preview(value: string) {
    if (!this.target) return;

    if (this.originalValue === null) {
      this.stashOriginal();
    }

    this.applyValue(value);
    this.applyPreviewStyles();
  }

  public revert() {
    if (!this.target || this.originalValue === null) return;

    this.applyValue(this.originalValue);
    this.revertStyles();
    this.originalValue = null;
  }

  public commit(value: string) {
    if (!this.target) return;

    this.applyValue(value);
    this.revertStyles();
    this.originalValue = null;

    // Reactive dispatch: synthetic input & change events
    this.target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    this.target.dispatchEvent(new Event('change', { bubbles: true }));

    // Flash confirmation
    this.flashConfirmation();
  }

  private stashOriginal() {
    const target = this.target!;
    const adapter = findRichTextAdapter(target);
    if (adapter) {
      this.originalValue = adapter.getValue(target);
    } else if ('value' in target) {
      this.originalValue = (target as HTMLInputElement).value;
    } else {
      this.originalValue = target.textContent || '';
    }

    this.originalStyles = {
      bg: target.style.backgroundColor,
      outline: target.style.outline,
      offset: target.style.outlineOffset,
    };
  }

  private applyValue(val: string) {
    const target = this.target!;
    const adapter = findRichTextAdapter(target);
    if (adapter) {
      adapter.setValue(target, val);
    } else if ('value' in target) {
      (target as HTMLInputElement).value = val;
    } else {
      target.textContent = val;
    }
  }

  private applyPreviewStyles() {
    const target = this.target!;
    target.style.setProperty('background-color', 'var(--lz-preview-bg, #FFF9D2)', 'important');
    target.style.setProperty(
      'outline',
      '2px dashed var(--lz-preview-outline, #E5A500)',
      'important'
    );
    target.style.setProperty('outline-offset', '-1px', 'important');
  }

  private revertStyles() {
    if (!this.target || !this.originalStyles) return;
    this.target.style.backgroundColor = this.originalStyles.bg;
    this.target.style.outline = this.originalStyles.outline;
    this.target.style.outlineOffset = this.originalStyles.offset;
    this.originalStyles = null;
  }

  private flashConfirmation() {
    const target = this.target!;
    const prevBg = target.style.backgroundColor;
    target.style.backgroundColor = 'hsla(142, 71%, 45%, 0.2)';
    setTimeout(() => {
      target.style.backgroundColor = prevBg;
    }, 150);
  }
}
