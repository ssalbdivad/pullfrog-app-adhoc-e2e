import { performance } from "node:perf_hooks";
import { log } from "./cli.ts";

export class Timer {
  private initialTimestamp: number;
  private lastCheckpointTimestamp: number | null = null;

  constructor() {
    this.initialTimestamp = performance.now();
  }

  checkpoint(name: string): void {
    const now = performance.now();
    const duration = this.lastCheckpointTimestamp
      ? now - this.lastCheckpointTimestamp
      : now - this.initialTimestamp;

    log.debug(`» ${name}: ${duration}ms`);
    this.lastCheckpointTimestamp = now;
  }
}

const THINKING_THRESHOLD = 3000; // ms

export class ThinkingTimer {
  private readonly durationFormatter = new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "second",
    unitDisplay: "long",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  private lastToolResultTimestamp: number | null = null;

  markToolResult(): void {
    this.lastToolResultTimestamp = performance.now();
    log.debug(`» thinking timer: markToolResult at ${this.lastToolResultTimestamp}`);
  }

  markToolCall(): void {
    const now = performance.now();
    log.debug(
      `» thinking timer: markToolCall at ${now}, lastToolResult=${this.lastToolResultTimestamp}`
    );
    if (this.lastToolResultTimestamp === null) return;
    const elapsed = now - this.lastToolResultTimestamp;
    if (elapsed < THINKING_THRESHOLD) return;
    const seconds = elapsed / 1000;
    log.info(`» thought for ${this.durationFormatter.format(seconds)}`);
  }
}
