import { describe, it, expect, vi } from 'vitest';
import { escapeHtml, escapeAttr, computeButtonPosition } from '../../src/common/utils/dom';

describe('DOM Utilities', () => {
  describe('Sanitization Helpers', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss & fun")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss &amp; fun&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml(null as any)).toBe('');
      expect(escapeHtml(undefined as any)).toBe('');
      expect(escapeHtml(123 as any)).toBe('123');
    });

    it('escapes attribute special characters', () => {
      expect(escapeAttr('value with "quotes"')).toBe('value with &quot;quotes&quot;');
      expect(escapeAttr(null as any)).toBe('');
      expect(escapeAttr(undefined as any)).toBe('');
      expect(escapeAttr(123 as any)).toBe('123');
    });
  });

  describe('computeButtonPosition RTL', () => {
    function createMockTarget(options: any = {}) {
      const el = document.createElement('input');
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        left: options.left || 0,
        top: options.top || 0,
        width: options.width || 0,
        height: options.height || 0,
        right: (options.left || 0) + (options.width || 0),
        bottom: (options.top || 0) + (options.height || 0),
        x: options.left || 0,
        y: options.top || 0,
        toJSON: () => {},
      });
      if (options.dir) el.dir = options.dir;
      return el;
    }

    it('computes internal RTL placement', () => {
      const target = createMockTarget({ left: 200, top: 100, width: 300, height: 40, dir: 'rtl' });
      const pos = computeButtonPosition(target);
      expect(pos).toEqual({ x: 206, y: 108, placement: 'internal' });
    });

    it('computes external RTL placement for small inputs', () => {
      const target = createMockTarget({ left: 200, top: 100, width: 80, height: 20, dir: 'rtl' });
      const pos = computeButtonPosition(target);
      expect(pos).toEqual({ x: 172, y: 98, placement: 'external' });
    });

    it('clamps to viewport in RTL', () => {
      const target = createMockTarget({ left: 10, width: 80, height: 20, dir: 'rtl' });
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(4); // max(10 - 24 - 4 = -18, viewportLeft + 4 = 4)
    });

    it('detects RTL from computed style', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.placement).toBe('internal');
      expect(pos.x).toBe(206);
    });

    it('detects RTL from ancestor', () => {
      const parent = document.createElement('div');
      parent.dir = 'rtl';
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      parent.appendChild(target);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(206);
    });

    it('detects RTL from shadow host', () => {
      const host = document.createElement('div');
      host.dir = 'rtl';
      const shadow = host.attachShadow({ mode: 'open' });
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      shadow.appendChild(target);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(206);
    });

    it('detects RTL from document element', () => {
      document.documentElement.setAttribute('dir', 'rtl');
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(206);
      document.documentElement.removeAttribute('dir');
    });

    it('detects RTL from document body', () => {
      document.body.setAttribute('dir', 'rtl');
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(206);
      document.body.removeAttribute('dir');
    });

    it('handles target with null ownerDocument/defaultView and missing getRootNode', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      Object.defineProperty(target, 'ownerDocument', {
        value: { defaultView: null, documentElement: null, body: null },
        configurable: true,
      });
      (target as any).getRootNode = undefined;
      const pos = computeButtonPosition(target);
      expect(pos.placement).toBe('internal');
      expect(pos.x).toBe(470);
    });

    it('handles target with completely null ownerDocument', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      target.closest = () => null;
      Object.defineProperty(target, 'ownerDocument', {
        value: null,
        configurable: true,
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.placement).toBe('internal');
      expect(pos.x).toBe(470);
    });

    it('detects RTL directly from target.dir when computedStyle is ltr', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      target.dir = 'rtl';
      target.closest = () => null;
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(206);
    });

    it('handles target when target.closest is undefined', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      (target as any).closest = undefined;
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(470);
    });

    it('handles target when shadow host.closest is undefined', () => {
      const target = createMockTarget({ left: 200, width: 300, height: 40 });
      const mockHost = { closest: undefined } as any;
      (target as any).getRootNode = vi.fn().mockReturnValue({ host: mockHost });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as any);
      const pos = computeButtonPosition(target);
      expect(pos.x).toBe(470);
    });
  });
});
