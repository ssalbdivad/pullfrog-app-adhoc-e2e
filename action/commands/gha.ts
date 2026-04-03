import { dirname } from "node:path";
import * as core from "@actions/core";
import { main } from "../main.ts";
import { log } from "../utils/cli.ts";
import { runPostCleanup } from "../utils/postCleanup.ts";

// GitHub Actions runs the action entry point with the node24 binary specified
// in action.yml, but doesn't add that binary's directory to PATH. Without this,
// spawned processes (pnpm, npm, etc.) resolve to the runner's default node (v20).
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH}`;

async function runMain(): Promise<void> {
  try {
    const result = await main();
    if (!result.success) {
      throw new Error(result.error || "agent execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error occurred";
    core.setFailed(`action failed: ${errorMessage}`);
  }
}

async function runPost(): Promise<void> {
  log.debug(`[post] script started at ${new Date().toISOString()}`);
  try {
    await runPostCleanup();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[post] unexpected error: ${message}`);
  }
}

export async function run(args: string[]) {
  if (args.includes("--post")) {
    await runPost();
  } else {
    await runMain();
  }
}
