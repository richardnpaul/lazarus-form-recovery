/**
 * Pure domain text diffing engine.
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
    const oldTokens: string[] =
      mode === 'word' ? (oldText.match(/\S+|\s+/g) ?? []) : oldText.split('');
    const newTokens: string[] =
      mode === 'word' ? (newText.match(/\S+|\s+/g) ?? []) : newText.split('');

    const diff: DiffChange[] = [];
    let i = 0;
    let j = 0;

    while (i < oldTokens.length || j < newTokens.length) {
      if (oldTokens[i] === newTokens[j]) {
        diff.push({ type: 'unchanged', value: oldTokens[i] });
        i++;
        j++;
      } else if (i < oldTokens.length) {
        const matchIndex = newTokens.indexOf(oldTokens[i], j);
        if (matchIndex !== -1 && matchIndex < j + 5) {
          while (j < matchIndex) {
            diff.push({ type: 'added', value: newTokens[j] });
            j++;
          }
        } else {
          diff.push({ type: 'removed', value: oldTokens[i] });
          i++;
        }
      } else {
        diff.push({ type: 'added', value: newTokens[j] });
        j++;
      }
    }

    // Merge consecutive changes of the same type for cleaner output
    const merged: DiffChange[] = [];
    for (const change of diff) {
      if (merged.length > 0 && merged[merged.length - 1].type === change.type) {
        merged[merged.length - 1].value += change.value;
      } else {
        merged.push({ ...change });
      }
    }

    return merged;
  }
}
