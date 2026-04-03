/**
 * time string parsing utilities for timeout configuration.
 * supports formats like "10m", "1h30m", "10m12s", "30s".
 */

// special value indicating timeout is explicitly disabled via --notimeout flag
export const TIMEOUT_DISABLED = "none";

// time string regex: supports formats like "10m", "1h30m", "10m12s", "30s"
// at least one component (hours, minutes, or seconds) is required
const TIME_STRING_REGEX = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/**
 * parse a time string like "10m", "1h30m", "10m12s" into milliseconds.
 * returns null if the string is not a valid time format.
 */
export function parseTimeString(input: string): number | null {
  const match = input.match(TIME_STRING_REGEX);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * check if a string is a valid time format.
 */
export function isValidTimeString(input: string): boolean {
  return parseTimeString(input) !== null;
}
