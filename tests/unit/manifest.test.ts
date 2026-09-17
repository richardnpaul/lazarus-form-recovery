import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import manifest from '../../manifest.config';

describe('Manifest Configuration', () => {
  it('defines default_icon for sidebar_action in Firefox matching extension icon paths', () => {
    expect((manifest as any).sidebar_action).toBeDefined();
    expect((manifest as any).sidebar_action.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    });
  });

  it('ensures all icon files referenced in sidebar_action exist in public/ and icons/', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const icons = (manifest as any).sidebar_action.default_icon;

    for (const [size, iconPath] of Object.entries(icons)) {
      const publicPath = path.join(rootDir, 'public', iconPath as string);
      const rootIconPath = path.join(rootDir, iconPath as string);

      expect(
        fs.existsSync(publicPath) || fs.existsSync(rootIconPath),
        `Icon for size ${size} at ${iconPath} must exist`
      ).toBe(true);
    }
  });

  it('ensures action.default_icon and icons match expected dimensions and files', () => {
    expect((manifest as any).action.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    });

    expect((manifest as any).icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });
  });
});
