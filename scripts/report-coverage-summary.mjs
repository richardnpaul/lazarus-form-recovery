#!/usr/bin/env node
/**
 * Generates a Markdown summary of Vitest test coverage metrics and thresholds.
 * Outputs to stdout and automatically appends to $GITHUB_STEP_SUMMARY when in CI.
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SUMMARY_FILE = resolve(process.cwd(), 'coverage/coverage-summary.json');

const THRESHOLDS = {
  lines: 96,
  statements: 95,
  functions: 95,
  branches: 80,
};

function main() {
  if (!existsSync(SUMMARY_FILE)) {
    console.error(`Coverage summary not found at ${SUMMARY_FILE}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(SUMMARY_FILE, 'utf8'));
  const total = data.total;

  const statusIcon = (pct, threshold) => (pct >= threshold ? '✅ Pass' : '❌ Fail');

  let md = '### 📊 Vitest Test Coverage Summary\n\n';
  md += '| Metric | Coverage | Threshold | Status |\n';
  md += '| :--- | :--- | :--- | :--- |\n';
  md += `| **Lines** | ${total.lines.pct}% (${total.lines.covered}/${total.lines.total}) | >= ${THRESHOLDS.lines}% | ${statusIcon(total.lines.pct, THRESHOLDS.lines)} |\n`;
  md += `| **Statements** | ${total.statements.pct}% (${total.statements.covered}/${total.statements.total}) | >= ${THRESHOLDS.statements}% | ${statusIcon(total.statements.pct, THRESHOLDS.statements)} |\n`;
  md += `| **Functions** | ${total.functions.pct}% (${total.functions.covered}/${total.functions.total}) | >= ${THRESHOLDS.functions}% | ${statusIcon(total.functions.pct, THRESHOLDS.functions)} |\n`;
  md += `| **Branches** | ${total.branches.pct}% (${total.branches.covered}/${total.branches.total}) | >= ${THRESHOLDS.branches}% | ${statusIcon(total.branches.pct, THRESHOLDS.branches)} |\n`;

  console.log(md);

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    try {
      appendFileSync(stepSummaryPath, md + '\n', 'utf8');
    } catch (err) {
      console.error('Failed to append to GITHUB_STEP_SUMMARY:', err);
    }
  }
}

main();
