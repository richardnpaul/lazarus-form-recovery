import { isValidLuhn, scrubSensitiveData } from '../../common/utils/pii';

/**
 * Pure domain service for detecting and redacting sensitive PII (credit cards and CVVs).
 * Zero external or browser dependencies.
 */
export class PiiSanitizer {
  /**
   * Validates a card number candidate using the Luhn checksum algorithm (Mod 10).
   */
  public static isLuhnValid(digitsOnly: string): boolean {
    return isValidLuhn(digitsOnly);
  }

  /**
   * Sanitizes a string by redacting detected CVVs and Luhn-valid credit card numbers.
   */
  public static sanitize(value: string, fieldName?: string): string {
    return scrubSensitiveData(value, fieldName);
  }
}
