/**
 * Luhn algorithm validator for credit card numbers (13 - 19 digits).
 */
export function isValidLuhn(input: string): boolean {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isNaN(digit)) return false;

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Regex patterns for credit cards:
 * Matches sequences of 13 to 19 digits, possibly separated by spaces or dashes.
 */
const CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

/**
 * Scrubs credit card numbers and sensitive CVV codes from text.
 */
export function scrubSensitiveData(text: string, fieldName: string = ''): string {
  if (!text) return text;

  // 1. If the field is an explicit CVV/CVC field, redact entirely
  const lowerName = fieldName.toLowerCase();
  if (/\b(cvv|cvc|cid|security_?code|card_?code)\b/.test(lowerName)) {
    return '[REDACTED CVV]';
  }

  // 2. Scan for candidate credit card numbers
  return text.replace(CARD_REGEX, (match) => {
    const rawDigits = match.replace(/\D/g, '');
    if (isValidLuhn(rawDigits)) {
      return '[REDACTED CREDIT CARD]';
    }
    return match;
  });
}
