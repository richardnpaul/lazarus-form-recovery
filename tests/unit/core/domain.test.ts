import { describe, it, expect } from 'vitest';
import { PiiSanitizer } from '../../../src/core/domain/pii-sanitizer';
import { TextDiffEngine } from '../../../src/core/domain/text-diff';
import { EditingSessionTracker } from '../../../src/core/domain/editing-session';
import { FormRevisionPolicy } from '../../../src/core/domain/form-revision';

describe('Core Domain: PiiSanitizer', () => {
  it('identifies Luhn-valid and invalid numbers correctly', () => {
    // Valid Visa
    expect(PiiSanitizer.isLuhnValid('4532015112830366')).toBe(true);
    // Invalid
    expect(PiiSanitizer.isLuhnValid('4532015112830367')).toBe(false);
    // Too short / too long
    expect(PiiSanitizer.isLuhnValid('12345')).toBe(false);
    expect(PiiSanitizer.isLuhnValid('123456789012345678901')).toBe(false);
    // Non-numeric
    expect(PiiSanitizer.isLuhnValid('abcdefghijklmno')).toBe(false);
  });

  it('sanitizes CVVs based on field name', () => {
    expect(PiiSanitizer.sanitize('123', 'cvv')).toBe('[REDACTED CVV]');
    expect(PiiSanitizer.sanitize('9876', 'card_code')).toBe('[REDACTED CVV]');
    expect(PiiSanitizer.sanitize('555', 'securityCode')).toBe('[REDACTED CVV]');
    expect(PiiSanitizer.sanitize('111', 'cid')).toBe('[REDACTED CVV]');
  });

  it('sanitizes valid card numbers in free text and preserves non-cards', () => {
    const textWithCard = 'My credit card is 4532-0151-1283-0366 and phone is 555-123-4567';
    const sanitized = PiiSanitizer.sanitize(textWithCard);
    expect(sanitized).toContain('[REDACTED CREDIT CARD]');
    expect(sanitized).toContain('555-123-4567');
    expect(PiiSanitizer.sanitize('')).toBe('');

    // Calling sanitize without fieldName
    expect(PiiSanitizer.sanitize('Plain text without cards')).toBe('Plain text without cards');
    expect(PiiSanitizer.sanitize('Card: 4532 0151 1283 0366')).toBe('Card: [REDACTED CREDIT CARD]');
  });
});

describe('Core Domain: TextDiffEngine', () => {
  it('computes word-level diffs correctly', () => {
    const oldText = 'The quick brown fox';
    const newText = 'The fast brown fox jumps';

    const diff = TextDiffEngine.computeDiff(oldText, newText, 'word');
    expect(diff).toBeDefined();

    const removed = diff.find((d) => d.type === 'removed');
    const added = diff.find((d) => d.type === 'added');

    expect(removed?.value).toBe('quick');
    expect(added?.value).toContain('fast');
  });

  it('computes character-level diffs correctly', () => {
    const diff = TextDiffEngine.computeDiff('cat', 'car', 'char');
    expect(diff.some((d) => d.type === 'removed' && d.value === 't')).toBe(true);
    expect(diff.some((d) => d.type === 'added' && d.value === 'r')).toBe(true);
  });

  it('handles identical and empty strings', () => {
    expect(TextDiffEngine.computeDiff('hello world', 'hello world')).toEqual([
      { type: 'unchanged', value: 'hello world' },
    ]);
    expect(TextDiffEngine.computeDiff('', '')).toEqual([]);
  });

  it('handles multiple spaces between words (tests regex tokenization on oldText and newText)', () => {
    expect(TextDiffEngine.computeDiff('hello   world', 'hello world')).toEqual([
      { type: 'unchanged', value: 'hello' },
      { type: 'removed', value: '   ' },
      { type: 'added', value: ' ' },
      { type: 'unchanged', value: 'world' },
    ]);
    expect(TextDiffEngine.computeDiff('hello world', 'hello   world')).toEqual([
      { type: 'unchanged', value: 'hello' },
      { type: 'removed', value: ' ' },
      { type: 'added', value: '   ' },
      { type: 'unchanged', value: 'world' },
    ]);
  });

  it('handles added tokens before unchanged token within lookahead window', () => {
    expect(TextDiffEngine.computeDiff('fox', 'fast brown fox')).toEqual([
      { type: 'added', value: 'fast brown ' },
      { type: 'unchanged', value: 'fox' },
    ]);
  });

  it('handles lookahead window boundary checks', () => {
    // Lookahead match within lookahead window (index 4 < 5)
    expect(TextDiffEngine.computeDiff('target', 'w1 w2 target')).toEqual([
      { type: 'added', value: 'w1 w2 ' },
      { type: 'unchanged', value: 'target' },
    ]);

    // Exact match at index 5 (5 < 5 is false, kills <= 5 mutant)
    expect(TextDiffEngine.computeDiff('target', ' w1 w2 target')).toEqual([
      { type: 'removed', value: 'target' },
      { type: 'added', value: ' w1 w2 target' },
    ]);

    // Match outside lookahead window (index 6 >= 5)
    expect(TextDiffEngine.computeDiff('target', 'w1 w2 w3 target')).toEqual([
      { type: 'removed', value: 'target' },
      { type: 'added', value: 'w1 w2 w3 target' },
    ]);
  });

  it('handles divergent text with removals, additions, and lookaheads', () => {
    expect(TextDiffEngine.computeDiff('the quick brown fox', 'the fast brown dog')).toEqual([
      { type: 'unchanged', value: 'the ' },
      { type: 'removed', value: 'quick' },
      { type: 'added', value: 'fast' },
      { type: 'unchanged', value: ' brown ' },
      { type: 'removed', value: 'fox' },
      { type: 'added', value: 'dog' },
    ]);

    expect(TextDiffEngine.computeDiff('apple', 'banana')).toEqual([
      { type: 'removed', value: 'apple' },
      { type: 'added', value: 'banana' },
    ]);

    expect(TextDiffEngine.computeDiff('one two three', 'one')).toEqual([
      { type: 'unchanged', value: 'one' },
      { type: 'removed', value: ' two three' },
    ]);

    expect(TextDiffEngine.computeDiff('one', 'one two three')).toEqual([
      { type: 'unchanged', value: 'one' },
      { type: 'added', value: ' two three' },
    ]);
  });
});

describe('Core Domain: EditingSessionTracker', () => {
  it('initializes a fresh editing session', () => {
    const session = EditingSessionTracker.recordActivity(undefined, 1000);
    expect(session.startTime).toBe(1000);
    expect(session.lastActiveTime).toBe(1000);
    expect(session.totalActiveSeconds).toBe(0);
  });

  it('accumulates active seconds within idle bounds', () => {
    let session = EditingSessionTracker.recordActivity(undefined, 1000);
    session = EditingSessionTracker.recordActivity(session, 4000); // 3 seconds later
    expect(session.totalActiveSeconds).toBe(3);
    expect(session.lastActiveTime).toBe(4000);
  });

  it('tests exact boundary of idle threshold (300,000 ms)', () => {
    let session = EditingSessionTracker.recordActivity(undefined, 1000);
    // At exactly 5 minutes (300,000 ms), idle gap is NOT exceeded (elapsedMs > 300,000 is false)
    session = EditingSessionTracker.recordActivity(session, 1000 + 5 * 60 * 1000);
    expect(session.startTime).toBe(1000);
    expect(session.totalActiveSeconds).toBe(300);

    // Exceeding by 1 ms resets start time
    session = EditingSessionTracker.recordActivity(
      session,
      session.lastActiveTime + 5 * 60 * 1000 + 1
    );
    expect(session.startTime).toBe(1000 + 5 * 60 * 1000 + 5 * 60 * 1000 + 1);
    expect(session.totalActiveSeconds).toBe(300);
  });

  it('resets start time when idle threshold is exceeded', () => {
    let session = EditingSessionTracker.recordActivity(undefined, 1000);
    session = EditingSessionTracker.recordActivity(session, 1000 + 6 * 60 * 1000); // 6 minutes later
    expect(session.startTime).toBe(1000 + 6 * 60 * 1000);
    expect(session.totalActiveSeconds).toBe(0);
  });
});

describe('Core Domain: FormRevisionPolicy', () => {
  it('normalizes domains and formats deterministic form IDs', () => {
    expect(FormRevisionPolicy.normalizeDomain('  EXAMPLE.COM  ')).toBe('example.com');
    expect(FormRevisionPolicy.normalizeDomain('')).toBe('unknown');

    const formId = FormRevisionPolicy.computeFormId('example.com', 'login', 'rev_123');
    expect(formId).toBe('example.com_login_rev_123');
  });

  it('generates unique revision ID matching exact pattern with 5-character suffix', () => {
    const revId = FormRevisionPolicy.generateRevisionId(1700000000);
    expect(revId).toMatch(/^rev_1700000000_[a-z0-9]{5}$/);
  });

  it('extracts creation timestamp from revision ID with fallback and boundary checks', () => {
    expect(FormRevisionPolicy.extractCreationTime('rev_1700000000_abc', 999)).toBe(1700000000);
    expect(FormRevisionPolicy.extractCreationTime('rev_0_abc', 999)).toBe(999);
    expect(FormRevisionPolicy.extractCreationTime('rev_-50_abc', 999)).toBe(999);
    expect(FormRevisionPolicy.extractCreationTime('invalid', 999)).toBe(999);
    expect(FormRevisionPolicy.extractCreationTime(undefined, 999)).toBe(999);
  });

  it('evaluates revision decision: initial snapshot', () => {
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      undefined,
      0,
      'github.com',
      'issue_form',
      1000
    );
    expect(decision.reason).toBe('initial');
    expect(decision.revisionNumber).toBe(1);
    expect(decision.shouldSpawnNewRevision).toBe(true);
  });

  it('evaluates revision decision: forced new revision', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 1000 };
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1500,
      false,
      true // forceNewRevision
    );
    expect(decision.reason).toBe('forced');
    expect(decision.revisionNumber).toBe(2);
    expect(decision.shouldSpawnNewRevision).toBe(true);
  });

  it('evaluates revision decision: final submission', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 1000 };
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1500,
      true // isFinalSubmit
    );
    expect(decision.reason).toBe('final_submit');
    expect(decision.revisionNumber).toBe(2);
    expect(decision.shouldSpawnNewRevision).toBe(true);
  });

  it('evaluates revision decision: idle timeout exact boundary (15 minutes)', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 1000 };

    // Exactly 15 minutes: idleTime >= 15 min is TRUE
    const decisionAtBoundary = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + FormRevisionPolicy.SESSION_IDLE_TIMEOUT_MS
    );
    expect(decisionAtBoundary.reason).toBe('idle_timeout');
    expect(decisionAtBoundary.revisionNumber).toBe(2);
    expect(decisionAtBoundary.shouldSpawnNewRevision).toBe(true);

    // 1 ms before 15 minutes: not idle timeout
    const decisionBefore = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + FormRevisionPolicy.SESSION_IDLE_TIMEOUT_MS - 1
    );
    expect(decisionBefore.reason).not.toBe('idle_timeout');
  });

  it('evaluates revision decision: milestone reached exact boundary (5 minutes of continuous editing)', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 2000 };

    // Exactly 5 minutes from creation: activeDuration >= 5 min is TRUE
    const decisionAtBoundary = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + FormRevisionPolicy.MILESTONE_DURATION_MS
    );
    expect(decisionAtBoundary.reason).toBe('milestone_reached');
    expect(decisionAtBoundary.revisionNumber).toBe(2);
    expect(decisionAtBoundary.shouldSpawnNewRevision).toBe(true);

    // 1 ms before 5 minutes: active session update
    const decisionBefore = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + FormRevisionPolicy.MILESTONE_DURATION_MS - 1
    );
    expect(decisionBefore.reason).toBe('active_update');
  });

  it('evaluates revision decision: active session update (<5 min editing, active) with fallbacks', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 1200 };
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1500 // 500ms after creation
    );
    expect(decision.reason).toBe('active_update');
    expect(decision.revisionNumber).toBe(1);
    expect(decision.shouldSpawnNewRevision).toBe(false);
    expect(decision.formId).toBe('f1');

    // Fallbacks when revisionId is empty or revisionNumber is 0
    const fallbackLatest = { id: 'f2', revisionId: '', revisionNumber: 0, lastModified: 2000 };
    const fallbackDecision = FormRevisionPolicy.evaluateRevisionDecision(
      fallbackLatest,
      0,
      'github.com',
      'issue_form',
      2100
    );
    expect(fallbackDecision.revisionId).toBe('rev_2000');
    expect(fallbackDecision.revisionNumber).toBe(1);
  });

  it('calculates revisions to prune when exceeding max cap of 10 and at exact cap', () => {
    const revisions = Array.from({ length: 13 }, (_, i) => ({
      id: `rev_${i}`,
      lastModified: 1000 + i * 100,
    }));

    const toPrune = FormRevisionPolicy.calculateRevisionsToPrune(revisions, 10);
    expect(toPrune.length).toBe(3);
    // Should prune the oldest 3 (indices 0, 1, 2)
    expect(toPrune).toContain('rev_0');
    expect(toPrune).toContain('rev_1');
    expect(toPrune).toContain('rev_2');

    // Exactly at cap (10 revisions) -> empty
    expect(FormRevisionPolicy.calculateRevisionsToPrune(revisions.slice(0, 10), 10)).toEqual([]);

    // Below cap (5 revisions) with default maxRevisions parameter
    expect(FormRevisionPolicy.calculateRevisionsToPrune(revisions.slice(0, 5))).toEqual([]);
  });
});
