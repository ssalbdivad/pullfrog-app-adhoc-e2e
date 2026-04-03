import { describe, expect, it } from "vitest";
import { isValidTimeString, parseTimeString } from "./time.ts";

describe("parseTimeString", () => {
  it.each([
    ["10m", 600000], // 10 minutes
    ["1h", 3600000], // 1 hour
    ["30s", 30000], // 30 seconds
    ["1h30m", 5400000], // 1 hour 30 minutes
    ["10m12s", 612000], // 10 minutes 12 seconds
    ["1h30m45s", 5445000], // 1 hour 30 minutes 45 seconds
    ["2h", 7200000], // 2 hours
    ["90m", 5400000], // 90 minutes
    ["0m", 0], // 0 minutes (edge case)
    ["0s", 0], // 0 seconds (edge case)
  ])("parses '%s' to %d ms", (input, expected) => {
    expect(parseTimeString(input)).toBe(expected);
  });

  it.each([
    [""], // empty string
    ["abc"], // no numbers
    ["10"], // no unit
    ["10x"], // invalid unit
    ["h10m"], // hours without number
    ["m10"], // units before number
    ["10 m"], // space between number and unit
    ["-10m"], // negative number
    ["10.5m"], // decimal
    ["10m 30s"], // space between components
  ])("returns null for invalid input '%s'", (input) => {
    expect(parseTimeString(input)).toBeNull();
  });
});

describe("isValidTimeString", () => {
  it.each(["10m", "1h", "30s", "1h30m", "10m12s", "1h30m45s"])(
    "returns true for valid '%s'",
    (input) => {
      expect(isValidTimeString(input)).toBe(true);
    }
  );

  it.each(["", "abc", "10", "10x", "-10m", "10.5m"])("returns false for invalid '%s'", (input) => {
    expect(isValidTimeString(input)).toBe(false);
  });
});
