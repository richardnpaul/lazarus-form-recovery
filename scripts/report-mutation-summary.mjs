#!/usr/bin/env node
/**
 * Generates a Markdown summary of Stryker mutation testing metrics and thresholds.
 * Outputs to stdout and automatically appends to $GITHUB_STEP_SUMMARY when in CI.
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MUTATION_JSON = resolve(process.cwd(), 'reports/mutation/mutation.json');
const INCREMENTAL_JSON = resolve(process.cwd(), 'reports/stryker-incremental.json');
const BREAK_THRESHOLD = 58;

function parseReport(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;
  let compileErrors = 0;

  const files = Object.keys(data.files || {});
  for (const f of files) {
    for (const m of data.files[f].mutants || []) {
      if (m.status === 'Killed') killed++;
      else if (m.status === 'Survived') survived++;
      else if (m.status === 'NoCoverage') noCoverage++;
      else if (m.status === 'Timeout') timeout++;
      else if (m.status === 'CompileError') compileErrors++;
    }
  }

  const total = killed + survived + noCoverage + timeout;
  const score = total > 0 ? ((killed + timeout) / total) * 100 : 0;

  return { killed, survived, noCoverage, timeout, compileErrors, total, score };
}

function main() {
  let reportPath = null;
  if (existsSync(MUTATION_JSON)) {
    reportPath = MUTATION_JSON;
  } else if (existsSync(INCREMENTAL_JSON)) {
    reportPath = INCREMENTAL_JSON;
  }

  if (!reportPath) {
    console.error('No mutation report found (checked mutation.json and stryker-incremental.json)');
    process.exit(1);
  }

  const { killed, survived, noCoverage, timeout, compileErrors, total, score } =
    parseReport(reportPath);
  const status = score >= BREAK_THRESHOLD ? '✅ Pass' : '❌ Fail';

  let md = '### 🧬 Stryker Mutation Testing Summary\n\n';
  md += '| Metric | Value | Threshold | Status |\n';
  md += '| :--- | :--- | :--- | :--- |\n';
  md += `| **Mutation Score** | **${score.toFixed(2)}%** | >= ${BREAK_THRESHOLD}% | ${status} |\n`;
  md += `| **Killed Mutants** | ${killed} | - | - |\n`;
  md += `| **Survived Mutants** | ${survived} | - | - |\n`;
  md += `| **No Coverage** | ${noCoverage} | - | - |\n`;
  md += `| **Timeout** | ${timeout} | - | - |\n`;
  md += `| **Compile Errors** | ${compileErrors} | *(excluded)* | - |\n`;
  md += `| **Total Evaluated** | ${total} | - | - |\n`;

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
