# Lazarus Form Recovery - Build Instructions for Mozilla Add-on Reviewers

This extension is built from TypeScript source code using Vite and the CRXJS plugin.
The build targets both Firefox Desktop and Firefox for Android (GeckoView / Fenix) using a single multi-platform package.
Follow these steps to reproduce the exact build from the provided source archive.

## Prerequisites

- **Node.js**: `v26.x`
- **npm**: `v11.x`

## Reproduction Steps

1. Extract the provided source archive and change into the project directory:

   ```bash
   unzip lazarus-form-recovery-source.zip
   cd lazarus-form-recovery
   ```

2. Install the exact dependencies specified in `package-lock.json`:

   ```bash
   npm ci
   ```

3. Build the Firefox distribution:

   ```bash
   npm run build:firefox
   ```

   This compiles TypeScript and uses Vite to bundle scripts into the `dist/` directory with Firefox manifest settings.

4. Package the add-on:
   ```bash
   npm run package:firefox
   ```
   This creates the distributable add-on package at:
   `packages/lazarus-form-recovery-firefox.xpi` (and `.zip`).

The output package matches the submitted extension package.
