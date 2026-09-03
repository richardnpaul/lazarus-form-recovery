import { describe, it, expect } from 'vitest';

describe('Content Script Entrypoint (src/content/content-script.ts)', () => {
  it('imports and boots the content script without error', async () => {
    await import('../../src/content/content-script');
    expect(true).toBe(true);
  });
});
