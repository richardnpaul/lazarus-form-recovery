/**
 * Safe CSS identifier escaping that works in both browser and JSDOM environments.
 */
export function escapeCss(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }
  return ident.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * Computes a deterministic or readable selector for an element.
 */
export function getElementSelector(element: Element): string {
  if (element.id) {
    return `#${escapeCss(element.id)}`;
  }
  const name = element.getAttribute('name');
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  }
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;

  const children = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
  if (children.length > 1) {
    const index = children.indexOf(element) + 1;
    return `${tag}:nth-of-type(${index})`;
  }
  return tag;
}

export interface Position {
  x: number;
  y: number;
  placement: 'internal' | 'external';
}

/**
 * Computes optimal floating button position near an editable element.
 * Internal placement (default): 6px inside top-right corner.
 * External placement (for short inputs < 28px): 4px outside right border.
 */
export function computeButtonPosition(
  target: HTMLElement,
  btnWidth = 24,
  btnHeight = 24
): Position {
  const rect = target.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  const left = rect.left + scrollX;
  const top = rect.top + scrollY;

  let btnX: number;
  let btnY: number;
  let placement: 'internal' | 'external';

  if (rect.height < 28 || rect.width < 100) {
    // External placement
    btnX = left + rect.width + 4;
    btnY = top + (rect.height - btnHeight) / 2;
    placement = 'external';
  } else {
    // Internal placement inside top-right corner
    btnX = left + rect.width - btnWidth - 6;
    btnY = top + (rect.height - btnHeight) / 2;
    placement = 'internal';
  }

  // Viewport clamping
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const maxX = scrollX + viewportWidth - btnWidth - 8;
  if (btnX > maxX) {
    btnX = maxX;
  }
  if (btnX < scrollX + 4) {
    btnX = scrollX + 4;
  }
  if (btnY < scrollY + 4) {
    btnY = scrollY + 4;
  }

  return { x: Math.round(btnX), y: Math.round(btnY), placement };
}

/**
 * Traverses DOM and open Shadow DOM roots to find all matching elements.
 */
export function queryAllDeep(root: ParentNode, selector: string): HTMLElement[] {
  const results: HTMLElement[] = [];
  try {
    const matched = root.querySelectorAll(selector);
    matched.forEach((el) => {
      if (el instanceof HTMLElement) results.push(el);
    });
  } catch {}

  try {
    const all = root.querySelectorAll('*');
    all.forEach((el) => {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) {
        results.push(...queryAllDeep(shadow, selector));
      }
    });
  } catch {}

  return results;
}

/**
 * Safely parses an HTML string and populates an element's children using DOMParser and replaceChildren.
 * Completely avoids unsafe assignment to innerHTML to comply with Mozilla AMO and web-ext linter policies.
 */
export function safeSetHtml(element: Element, html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  element.replaceChildren(...Array.from(doc.body.childNodes));
}
