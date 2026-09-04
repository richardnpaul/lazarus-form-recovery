#!/usr/bin/env node
/**
 * Patches @stryker-mutator/vitest-runner to support Vitest 5.
 *
 * In Vitest 5, setting `project.config.testNamePattern` with leaf test regexes
 * causes Vitest to filter hierarchically from root `describe()` suites, skipping
 * all nested tests and falsely reporting that mutants survived.
 *
 * This script ensures project.config.testNamePattern is set to undefined so Vitest 5
 * executes the targeted test files reliably.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const runnerPath = resolve(
  process.cwd(),
  'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js'
);

if (existsSync(runnerPath)) {
  let content = readFileSync(runnerPath, 'utf8');
  if (content.includes('project.config.testNamePattern = regex;')) {
    content = content.replace(
      'project.config.testNamePattern = regex;',
      'project.config.testNamePattern = undefined;'
    );
    writeFileSync(runnerPath, content, 'utf8');
    console.log('[Stryker Vitest 5 Patch] Applied compatibility fix to @stryker-mutator/vitest-runner.');
  }
}
