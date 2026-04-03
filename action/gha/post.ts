#!/usr/bin/env node

/**
 * Post cleanup entry point for pullfrog/pullfrog action.
 * Runs independently after workflow failure or cancellation.
 * Searches for Pullfrog comment via GitHub API and updates if stuck on "Leaping into action".
 */

import { log } from "../utils/cli.ts";
import { runPostCleanup } from "../utils/postCleanup.ts";

log.debug(`[post] script started at ${new Date().toISOString()}`);
try {
  await runPostCleanup();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`[post] unexpected error: ${message}`);
  // don't fail the post script - best effort cleanup
}
