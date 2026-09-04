#!/usr/bin/env node
// @ts-nocheck
/**
 * Automated Test Efficacy & Mutation Testing Verification Runner
 *
 * Evaluates test suite quality by injecting deliberate semantic mutations into
 * critical components and verifying that the corresponding tests catch the regression
 * (mutant killed). Restores all source files immediately.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT_DIR = resolve(process.cwd());


const MUTANTS = [
  {
    id: 'MUTANT_01_PII_LUHN',
    subsystem: 'PII & Vault Security',
    description: 'Bypass Luhn credit card checksum validation (always return false)',
    filePath: 'src/common/utils/pii.ts',
    originalSnippet: 'return sum % 10 === 0;',
    mutatedSnippet: 'return false;',
    targetTest: 'tests/unit/utils.test.ts',
  },
  {
    id: 'MUTANT_02_PII_CVV',
    subsystem: 'PII & Vault Security',
    description: 'Bypass CVV/CVC redaction rule (leak plain security code)',
    filePath: 'src/common/utils/pii.ts',
    originalSnippet: "return '[REDACTED CVV]';",
    mutatedSnippet: 'return text;',
    targetTest: 'tests/unit/utils.test.ts',
  },
  {
    id: 'MUTANT_03_REVISION_CAP',
    subsystem: 'Form Revision Policy',
    description: 'Disable 10-revision retention cap calculation (never prune excess revisions)',
    filePath: 'src/core/domain/form-revision.ts',
    originalSnippet: 'return sorted.slice(maxRevisions).map((r) => r.id);',
    mutatedSnippet: 'return [];',
    targetTest: 'tests/unit/core/domain.test.ts',
  },
  {
    id: 'MUTANT_04_DOMAIN_NORMALIZE',
    subsystem: 'Form Revision Policy',
    description: 'Corrupt domain normalization logic in domain policy',
    filePath: 'src/core/domain/form-revision.ts',
    originalSnippet: "return (domain || 'unknown').trim().toLowerCase();",
    mutatedSnippet: "return 'corrupted_domain';",
    targetTest: 'tests/unit/core/domain.test.ts',
  },
  {
    id: 'MUTANT_05_USECASE_DISABLED_DOMAIN',
    subsystem: 'Privacy & Permissions',
    description: 'Bypass domain disabled check in SaveFormDraftUseCase',
    filePath: 'src/core/use-cases/save-form-draft.use-case.ts',
    originalSnippet: 'if (!enabled) {',
    mutatedSnippet: 'if (false && !enabled) {',
    targetTest: 'tests/unit/core/use-cases.test.ts',
  },
  {
    id: 'MUTANT_06_REPO_IS_DOMAIN_ENABLED',
    subsystem: 'Domain Blocklist Storage',
    description: 'Invert isDomainEnabled in repository (allow blocked domains)',
    filePath: 'src/common/db/repository.ts',
    originalSnippet: 'if (matchesDomainPattern(hostname, pattern)) {\n        return false;\n      }',
    mutatedSnippet: 'if (matchesDomainPattern(hostname, pattern)) {\n        return true;\n      }',
    targetTest: 'tests/unit/repository.test.ts',
  },
  {
    id: 'MUTANT_07_REPO_CLEANUP_CUTOFF',
    subsystem: 'Data Retention & Expiry',
    description: 'Invert cleanupExpiredForms retention cutoff (query forms above cutoff)',
    filePath: 'src/common/db/repository.ts',
    originalSnippet: "const expiredForms = await db.forms.where('lastModified').below(cutoff).toArray();",
    mutatedSnippet: "const expiredForms = await db.forms.where('lastModified').above(cutoff).toArray();",
    targetTest: 'tests/unit/repository.test.ts',
  },
  {
    id: 'MUTANT_08_EXTRACTOR_PASSWORD',
    subsystem: 'Field Extraction & Security',
    description: 'Bypass savePasswords=false guard in FieldExtractor (track passwords)',
    filePath: 'src/content/field-extractor.ts',
    originalSnippet: "if (type === 'password') {\n        return savePasswords;\n      }",
    mutatedSnippet: "if (type === 'password') {\n        return true;\n      }",
    targetTest: 'tests/unit/field-extractor.test.ts',
  },
  {
    id: 'MUTANT_09_TRACKER_ENTER_FLUSH',
    subsystem: 'Content Script Autosave',
    description: 'Disable Enter key immediate flush handler in FormTracker',
    filePath: 'src/content/form-tracker.ts',
    originalSnippet: "if (e.key === 'Enter') {",
    mutatedSnippet: "if (e.key === 'DisabledEnterKey') {",
    targetTest: 'tests/unit/form-tracker.test.ts',
  },
  {
    id: 'MUTANT_10_SIDEPANEL_FILTER',
    subsystem: 'Sidepanel History UI',
    description: 'Bypass this_site domain filter chip in sidepanel applyFilter',
    filePath: 'src/sidepanel/sidepanel.ts',
    originalSnippet: "function applyFilter(items: any[]): any[] {\n  if (currentFilter === 'all') return items;\n\n  if (currentFilter === 'this_site') {",
    mutatedSnippet: "function applyFilter(items: any[]): any[] {\n  if (currentFilter === 'all') return items;\n\n  if (currentFilter === 'disabled_this_site') {",
    targetTest: 'tests/unit/sidepanel.test.ts',
  },
  {
    id: 'MUTANT_11_STORAGE_CLEAR_TAB',
    subsystem: 'Session Storage Manager',
    description: 'Disable chrome.storage.session removal in clearTabAutosaves',
    filePath: 'src/background/storage-manager.ts',
    originalSnippet: 'if (keysToRemove.length > 0) {\n        await chrome.storage.session.remove(keysToRemove);\n      }',
    mutatedSnippet: 'if (false && keysToRemove.length > 0) {\n        await chrome.storage.session.remove(keysToRemove);\n      }',
    targetTest: 'tests/unit/storage-manager.test.ts',
  },
  {
    id: 'MUTANT_12_ALARMS_NAME_MATCH',
    subsystem: 'Background Alarm Lifecycle',
    description: 'Corrupt alarm name matching in background periodic cleanup',
    filePath: 'src/background/alarms.ts',
    originalSnippet: "if (alarm.name === 'cleanup-expired-forms') {",
    mutatedSnippet: "if (alarm.name === 'wrong-alarm-name') {",
    targetTest: 'tests/unit/alarms.test.ts',
  },
];

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

// Safety registry for file restoration on emergency exit
let activeFileToRestore = null;
let activeOriginalContent = null;

function cleanupOnExit() {
  if (activeFileToRestore && activeOriginalContent !== null) {
    try {
      writeFileSync(activeFileToRestore, activeOriginalContent, 'utf8');
      console.log(`\n${YELLOW}[SAFETY] Restored ${activeFileToRestore} before exit.${RESET}`);
    } catch (err) {
      console.error(`Failed to restore ${activeFileToRestore}:`, err);
    }
  }
}

process.on('SIGINT', () => {
  cleanupOnExit();
  process.exit(130);
});

process.on('SIGTERM', () => {
  cleanupOnExit();
  process.exit(143);
});

async function main() {
  console.log(`\n${BOLD}${CYAN}==============================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   Lazarus Form Recovery - Test Efficacy & Mutation Testing   ${RESET}`);
  console.log(`${BOLD}${CYAN}==============================================================${RESET}\n`);
  console.log(`${GRAY}Target Mutants: ${MUTANTS.length} semantic regressions across core subsystems${RESET}\n`);

  const results = [];

  for (let i = 0; i < MUTANTS.length; i++) {
    const mutant = MUTANTS[i];
    const fullPath = resolve(ROOT_DIR, mutant.filePath);
    const progress = `[${i + 1}/${MUTANTS.length}]`;

    process.stdout.write(`${CYAN}${progress} Testing ${mutant.id}... ${RESET}`);

    let fileContent;
    try {
      fileContent = readFileSync(fullPath, 'utf8');
    } catch (err) {
      console.log(`${RED}ERROR: Unable to read file ${mutant.filePath}${RESET}`);
      results.push({ mutant, status: 'ERROR', message: `File read failed: ${err.message}` });
      continue;
    }

    if (!fileContent.includes(mutant.originalSnippet)) {
      console.log(`${RED}ERROR: Target snippet not found in ${mutant.filePath}${RESET}`);
      results.push({ mutant, status: 'ERROR', message: 'Target snippet not found in source file' });
      continue;
    }

    // Set safety restoration context
    activeFileToRestore = fullPath;
    activeOriginalContent = fileContent;

    const mutatedContent = fileContent.replace(mutant.originalSnippet, mutant.mutatedSnippet);

    try {
      // 1. Inject mutant
      writeFileSync(fullPath, mutatedContent, 'utf8');

      // 2. Run target test
      const vitestResult = spawnSync('npx', ['vitest', 'run', mutant.targetTest], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' },
      });

      // 3. Evaluate if mutant was killed
      // A mutant is KILLED if the test fails (exitCode !== 0).
      // If the test passed (exitCode === 0), the mutant SURVIVED (test suite failed to detect bug).
      if (vitestResult.status !== 0) {
        console.log(`${GREEN}KILLED (Test failed as expected)${RESET}`);
        results.push({ mutant, status: 'KILLED', exitCode: vitestResult.status });
      } else {
        console.log(`${RED}SURVIVED! (Test passed despite broken code)${RESET}`);
        results.push({
          mutant,
          status: 'SURVIVED',
          exitCode: vitestResult.status,
          output: vitestResult.stdout.slice(0, 300),
        });
      }
    } finally {
      // 4. Immediately restore original pristine content
      writeFileSync(fullPath, fileContent, 'utf8');
      activeFileToRestore = null;
      activeOriginalContent = null;
    }
  }

  // Summary Report
  console.log(`\n${BOLD}--------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}                     MUTATION TESTING REPORT                  ${RESET}`);
  console.log(`${BOLD}--------------------------------------------------------------${RESET}\n`);

  let killedCount = 0;
  let survivedCount = 0;
  let errorCount = 0;

  for (const r of results) {
    const statusColor =
      r.status === 'KILLED' ? GREEN : r.status === 'SURVIVED' ? RED : YELLOW;
    const paddedStatus = `[${r.status}]`.padEnd(12);
    console.log(
      `${statusColor}${paddedStatus}${RESET} ${BOLD}${r.mutant.id}${RESET} (${r.mutant.subsystem})`
    );
    console.log(`             ${GRAY}Mutation: ${r.mutant.description}${RESET}`);
    console.log(`             ${GRAY}Test:     ${r.mutant.targetTest}${RESET}`);

    if (r.status === 'KILLED') killedCount++;
    else if (r.status === 'SURVIVED') survivedCount++;
    else errorCount++;
  }

  const total = MUTANTS.length;
  const killRate = ((killedCount / total) * 100).toFixed(1);

  console.log(`\n${BOLD}==============================================================${RESET}`);
  console.log(` Total Mutants:  ${total}`);
  console.log(` Killed Mutants: ${GREEN}${killedCount}${RESET}`);
  console.log(` Survived:       ${survivedCount > 0 ? RED : GREEN}${survivedCount}${RESET}`);
  if (errorCount > 0) {
    console.log(` Errors:         ${YELLOW}${errorCount}${RESET}`);
  }
  console.log(
    ` Mutation Score: ${killedCount === total ? GREEN : RED}${BOLD}${killRate}% kill rate${RESET}`
  );
  console.log(`${BOLD}==============================================================${RESET}\n`);

  if (killedCount === total) {
    console.log(
      `${GREEN}${BOLD}✓ SUCCESS: All deliberate semantic mutants were killed by the test suite!${RESET}\n`
    );
    process.exit(0);
  } else {
    console.error(
      `${RED}${BOLD}✗ FAILURE: ${survivedCount} mutant(s) survived! Test assertions must be improved.${RESET}\n`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  cleanupOnExit();
  console.error('Fatal mutation runner error:', err);
  process.exit(1);
});
