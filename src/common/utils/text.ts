export interface DiffPart {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

/**
 * Format relative time for human reading (e.g. "Just now", "5m ago", "2h ago", "Yesterday").
 */
export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Counts words in a string.
 */
export function computeWordCount(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Sanitizes and truncates preview text.
 */
export function sanitizePreview(text: string, maxLength = 80): string {
  if (!text) return '';
  const clean = text
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength) + '...';
}

/**
 * Computes a line-by-line or token-by-token diff between two texts.
 */
export function computeSimpleDiff(oldText: string, newText: string): DiffPart[] {
  if (oldText === newText) {
    return [{ type: 'unchanged', value: oldText }];
  }

  const oldTokens = oldText.split(/(\s+|\b)/).filter(Boolean);
  const newTokens = newText.split(/(\s+|\b)/).filter(Boolean);

  const diff: DiffPart[] = [];
  let i = 0;
  let j = 0;

  while (i < oldTokens.length || j < newTokens.length) {
    if (i < oldTokens.length && j < newTokens.length && oldTokens[i] === newTokens[j]) {
      diff.push({ type: 'unchanged', value: oldTokens[i] });
      i++;
      j++;
    } else {
      // Look ahead for matches
      let foundOldInNew = -1;
      for (let k = j; k < Math.min(j + 5, newTokens.length); k++) {
        if (i < oldTokens.length && oldTokens[i] === newTokens[k]) {
          foundOldInNew = k;
          break;
        }
      }

      if (foundOldInNew !== -1) {
        while (j < foundOldInNew) {
          diff.push({ type: 'added', value: newTokens[j] });
          j++;
        }
      } else if (i < oldTokens.length) {
        diff.push({ type: 'removed', value: oldTokens[i] });
        i++;
      } else if (j < newTokens.length) {
        diff.push({ type: 'added', value: newTokens[j] });
        j++;
      }
    }
  }

  // Merge consecutive tokens of same type
  const merged: DiffPart[] = [];
  for (const part of diff) {
    if (merged.length > 0 && merged[merged.length - 1].type === part.type) {
      merged[merged.length - 1].value += part.value;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}
