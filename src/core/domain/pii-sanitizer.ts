/**
 * Pure domain service for detecting and redacting sensitive PII (credit cards and CVVs).
 * Zero external or browser dependencies.
 */
export class PiiSanitizer {
  private static readonly CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
  private static readonly CVV_NAME_REGEX = /\b(cvv|cvc|cid|security_?code|card_?code)\b/i;

  /**
   * Validates a card number candidate using the Luhn checksum algorithm (Mod 10).
   */
  public static isLuhnValid(digitsOnly: string): boolean {
    const clean = digitsOnly.replace(/\D/g, '');
    if (clean.length < 13 || clean.length > 19) return false;

    let sum = 0;
    let shouldDouble = false;

    for (let i = clean.length - 1; i >= 0; i--) {
      let digit = parseInt(clean.charAt(i), 10);
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
   * Sanitizes a string by redacting detected CVVs and Luhn-valid credit card numbers.
   */
  public static sanitize(value: string, fieldName = ''): string {
    if (!value) return value;

    // Check if the field name suggests CVV/CVC
    if (fieldName && this.CVV_NAME_REGEX.test(fieldName.toLowerCase())) {
      return '[REDACTED CVV]';
    }

    // Check and redact credit card numbers
    return value.replace(this.CARD_REGEX, (match) => {
      const rawDigits = match.replace(/\D/g, '');
      return this.isLuhnValid(rawDigits) ? '[REDACTED CREDIT CARD]' : match;
    });
  }
}
