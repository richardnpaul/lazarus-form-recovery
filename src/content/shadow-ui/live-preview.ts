import { findRichTextAdapter } from '../rich-text';

export class LivePreviewManager {
  private target: HTMLElement | null = null;
  private originalValue: string | null = null;
  private originalBackground = '';
  private originalOutline = '';
  private originalOutlineOffset = '';

  public setTarget(target: HTMLElement | null) {
    if (this.target && this.originalValue !== null) {
      this.revert();
    }
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
    if (!this.target) return;

    const adapter = findRichTextAdapter(this.target);
    if (adapter) {
      this.originalValue = adapter.getValue(this.target);
    } else if ('value' in this.target) {
      this.originalValue = (this.target as HTMLInputElement).value;
    } else {
      this.originalValue = this.target.textContent || '';
    }

    this.originalBackground = this.target.style.backgroundColor;
    this.originalOutline = this.target.style.outline;
    this.originalOutlineOffset = this.target.style.outlineOffset;
  }

  private applyValue(val: string) {
    if (!this.target) return;

    const adapter = findRichTextAdapter(this.target);
    if (adapter) {
      adapter.setValue(this.target, val);
    } else if ('value' in this.target) {
      (this.target as HTMLInputElement).value = val;
    } else {
      this.target.textContent = val;
    }
  }

  private applyPreviewStyles() {
    if (!this.target) return;
    this.target.style.setProperty('background-color', 'var(--lz-preview-bg, #FFF9D2)', 'important');
    this.target.style.setProperty(
      'outline',
      '2px dashed var(--lz-preview-outline, #E5A500)',
      'important'
    );
    this.target.style.setProperty('outline-offset', '-1px', 'important');
  }

  private revertStyles() {
    if (!this.target) return;
    this.target.style.backgroundColor = this.originalBackground;
    this.target.style.outline = this.originalOutline;
    this.target.style.outlineOffset = this.originalOutlineOffset;
  }

  private flashConfirmation() {
    if (!this.target) return;
    const prevBg = this.target.style.backgroundColor;
    this.target.style.backgroundColor = 'hsla(142, 71%, 45%, 0.2)';
    setTimeout(() => {
      if (this.target) {
        this.target.style.backgroundColor = prevBg;
      }
    }, 150);
  }
}
