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
  });

  it('sanitizes valid card numbers in free text and preserves non-cards', () => {
    const textWithCard = 'My credit card is 4532-0151-1283-0366 and phone is 555-123-4567';
    const sanitized = PiiSanitizer.sanitize(textWithCard);
    expect(sanitized).toContain('[REDACTED CREDIT CARD]');
    expect(sanitized).toContain('555-123-4567');
    expect(PiiSanitizer.sanitize('')).toBe('');
  });
});

describe('Core Domain: TextDiffEngine', () => {
  it('computes word-level diffs correctly', () => {
    const oldText = 'The quick brown fox';
    const newText = 'The fast brown fox jumps';

    const diff = TextDiffEngine.computeDiff(oldText, newText, 'word');
    expect(diff).toBeDefined();

    const removed = diff.find(d => d.type === 'removed');
    const added = diff.find(d => d.type === 'added');

    expect(removed?.value).toBe('quick');
    expect(added?.value).toContain('fast');
  });

  it('computes character-level diffs correctly', () => {
    const diff = TextDiffEngine.computeDiff('cat', 'car', 'char');
    expect(diff.some(d => d.type === 'removed' && d.value === 't')).toBe(true);
    expect(diff.some(d => d.type === 'added' && d.value === 'r')).toBe(true);
  });

  it('handles empty or identical strings', () => {
    const identical = TextDiffEngine.computeDiff('hello', 'hello');
    expect(identical.length).toBe(1);
    expect(identical[0].type).toBe('unchanged');

    const empty = TextDiffEngine.computeDiff('', '');
    expect(empty).toEqual([]);
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

  it('resets start time when idle threshold is exceeded', () => {
    let session = EditingSessionTracker.recordActivity(undefined, 1000);
    session = EditingSessionTracker.recordActivity(session, 1000 + (6 * 60 * 1000)); // 6 minutes later
    expect(session.startTime).toBe(1000 + (6 * 60 * 1000));
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

  it('extracts creation timestamp from revision ID with fallback', () => {
    expect(FormRevisionPolicy.extractCreationTime('rev_1700000000_abc', 999)).toBe(1700000000);
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

  it('evaluates revision decision: idle timeout (15+ minutes)', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 1000 };
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + (16 * 60 * 1000) // 16 minutes later
    );
    expect(decision.reason).toBe('idle_timeout');
    expect(decision.revisionNumber).toBe(2);
    expect(decision.shouldSpawnNewRevision).toBe(true);
  });

  it('evaluates revision decision: milestone reached (5+ minutes of continuous editing)', () => {
    const latest = { id: 'f1', revisionId: 'rev_1000_a', revisionNumber: 1, lastModified: 2000 };
    const decision = FormRevisionPolicy.evaluateRevisionDecision(
      latest,
      1,
      'github.com',
      'issue_form',
      1000 + (6 * 60 * 1000) // 6 minutes after creation
    );
    expect(decision.reason).toBe('milestone_reached');
    expect(decision.revisionNumber).toBe(2);
    expect(decision.shouldSpawnNewRevision).toBe(true);
  });

  it('evaluates revision decision: active session update (<5 min editing, active)', () => {
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
  });

  it('calculates revisions to prune when exceeding max cap of 10', () => {
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

    // Below cap
    expect(FormRevisionPolicy.calculateRevisionsToPrune(revisions.slice(0, 5), 10)).toEqual([]);
  });
});
