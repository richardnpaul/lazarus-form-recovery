/**
 * Pure domain text diffing engine implementing Longest Common Subsequence (LCS).
 * Provides character-level and word-level diffing with zero external dependencies.
 */
export interface DiffChange {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

export class TextDiffEngine {
  /**
   * Computes a token-level (word or character) diff between oldText and newText.
   */
  public static computeDiff(
    oldText: string,
    newText: string,
    mode: 'word' | 'char' = 'word'
  ): DiffChange[] {
    const oldTokens = mode === 'word' ? this.tokenizeWords(oldText) : oldText.split('');
    const newTokens = mode === 'word' ? this.tokenizeWords(newText) : newText.split('');

    const lcsMatrix = this.buildLcsMatrix(oldTokens, newTokens);
    return this.backtrackLcs(lcsMatrix, oldTokens, newTokens, oldTokens.length, newTokens.length);
  }

  private static tokenizeWords(text: string): string[] {
    return text.match(/\S+|\s+/g) || [];
  }

  private static buildLcsMatrix(a: string[], b: string[]): number[][] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp;
  }

  private static backtrackLcs(
    dp: number[][],
    a: string[],
    b: string[],
    i: number,
    j: number
  ): DiffChange[] {
    const changes: DiffChange[] = [];

    let currI = i;
    let currJ = j;

    while (currI > 0 || currJ > 0) {
      if (currI > 0 && currJ > 0 && a[currI - 1] === b[currJ - 1]) {
        changes.unshift({ type: 'unchanged', value: a[currI - 1] });
        currI--;
        currJ--;
      } else if (currJ > 0 && (currI === 0 || dp[currI][currJ - 1] >= dp[currI - 1][currJ])) {
        changes.unshift({ type: 'added', value: b[currJ - 1] });
        currJ--;
      } else if (currI > 0 && (currJ === 0 || dp[currI][currJ - 1] < dp[currI - 1][currJ])) {
        changes.unshift({ type: 'removed', value: a[currI - 1] });
        currI--;
      }
    }

    // Merge consecutive changes of the same type for cleaner output
    return this.coalesceChanges(changes);
  }

  private static coalesceChanges(changes: DiffChange[]): DiffChange[] {
    if (changes.length === 0) return [];

    const merged: DiffChange[] = [changes[0]];

    for (let i = 1; i < changes.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = changes[i];

      if (prev.type === curr.type) {
        prev.value += curr.value;
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }
}
