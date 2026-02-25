/**
 * Formatting utilities for YNAB monetary values
 */

/**
 * Converts YNAB milliunits to USD dollars.
 * YNAB stores all amounts in milliunits where 1000 milliunits = $1.00.
 *
 * @param {number} milliunits - Amount in YNAB milliunits
 * @returns {number} Amount in dollars (e.g. 1500000 → 1500.00)
 */
export function milliunitsToUSD(milliunits) {
  return Math.abs(milliunits) / 1000;
}
