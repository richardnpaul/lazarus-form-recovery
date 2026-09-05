import DOMPurify from 'dompurify';
import { computeButtonPosition } from '../../common/utils/dom';

export class RecoveryButton {
  private button: HTMLButtonElement;
  private currentTarget: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onScrollBound = this.updatePosition.bind(this);
  private onClickHandler: (() => void) | null = null;

  constructor() {
    this.button = document.createElement('button');
    this.button.className = 'lz-trigger-btn';
    this.button.setAttribute('aria-label', 'Lazarus Form Recovery');
    this.button.setAttribute('title', 'Recover form drafts (Lazarus)');
    this.button.innerHTML = DOMPurify.sanitize(`
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
    `);

    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onClickHandler) {
        this.onClickHandler();
      }
    });

    // Disconnect when disconnected
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.updatePosition();
      });
    }
  }

  public getElement(): HTMLButtonElement {
    return this.button;
  }

  public onClick(handler: () => void) {
    this.onClickHandler = handler;
  }

  public setActive(active: boolean) {
    if (active) {
      this.button.classList.add('is-active');
    } else {
      this.button.classList.remove('is-active');
    }
  }

  public attachTo(target: HTMLElement) {
    if (this.currentTarget && this.resizeObserver) {
      this.resizeObserver.unobserve(this.currentTarget);
    }

    this.currentTarget = target;
    if (this.resizeObserver && target) {
      this.resizeObserver.observe(target);
    }

    window.removeEventListener('scroll', this.onScrollBound, { capture: true });
    window.addEventListener('scroll', this.onScrollBound, { capture: true, passive: true });

    this.updatePosition();
    this.button.style.display = 'flex';
  }

  public hide() {
    this.button.style.display = 'none';
    if (this.currentTarget && this.resizeObserver) {
      this.resizeObserver.unobserve(this.currentTarget);
      this.currentTarget = null;
    }
    window.removeEventListener('scroll', this.onScrollBound, { capture: true });
  }

  public updatePosition() {
    if (!this.currentTarget || !this.currentTarget.isConnected) {
      this.hide();
      return;
    }

    const { x, y } = computeButtonPosition(this.currentTarget, 24, 24);
    this.button.style.left = `${x}px`;
    this.button.style.top = `${y}px`;
  }
}
