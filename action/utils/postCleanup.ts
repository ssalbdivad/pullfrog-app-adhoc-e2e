import { LEAPING_INTO_ACTION_PREFIX } from "../mcp/comment.ts";
import { getApiUrl } from "./apiUrl.ts";
import { buildPullfrogFooter } from "./buildPullfrogFooter.ts";
import { log } from "./cli.ts";
import { createOctokit, parseRepoContext } from "./github.ts";
import { type ResolvedPromptInput, resolvePromptInput } from "./payload.ts";
import { getJobToken } from "./token.ts";

type JsonPromptInput = Extract<ResolvedPromptInput, object>; // not string

// controls whether the script should check the reason for the workflow termination.
// it can be either canceled or failed.
// YAML file cannot supply it (not in ENV), so an extra request is required to check it.
const SHOULD_CHECK_REASON = true;

type BuildErrorCommentBodyParams = {
  owner: string;
  repo: string;
  runId: number | undefined;
  isCancellation: boolean;
};

function buildErrorCommentBody(params: BuildErrorCommentBodyParams): string {
  let errorMessage = params.isCancellation
    ? `This run was cancelled 🛑\n\nThe workflow was cancelled before completion.`
    : `This run croaked 😵\n\nThe workflow encountered an error before any progress could be reported.`;

  if (params.runId) {
    errorMessage += " Please check the link below for details.";
  }

  const customParts: string[] = [];
  if (!params.isCancellation && params.runId) {
    const apiUrl = getApiUrl();
    customParts.push(
      `[Rerun failed job ➔](${apiUrl}/trigger/${params.owner}/${params.repo}/${params.runId}?action=rerun)`
    );
  }
  const footer = buildPullfrogFooter({
    triggeredBy: true,
    workflowRun: params.runId
      ? { owner: params.owner, repo: params.repo, runId: params.runId }
      : undefined,
    customParts,
  });
  return `${errorMessage}${footer}`;
}

type ValidateStuckCommentParams = {
  promptInput: JsonPromptInput | null;
  octokit: ReturnType<typeof createOctokit>;
  owner: string;
  repo: string;
};
async function validateStuckProgressComment(
  params: ValidateStuckCommentParams
): Promise<number | null> {
  if (!params.promptInput?.progressCommentId) {
    log.info("[post] no progressCommentId in prompt input, skipping cleanup");
    return null;
  }

  const commentId = parseInt(params.promptInput.progressCommentId, 10);
  log.info(`[post] validating progressCommentId from prompt input: ${commentId}`);

  try {
    const commentResult = await params.octokit.rest.issues.getComment({
      owner: params.owner,
      repo: params.repo,
      comment_id: commentId,
    });

    const body = commentResult.data.body ?? "";

    if (body.startsWith(LEAPING_INTO_ACTION_PREFIX)) {
      log.info(`[post] comment ${commentId} is stuck on "Leaping into action"`);
      return commentId;
    }

    // detect stranded todo checklists left by the tracker when the process was killed
    // before the agent could call report_progress with a final summary
    if (/^- \[[ x]\] |^- \*\*→\*\* |^- ~~/.test(body)) {
      log.info(`[post] comment ${commentId} is stuck on a todo checklist`);
      return commentId;
    }

    log.info(`[post] comment ${commentId} is not stuck (already updated or different content)`);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.info(`[post] failed to get comment ${commentId}: ${errorMessage}`);
    return null;
  }
}

type GetIsCancelledParams = {
  repoContext: ReturnType<typeof parseRepoContext>;
  octokit: ReturnType<typeof createOctokit>;
  runId: number | undefined;
};

async function getIsCancelled(params: GetIsCancelledParams): Promise<boolean> {
  if (!params.runId) return false; // can't check without a run ID — assume failure
  try {
    const jobsResult = await params.octokit.rest.actions.listJobsForWorkflowRun({
      owner: params.repoContext.owner,
      repo: params.repoContext.name,
      run_id: params.runId,
    });

    // find current job by matching GITHUB_JOB env var.
    // GITHUB_JOB is the job ID (yaml key), but job.name is the display name.
    // for matrix jobs, the name includes matrix values like "build (ubuntu-latest, node-18)"
    // so we match jobs that START with the job ID
    const currentJobName = process.env.GITHUB_JOB;
    const currentJob = currentJobName
      ? jobsResult.data.jobs.find(
          (j) => j.name === currentJobName || j.name.startsWith(`${currentJobName} (`)
        )
      : jobsResult.data.jobs[0]; // fallback to first job

    if (!currentJob) {
      log.warning("[post] could not find current job");
      return false;
    }

    log.info(`[post] job status: ${currentJob.status}, conclusion: ${currentJob.conclusion}`);
    if (currentJob.conclusion === "cancelled") return true; // whole job explicit cancellation

    // but if it's still null, check steps for cancellation:
    const cancelledStep = currentJob.steps?.find((step) => step.conclusion === "cancelled");
    if (cancelledStep) {
      log.info(`[post] found cancelled step: ${cancelledStep.name}`);
      return true;
    }
    log.info("[post] no cancellation found, assuming failure");
  } catch (error) {
    log.info(
      `[post] failed to get job status: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return false; // assuming failure
}

export async function runPostCleanup(): Promise<void> {
  log.info("» [post] starting post cleanup");

  const runId = process.env.GITHUB_RUN_ID
    ? Number.parseInt(process.env.GITHUB_RUN_ID, 10)
    : undefined;

  // resolve prompt input once and use it for both issue number and comment ID extraction
  // only use the object form (JSON payload), not plain string prompts
  let promptInput: JsonPromptInput | null = null;
  try {
    const resolved = resolvePromptInput();
    if (typeof resolved !== "string") promptInput = resolved;
  } catch (error) {
    log.info(
      `[post] failed to resolve prompt input: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // get job token for API calls
  const token = getJobToken();
  const repoContext = parseRepoContext();
  const octokit = createOctokit(token);

  const commentId = await validateStuckProgressComment({
    promptInput,
    octokit,
    owner: repoContext.owner,
    repo: repoContext.name,
  });

  if (!commentId) return log.info("» [post] no stuck progress comment to update, skipping cleanup");

  log.info(`» [post] validated stuck comment: ${commentId}, updating with error message`);

  try {
    const body = buildErrorCommentBody({
      owner: repoContext.owner,
      repo: repoContext.name,
      runId,
      isCancellation: SHOULD_CHECK_REASON
        ? await getIsCancelled({ octokit, repoContext, runId })
        : false,
    });

    await octokit.rest.issues.updateComment({
      owner: repoContext.owner,
      repo: repoContext.name,
      comment_id: commentId,
      body,
    });

    log.info("» [post] successfully updated progress comment");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.info(`[post] failed to update comment: ${errorMessage}`);
  }
}
