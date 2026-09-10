import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeSetHtml } from '../../src/common/utils/dom';
import { handleRuntimeMessage, getSenderDomain } from '../../src/background/message-router';
import { db } from '../../src/common/db/lazarus-db';
import { RuntimeMessage } from '../../src/common/types/messages';

describe('Security Hardening — safeSetHtml', () => {
  let target: HTMLElement;

  beforeEach(() => {
    target = document.createElement('div');
  });

  it('should strip onerror and other event handler attributes from img tags', () => {
    safeSetHtml(target, '<img src="https://example.com/pic.jpg" onerror="alert(1)">');
    const img = target.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/pic.jpg');
    expect(target.innerHTML).not.toContain('onerror');
  });

  it('should strip mixed-case and uppercase event handler attributes (ONERROR, OnLoad)', () => {
    safeSetHtml(target, '<img src="x" ONERROR="alert(1)"><body OnLoad="alert(2)">');
    expect(target.querySelector('[onerror], [ONERROR]')).toBeNull();
    expect(target.innerHTML).not.toContain('alert(1)');
    expect(target.innerHTML).not.toContain('alert(2)');
  });

  it('should strip multiple event handlers across multiple elements', () => {
    const payload = `
      <div onmouseover="alert('hover')">
        <span onclick="alert('click')">Click me</span>
        <input onfocus="alert('focus')" onblur="alert('blur')" value="text">
      </div>
    `;
    safeSetHtml(target, payload);
    expect(target.querySelectorAll('[onmouseover], [onclick], [onfocus], [onblur]').length).toBe(0);
    expect(target.innerHTML).not.toContain('alert');
  });

  it('should remove <script> tags completely, including inline and with src', () => {
    const payload = `
      <p>Before</p>
      <script>alert('pwned')</script>
      <script src="https://evil.com/payload.js"></script>
      <p>After</p>
    `;
    safeSetHtml(target, payload);
    expect(target.querySelectorAll('script').length).toBe(0);
    expect(target.innerHTML).not.toContain('alert');
    expect(target.innerHTML).not.toContain('evil.com');
    expect(target.textContent).toContain('Before');
    expect(target.textContent).toContain('After');
  });

  it('should remove dangerous tags (iframe, object, embed, base, meta, link, style, template, form)', () => {
    const payload = `
      <iframe src="https://evil.com"></iframe>
      <object data="https://evil.com/test.swf"></object>
      <embed src="https://evil.com/movie.mov">
      <base href="https://evil.com/">
      <meta http-equiv="refresh" content="0;url=https://evil.com">
      <link rel="stylesheet" href="https://evil.com/style.css">
      <style>body { background: red; }</style>
      <template><script>alert('template')</script></template>
      <form action="https://evil.com"><input name="user"></form>
      <p>Safe content</p>
    `;
    safeSetHtml(target, payload);
    expect(
      target.querySelectorAll('iframe, object, embed, base, meta, link, style, template, form')
        .length
    ).toBe(0);
    expect(target.textContent).toContain('Safe content');
  });

  it('should remove dangerous SVG elements and execution vectors (foreignObject, use, animate, set)', () => {
    const payload = `
      <svg>
        <foreignObject><script>alert('svg-script')</script></foreignObject>
        <use href="https://evil.com/icon.svg#x"></use>
        <animate attributeName="href" values="javascript:alert(1)"></animate>
        <set attributeName="href" to="javascript:alert(2)"></set>
        <circle cx="50" cy="50" r="40" fill="red" />
      </svg>
    `;
    safeSetHtml(target, payload);
    expect(target.querySelectorAll('foreignObject, use, animate, set, script').length).toBe(0);
    expect(target.innerHTML).not.toContain('alert');
    expect(target.querySelector('circle')).not.toBeNull();
  });

  it('should strip javascript: and vbscript: URIs from href attributes', () => {
    const payload = `
      <a href="javascript:alert(1)">Click 1</a>
      <a href="  javascript:alert(2)">Click 2</a>
      <a href="jav&#x0A;ascript:alert(3)">Click 3</a>
      <a href="vbscript:msgbox(1)">Click 4</a>
      <a href="https://example.com/safe">Safe Link</a>
    `;
    safeSetHtml(target, payload);
    const links = target.querySelectorAll('a');
    expect(links.length).toBe(5);
    expect(links[0].getAttribute('href')).toBeNull();
    expect(links[1].getAttribute('href')).toBeNull();
    expect(links[2].getAttribute('href')).toBeNull();
    expect(links[3].getAttribute('href')).toBeNull();
    expect(links[4].getAttribute('href')).toBe('https://example.com/safe');
  });

  it('should strip data: URLs from href attributes', () => {
    safeSetHtml(target, '<a href="data:text/html,<script>alert(1)</script>">Dangerous</a>');
    const link = target.querySelector('a');
    expect(link?.getAttribute('href')).toBeNull();
  });

  it('should strip SVG data: URLs from img src, but allow raster image data: URLs', () => {
    const payload = `
      <img id="svg-img" src="data:image/svg+xml;utf8,<svg onload=alert(1)>">
      <img id="html-img" src="data:text/html,<script>alert(1)</script>">
      <img id="png-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">
    `;
    safeSetHtml(target, payload);
    expect(target.querySelector('#svg-img')?.getAttribute('src')).toBeNull();
    expect(target.querySelector('#html-img')?.getAttribute('src')).toBeNull();
    expect(target.querySelector('#png-img')?.getAttribute('src')).toContain(
      'data:image/png;base64,'
    );
  });

  it('should strip malicious expressions and javascript: from style attributes', () => {
    const payload = `
      <div id="d1" style="background: url(javascript:alert(1))">Test 1</div>
      <div id="d2" style="width: expression(alert(1))">Test 2</div>
      <div id="d3" style="color: red; font-size: 14px;">Test 3</div>
    `;
    safeSetHtml(target, payload);
    expect(target.querySelector('#d1')?.getAttribute('style')).toBeNull();
    expect(target.querySelector('#d2')?.getAttribute('style')).toBeNull();
    expect(target.querySelector('#d3')?.getAttribute('style')).toContain('color: red');
  });

  it('should preserve standard rich-text formatting tags and attributes', () => {
    const richText = `
      <h3>Project Status</h3>
      <p>Here is <strong>bold</strong>, <em>italic</em>, <u>underlined</u>, and <code>inline code</code>.</p>
      <ul>
        <li>Item 1</li>
        <li>Item 2 with <a href="https://example.com" target="_blank">link</a></li>
      </ul>
      <blockquote>Quoted insight</blockquote>
      <pre><code>const x = 42;</code></pre>
    `;
    safeSetHtml(target, richText);
    expect(target.querySelector('h3')?.textContent).toBe('Project Status');
    expect(target.querySelector('strong')?.textContent).toBe('bold');
    expect(target.querySelector('em')?.textContent).toBe('italic');
    expect(target.querySelector('u')?.textContent).toBe('underlined');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(target.querySelectorAll('li').length).toBe(2);
    expect(target.querySelector('blockquote')?.textContent).toBe('Quoted insight');
  });

  it('should safely handle empty, non-string, or null inputs without crashing', () => {
    safeSetHtml(target, '');
    expect(target.childNodes.length).toBe(0);

    safeSetHtml(target, null as any);
    expect(target.childNodes.length).toBe(0);

    safeSetHtml(null as any, '<p>test</p>'); // Should not throw
  });
});

describe('Security Hardening — Message Router Domain Spoofing Defense', () => {
  beforeEach(async () => {
    await db.forms.clear();
    await db.fields.clear();
    await db.domains.clear();
    await db.settings.clear();
  });

  it('getSenderDomain correctly extracts hostname from sender tab URL', () => {
    expect(getSenderDomain({ tab: { url: 'https://example.com/page/1' } } as any)).toBe(
      'example.com'
    );
    expect(getSenderDomain({ tab: { url: 'http://sub.domain.org:8080/path' } } as any)).toBe(
      'sub.domain.org'
    );
    expect(getSenderDomain({ tab: { url: 'https://CAPS-DOMAIN.COM/' } } as any)).toBe(
      'caps-domain.com'
    );
  });

  it('getSenderDomain returns null for extension pages and non-tab senders', () => {
    expect(
      getSenderDomain({ tab: { url: 'chrome-extension://abcd/options.html' } } as any)
    ).toBeNull();
    expect(
      getSenderDomain({ tab: { url: 'moz-extension://1234-uuid/sidepanel.html' } } as any)
    ).toBeNull();
    expect(getSenderDomain({ url: 'chrome-extension://abcd/sidepanel.html' } as any)).toBeNull();
    expect(getSenderDomain({} as any)).toBeNull();
    expect(getSenderDomain(undefined)).toBeNull();
    expect(getSenderDomain({ tab: { url: 'about:blank' } } as any)).toBeNull();
  });

  it('overrides spoofed form.domain with sender tab domain in SAVE_AUTOSAVE', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const message: RuntimeMessage = {
      type: 'SAVE_AUTOSAVE',
      payload: {
        form: {
          formInstanceId: 'form-spoof-1',
          url: 'https://attacker.com/form',
          domain: 'victim-bank.com', // Spoofed!
          title: 'Login',
          editingTime: 5,
          fields: [{ name: 'account', type: 'text', value: '12345678' }],
        },
      },
    };

    const sender: chrome.runtime.MessageSender = {
      tab: { id: 101, url: 'https://attacker.com/form' } as any,
    };

    const response = await handleRuntimeMessage(message, sender);
    expect(response.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Domain mismatch in SAVE_AUTOSAVE')
    );

    // Verify it was stored under attacker.com, NOT victim-bank.com
    const forms = await db.forms.toArray();
    expect(forms.length).toBe(1);
    expect(forms[0].domainId).toBe('attacker.com');

    warnSpy.mockRestore();
  });

  it('overrides spoofed domain with sender tab domain in GET_RECOVERABLE_TEXT', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Pre-seed bank.com draft directly in db
    await db.forms.add({
      id: 'bank.com_form-1_rev-1',
      formInstanceId: 'form-1',
      domainId: 'bank.com',
      url: 'https://bank.com/login',
      title: 'Bank Login',
      revisionId: 'rev-1',
      revisionNumber: 1,
      isFinalSubmit: false,
      editingTime: 10,
      lastModified: Date.now(),
      status: 0,
      encryption: 'none',
    });
    await db.fields.add({
      id: 'bank.com_form-1_rev-1_username',
      formId: 'bank.com_form-1_rev-1',
      domainId: 'bank.com',
      revisionId: 'rev-1',
      name: 'username',
      type: 'text',
      value: 'my-secret-username',
      lastModified: Date.now(),
      status: 0,
      encryption: 'none',
    });

    // Attacker tab tries to query bank.com recoverable text
    const message: RuntimeMessage = {
      type: 'GET_RECOVERABLE_TEXT',
      payload: {
        domain: 'bank.com', // Spoofed target
        fieldName: 'username',
        fieldType: 'text',
      },
    };

    const sender: chrome.runtime.MessageSender = {
      tab: { id: 202, url: 'https://attacker.com/malicious' } as any,
    };

    const response = await handleRuntimeMessage(message, sender);
    expect(response.success).toBe(true);
    // Overridden to attacker.com, where no records exist!
    expect(response.data.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Domain mismatch in GET_RECOVERABLE_TEXT')
    );

    warnSpy.mockRestore();
  });

  it('overrides spoofed domain with sender tab domain in GET_DOMAIN_HISTORY', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const message: RuntimeMessage = {
      type: 'GET_DOMAIN_HISTORY',
      payload: {
        domain: 'secret-service.gov',
        limit: 10,
      },
    };

    const sender: chrome.runtime.MessageSender = {
      tab: { id: 303, url: 'https://attacker.com/steal' } as any,
    };

    const response = await handleRuntimeMessage(message, sender);
    expect(response.success).toBe(true);
    expect(response.data.length).toBe(0); // Queried attacker.com, empty
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Domain mismatch in GET_DOMAIN_HISTORY')
    );

    warnSpy.mockRestore();
  });

  it('overrides spoofed domain with sender tab domain in DISABLE_DOMAIN and IS_DOMAIN_ENABLED', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Attacker tries to disable bank.com
    const disableMsg: RuntimeMessage = {
      type: 'DISABLE_DOMAIN',
      payload: {
        domain: 'bank.com',
      },
    };
    const sender: chrome.runtime.MessageSender = {
      tab: { id: 404, url: 'https://attacker.com/disable' } as any,
    };

    const disableRes = await handleRuntimeMessage(disableMsg, sender);
    expect(disableRes.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Domain mismatch in DISABLE_DOMAIN')
    );

    // Check bank.com enabled status (it should still be enabled!)
    const checkBankRes = await handleRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'bank.com' } },
      {} as any // from trusted context
    );
    expect(checkBankRes.data?.enabled).toBe(true);

    // But attacker.com should be the one that was disabled!
    const checkAttackerRes = await handleRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'attacker.com' } },
      {} as any
    );
    expect(checkAttackerRes.data?.enabled).toBe(false);

    warnSpy.mockRestore();
  });

  it('preserves payload domain when message comes from trusted extension contexts (no tab URL)', async () => {
    // When sidepanel or options page calls IS_DOMAIN_ENABLED or GET_DOMAIN_HISTORY
    const response = await handleRuntimeMessage(
      { type: 'IS_DOMAIN_ENABLED', payload: { domain: 'wikipedia.org' } },
      {} as any // No sender.tab
    );
    expect(response.success).toBe(true);
    expect(response.data?.enabled).toBe(true);
  });
});
