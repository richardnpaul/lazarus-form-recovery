import shadowCss from './shadow-ui.css?inline';
import themeCss from '../../common/styles/theme.css?inline';
import { RecoveryButton } from './recovery-button';
import { RecoveryMenu } from './recovery-menu';
import { LivePreviewManager } from './live-preview';
import { RuntimeMessage, RuntimeResponse } from '../../common/types/messages';
import { findRichTextAdapter } from '../rich-text';
import { escapeCss } from '../../common/utils/dom';

export class LazarusRecoveryHost extends HTMLElement {
  private shadow: ShadowRoot;
  private button: RecoveryButton;
  private menu: RecoveryMenu;
  private previewManager: LivePreviewManager;
  private currentTarget: HTMLElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'closed' });
    this.previewManager = new LivePreviewManager();
    this.button = new RecoveryButton();
    this.menu = new RecoveryMenu(this.previewManager);

    this.initShadowDom();
  }

  private initShadowDom() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `${themeCss}\n${shadowCss}`;
    this.shadow.appendChild(styleEl);

    this.shadow.appendChild(this.button.getElement());
    this.shadow.appendChild(this.menu.getElement());

    this.button.onClick(async () => {
      if (this.menu.isOpen()) {
        this.menu.hide();
        this.button.setActive(false);
      } else if (this.currentTarget) {
        this.button.setActive(true);
        await this.openMenuForTarget(this.currentTarget);
      }
    });

    this.menu.onDismiss(() => {
      this.button.setActive(false);
    });

    this.menu.onRestoreEntireForm(async () => {
      if (this.currentTarget) {
        await this.restoreEntireForm(this.currentTarget);
      }
    });

    // Dismiss on clicking outside
    document.addEventListener('click', () => {
      if (this.menu.isOpen()) {
        this.menu.hide();
        this.button.setActive(false);
      }
    });
  }

  public positionNear(element: HTMLElement) {
    this.currentTarget = element;
    this.button.attachTo(element);
    if (this.menu.isOpen()) {
      this.menu.hide();
      this.button.setActive(false);
    }
  }

  private async openMenuForTarget(target: HTMLElement) {
    const adapter = findRichTextAdapter(target);
    const fieldName = adapter
      ? adapter.getName(target)
      : target.getAttribute('name') || target.id || '';
    const fieldType = adapter ? adapter.name : target.tagName.toLowerCase();

    const msg: RuntimeMessage = {
      type: 'GET_RECOVERABLE_TEXT',
      payload: {
        domain: window.location.hostname,
        fieldName,
        fieldType,
      },
    };

    let items: any[] = [];
    try {
      const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
      if (res?.success && Array.isArray(res.data)) {
        items = res.data;
      }
    } catch {
      items = [];
    }

    const btnEl = this.button.getElement();
    const btnLeft = parseInt(btnEl.style.left || '0', 10);
    const btnTop = parseInt(btnEl.style.top || '0', 10);

    this.menu.show(target, items, btnLeft, btnTop);
  }

  private async restoreEntireForm(target: HTMLElement) {
    const formElement = target.closest('form');
    const msg: RuntimeMessage = {
      type: 'GET_DOMAIN_HISTORY',
      payload: {
        domain: window.location.hostname,
        limit: 1,
      },
    };

    try {
      const res: RuntimeResponse = await chrome.runtime.sendMessage(msg);
      if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
        const latestForm = res.data[0];
        const fields = Array.isArray(latestForm.fields) ? latestForm.fields : [];

        if (formElement) {
          fields.forEach((f: any) => {
            const input = formElement.querySelector(
              `[name="${escapeCss(f.name)}"], #${escapeCss(f.name)}`
            ) as HTMLElement;
            if (input) {
              const adapter = findRichTextAdapter(input);
              if (adapter) {
                adapter.setValue(input, f.value);
              } else if ('value' in input) {
                (input as HTMLInputElement).value = f.value;
              }
              input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      }
    } catch (err) {
      console.error('Failed to restore entire form:', err);
    }
  }
}

if (!customElements.get('lazarus-recovery-host')) {
  customElements.define('lazarus-recovery-host', LazarusRecoveryHost);
}

export function attachRecoveryUI(target: HTMLElement): LazarusRecoveryHost {
  let host = document.querySelector('lazarus-recovery-host') as LazarusRecoveryHost;
  if (!host) {
    host = document.createElement('lazarus-recovery-host') as LazarusRecoveryHost;
    document.documentElement.appendChild(host);
  }
  host.positionNear(target);
  return host;
}
