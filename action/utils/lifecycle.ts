import { LIFECYCLE_HOOK_TIMEOUT_MS } from "../lifecycle.ts";
import { log } from "./cli.ts";
import { spawn } from "./subprocess.ts";

export interface ExecuteLifecycleHookParams {
  event: string;
  script: string | null;
}

/**
 * execute a lifecycle hook script if one is configured.
 * runs the script in a bash shell with a timeout.
 */
export async function executeLifecycleHook(params: ExecuteLifecycleHookParams): Promise<void> {
  if (!params.script) return;

  log.info(`» executing ${params.event} lifecycle hook...`);

  const result = await spawn({
    cmd: "bash",
    args: ["-c", params.script],
    env: process.env,
    timeout: LIFECYCLE_HOOK_TIMEOUT_MS,
    activityTimeout: 0,
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  if (result.exitCode !== 0) {
    const output = result.stderr || result.stdout;
    throw new Error(
      `lifecycle hook '${params.event}' failed with exit code ${result.exitCode}:\n${output}`
    );
  }

  log.info(`» ${params.event} lifecycle hook completed successfully`);
}
