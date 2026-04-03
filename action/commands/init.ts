import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { modelAliases, type ProviderConfig, providers } from "../models.ts";

const PULLFROG_API_URL = (process.env.PULLFROG_API_URL || "https://pullfrog.com").replace(
  /\/+$/,
  ""
);
const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG || "pullfrog";
const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/select_target`;

type CliProvider = {
  id: string;
  name: string;
  envVars: readonly string[];
  models: { value: string; label: string; hint?: string | undefined }[];
};

function buildProviders(): CliProvider[] {
  return Object.entries(providers)
    .filter(([key]) => key !== "opencode" && key !== "openrouter")
    .map(([key, config]: [string, ProviderConfig]) => {
      const aliases = modelAliases.filter((a) => a.provider === key);
      const recommended = aliases.find((a) => a.preferred);
      const sorted = [...aliases].sort((a, b) => {
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;
        return 0;
      });
      return {
        id: key,
        name: config.displayName,
        envVars: config.envVars,
        models: sorted.map((a) => ({
          value: a.slug,
          label: a.displayName,
          hint: a === recommended ? "recommended" : undefined,
        })),
      };
    });
}

const CLI_PROVIDERS = buildProviders();

// ── helpers ──

// active spinner reference so bail/catch can clean up the terminal
let activeSpin: ReturnType<typeof p.spinner> | null = null;

function bail(msg: string): never {
  if (activeSpin) {
    activeSpin.stop(pc.red("failed"));
    activeSpin = null;
  }
  p.cancel(msg);
  process.exit(1);
}

function handleCancel<T>(value: T | symbol): asserts value is T {
  if (p.isCancel(value)) {
    if (activeSpin) {
      activeSpin.stop(pc.red("cancelled"));
      activeSpin = null;
    }
    p.cancel("setup cancelled.");
    process.exit(0);
  }
}

function getGhToken(): string {
  let token: string;
  try {
    token = execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    bail(
      `gh cli not found or not authenticated.\n` +
        `  ${pc.dim("install:")} https://cli.github.com\n` +
        `  ${pc.dim("then:")}    gh auth login`
    );
  }
  if (!token) {
    bail(
      `gh cli returned an empty token. try re-authenticating:\n` +
        `  ${pc.dim("run:")} gh auth login`
    );
  }
  return token;
}

type GhApiResult<T = unknown> = { data: T; scopes: string | null };

async function ghApi<T = unknown>(path: string, token: string): Promise<GhApiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`github api ${path} returned ${response.status}: ${body}`);
    }

    const data = (await response.json().catch(() => {
      throw new Error(`github api ${path} returned non-JSON response`);
    })) as T;
    return { data, scopes: response.headers.get("x-oauth-scopes") };
  } finally {
    clearTimeout(timeout);
  }
}

function parseGitRemote(): { owner: string; repo: string } {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8" }).trim();
  } catch {
    bail("not a git repository or no 'origin' remote found.");
  }

  const match = url.match(/github\.com(?::\d+)?[:/]+([^/]+)\/(.+?)(?:\.git)?(?:\/)?$/);
  if (!match) bail(`could not parse github owner/repo from remote: ${url}`);
  return { owner: match[1], repo: match[2] };
}

function openBrowser(url: string) {
  try {
    const platform = process.platform;
    if (platform === "darwin") execFileSync("open", [url], { stdio: "ignore" });
    else if (platform === "win32")
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else execFileSync("xdg-open", [url], { stdio: "ignore" });
  } catch {
    // headless/SSH — user will open the URL manually
  }
}

// ── Pullfrog API ──

type SecretsApiData = {
  error?: string;
  ownerHasInstallation?: boolean;
  isOrg?: boolean;
  accessible?: boolean;
  repoSecrets?: string[];
  orgSecrets?: string[];
  pullfrogSecrets?: string[];
};

type SessionApiData = {
  id?: string;
  installed?: boolean;
  error?: string;
};

type SetupApiData = {
  error?: string;
  success?: boolean;
  already_existed?: boolean;
  pull_request_url?: string;
};

type ApiResult<T = Record<string, unknown>> = { ok: boolean; status: number; data: T };

async function pullfrogApi<T = Record<string, unknown>>(ctx: {
  path: string;
  token: string;
  method?: string;
  body?: Record<string, unknown>;
}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${ctx.token}` };
  if (ctx.body) headers["content-type"] = "application/json";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${PULLFROG_API_URL}${ctx.path}`, {
      method: ctx.method || "GET",
      headers,
      body: ctx.body ? JSON.stringify(ctx.body) : null,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T;
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

type SecretsResult = {
  installed: boolean;
  ownerHasInstallation: boolean;
  secretsAccessible: boolean;
  repoSecrets: string[];
  orgSecrets: string[];
  pullfrogSecrets: string[];
  isOrg: boolean;
};

async function checkSecrets(ctx: {
  token: string;
  owner: string;
  repo: string;
}): Promise<SecretsResult> {
  const result = await pullfrogApi<SecretsApiData>({
    path: `/api/cli/secrets?owner=${encodeURIComponent(ctx.owner)}&repo=${encodeURIComponent(ctx.repo)}`,
    token: ctx.token,
  });

  if (!result.ok) {
    const errorMsg = result.data.error || "";
    if (
      result.status === 404 &&
      (errorMsg.includes("not installed") || errorMsg.includes("does not have access"))
    ) {
      return {
        installed: false,
        ownerHasInstallation: result.data.ownerHasInstallation === true,
        secretsAccessible: false,
        repoSecrets: [],
        orgSecrets: [],
        pullfrogSecrets: [],
        isOrg: result.data.isOrg === true,
      };
    }
    if (result.status === 401) bail("invalid or expired github token.");
    if (result.status === 404) bail("repository not found.");
    bail(errorMsg || `secrets check failed (${result.status})`);
  }

  return {
    installed: true,
    ownerHasInstallation: true,
    secretsAccessible: result.data.accessible !== false,
    repoSecrets: result.data.repoSecrets || [],
    orgSecrets: result.data.orgSecrets || [],
    pullfrogSecrets: result.data.pullfrogSecrets || [],
    isOrg: result.data.isOrg === true,
  };
}

// ── sessions ──

async function createSession(ctx: { token: string; owner: string; repo: string }): Promise<string> {
  const result = await pullfrogApi<SessionApiData>({
    path: "/api/cli/session",
    token: ctx.token,
    method: "POST",
    body: { owner: ctx.owner.toLowerCase(), repo: ctx.repo.toLowerCase() },
  });
  if (!result.ok || !result.data.id) bail(result.data.error || "failed to create cli session.");
  return result.data.id;
}

async function pollSession(ctx: { token: string; sessionId: string }): Promise<boolean> {
  const result = await pullfrogApi<SessionApiData>({
    path: `/api/cli/session/${ctx.sessionId}`,
    token: ctx.token,
  });
  if (!result.ok) return false;
  return result.data.installed === true;
}

function cleanupSession(ctx: { token: string; sessionId: string }) {
  void pullfrogApi({
    path: `/api/cli/session/${ctx.sessionId}`,
    token: ctx.token,
    method: "DELETE",
  }).catch(() => {});
}

// ── installation ──

const POLL_INTERVAL_MS = 2000;
const FALLBACK_EVERY_N = 7;

async function ensureInstallation(ctx: {
  token: string;
  owner: string;
  repo: string;
}): Promise<SecretsResult> {
  activeSpin!.start("checking pullfrog app installation");

  const initial = await checkSecrets(ctx);
  if (initial.installed) {
    activeSpin!.stop("pullfrog app is installed");
    return initial;
  }

  // register a session so the installation webhook can signal us via the DB
  // instead of polling the GitHub API on every tick
  const sessionId = await createSession(ctx);

  if (initial.ownerHasInstallation) {
    activeSpin!.stop(`pullfrog app doesn't have access to ${pc.bold(`${ctx.owner}/${ctx.repo}`)}`);
    const configUrl = initial.isOrg
      ? `https://github.com/organizations/${ctx.owner}/settings/installations`
      : `https://github.com/settings/installations`;
    p.log.info(
      `add this repo to your existing pullfrog installation:\n` +
        `  ${configUrl} ${pc.dim("→ Pullfrog → Configure → add repo")}`
    );
    openBrowser(configUrl);
  } else {
    activeSpin!.stop("pullfrog app not installed");
    const installUrl = `${GITHUB_APP_INSTALL_URL}?state=cli`;
    p.log.info(`opening browser to install...\n  ${pc.dim(installUrl)}`);
    openBrowser(installUrl);
  }

  activeSpin!.start("waiting for installation — complete the setup in your browser");

  // after a false positive (session resolved but repo not in scope), stop trusting
  // the session signal and fall back to the GitHub API on a slower cadence.
  let sessionFalsePositive = false;

  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    activeSpin!.message(`waiting for installation ${pc.dim(`(${i + 1}/${maxAttempts})`)}`);
    try {
      // fast path: check the DB session (lightweight, no GitHub API call).
      // skip if we already got a false positive — avoid hammering checkSecrets every tick.
      if (!sessionFalsePositive) {
        const sessionResolved = await pollSession({ token: ctx.token, sessionId });
        if (sessionResolved) {
          const secrets = await checkSecrets(ctx);
          if (secrets.installed) {
            cleanupSession({ token: ctx.token, sessionId });
            activeSpin!.stop("pullfrog app installed");
            return secrets;
          }
          sessionFalsePositive = true;
        }
      }

      // fallback: check GitHub API directly every ~15s in case the webhook
      // was delayed, dropped, or the session was prematurely resolved.
      if (i > 0 && i % FALLBACK_EVERY_N === 0) {
        const fallback = await checkSecrets(ctx);
        if (fallback.installed) {
          cleanupSession({ token: ctx.token, sessionId });
          activeSpin!.stop("pullfrog app installed");
          return fallback;
        }
      }
    } catch {
      // transient network error — keep polling
    }
  }

  cleanupSession({ token: ctx.token, sessionId });
  bail(
    "timed out waiting for app installation.\n" +
      `  ${pc.dim("if your org requires admin approval, ask an admin to approve,")}\n` +
      `  ${pc.dim("then re-run:")} npx pullfrog init`
  );
}

// ── secret management ──

type StorageMethod = "pullfrog" | "github";
type SecretScope = "account" | "repo";

type SecretSetResult = { saved: boolean; orgFailed: boolean };

function setGhSecret(ctx: {
  name: string;
  value: string;
  org: string | null;
  repoSlug: string;
}): SecretSetResult {
  let orgFailed = false;

  if (ctx.org) {
    try {
      execFileSync("gh", ["secret", "set", ctx.name, "--org", ctx.org, "--visibility", "all"], {
        input: ctx.value,
        stdio: ["pipe", "ignore", "pipe"],
        encoding: "utf-8",
      });
      return { saved: true, orgFailed: false };
    } catch {
      orgFailed = true;
    }
  }

  try {
    execFileSync("gh", ["secret", "set", ctx.name, "--repo", ctx.repoSlug], {
      input: ctx.value,
      stdio: ["pipe", "ignore", "pipe"],
      encoding: "utf-8",
    });
    return { saved: true, orgFailed };
  } catch {
    return { saved: false, orgFailed };
  }
}

type PullfrogSecretResult = { saved: boolean; error: string };

async function setPullfrogSecret(ctx: {
  token: string;
  owner: string;
  repo: string;
  name: string;
  value: string;
  scope: SecretScope;
}): Promise<PullfrogSecretResult> {
  const result = await pullfrogApi<{ success?: boolean; error?: string }>({
    path: "/api/cli/secrets",
    token: ctx.token,
    method: "POST",
    body: {
      owner: ctx.owner,
      repo: ctx.repo,
      name: ctx.name,
      value: ctx.value,
      scope: ctx.scope,
    },
  });
  if (result.ok && result.data.success === true) {
    return { saved: true, error: "" };
  }
  return { saved: false, error: result.data.error || `api returned ${result.status}` };
}

async function promptScope(ctx: { owner: string; repo: string }): Promise<SecretScope> {
  const scope = await p.select<SecretScope>({
    message: "secret scope",
    options: [
      { value: "account", label: `${ctx.owner} organization`, hint: "shared across repos" },
      { value: "repo", label: `${ctx.owner}/${ctx.repo} only` },
    ],
  });
  handleCancel(scope);
  return scope;
}

async function handleSecret(ctx: {
  token: string;
  owner: string;
  repo: string;
  provider: CliProvider;
  secrets: SecretsResult;
}): Promise<void> {
  const primaryEnvVar = ctx.provider.envVars[0];
  const repoSecretsUrl = `https://github.com/${ctx.owner}/${ctx.repo}/settings/secrets/actions`;

  // pullfrog secrets are always checkable (our own DB); GitHub secrets only when accessible
  const allKnownSecrets = [...ctx.secrets.pullfrogSecrets];
  if (ctx.secrets.secretsAccessible) {
    allKnownSecrets.push(...ctx.secrets.repoSecrets, ...ctx.secrets.orgSecrets);
  }
  const foundEnvVar = ctx.provider.envVars.find((v) => allKnownSecrets.includes(v));

  if (foundEnvVar) {
    p.log.success(`${pc.bold(foundEnvVar)} is already configured`);
    return;
  }

  if (!ctx.secrets.secretsAccessible) {
    p.log.info(`could not verify GitHub secrets (app lacks permission)`);
  }

  const method = await p.select<StorageMethod>({
    message: `where should ${pc.bold(primaryEnvVar)} be stored?`,
    options: [
      {
        value: "pullfrog",
        label: "Pullfrog",
        hint: "recommended — auto-injected, no workflow changes",
      },
      {
        value: "github",
        label: "GitHub Actions secret",
        hint: "requires env block in pullfrog.yml",
      },
    ],
  });
  handleCancel(method);

  const apiKey = await p.password({
    message: `paste your ${ctx.provider.name} API key ${pc.dim("(Enter to skip)")}`,
    mask: "*",
    validate: () => undefined,
  });
  handleCancel(apiKey);

  if (!apiKey) {
    p.log.info(
      `skipped — set it manually at:\n  ${pc.dim(method === "pullfrog" ? `${PULLFROG_API_URL}/console/${ctx.owner}` : repoSecretsUrl)}`
    );
    return;
  }

  if (method === "pullfrog") {
    const scope: SecretScope = ctx.secrets.isOrg ? await promptScope(ctx) : "account";

    activeSpin!.start(`saving ${primaryEnvVar}`);
    let saveResult: PullfrogSecretResult;
    try {
      saveResult = await setPullfrogSecret({
        token: ctx.token,
        owner: ctx.owner,
        repo: ctx.repo,
        name: primaryEnvVar,
        value: apiKey,
        scope,
      });
    } catch (error) {
      activeSpin!.stop(pc.red("could not save secret"));
      p.log.warn(
        `${error instanceof Error ? error.message : "network error"}\n  ${pc.dim("set it manually at:")} ${PULLFROG_API_URL}/console/${ctx.owner}`
      );
      return;
    }

    if (saveResult.saved) {
      const scopeLabel = ctx.secrets.isOrg ? (scope === "repo" ? "repo secret" : "org secret") : "";
      activeSpin!.stop(`${pc.bold(primaryEnvVar)} saved${scopeLabel ? ` as ${scopeLabel}` : ""}`);
    } else {
      activeSpin!.stop(pc.red("could not save secret"));
      p.log.warn(
        `${saveResult.error}\n  ${pc.dim("set it manually at:")} ${PULLFROG_API_URL}/console/${ctx.owner}`
      );
    }
    return;
  }

  // github actions secret path
  let org: string | null = null;
  if (ctx.secrets.isOrg) {
    const scope = await promptScope(ctx);
    org = scope === "account" ? ctx.owner : null;
  }

  const secretsUrl = org
    ? `https://github.com/organizations/${org}/settings/secrets/actions`
    : repoSecretsUrl;

  activeSpin!.start(`saving ${primaryEnvVar}`);
  const secretResult = setGhSecret({
    name: primaryEnvVar,
    value: apiKey,
    org,
    repoSlug: `${ctx.owner}/${ctx.repo}`,
  });
  if (secretResult.saved) {
    activeSpin!.stop(
      `${pc.bold(primaryEnvVar)} saved${org && !secretResult.orgFailed ? ` to ${pc.dim(ctx.owner)} org` : ""}`
    );
    if (secretResult.orgFailed) {
      p.log.warn("org secret failed (admin access required) — saved as repo secret instead");
    }
  } else {
    activeSpin!.stop(pc.red("could not set secret"));
    p.log.warn(`set it manually at:\n  ${pc.dim(secretsUrl)}`);
  }
}

// ── main ──

async function main() {
  p.intro(pc.bgGreen(pc.black(" pullfrog ")));

  const spin = p.spinner();
  activeSpin = spin;

  // 1. authenticate
  spin.start("authenticating with github");
  const token = getGhToken();
  const userResult = await ghApi<{ login: string }>("/user", token);
  const user = userResult.data;

  // gho_ tokens from `gh auth login` expose scopes via x-oauth-scopes header.
  // fine-grained PATs (github_pat_) don't return scopes — they pass this check.
  // split on ", " and match exact scope — .includes("repo") would false-positive on "public_repo"
  const scopeSet = userResult.scopes !== null ? new Set(userResult.scopes.split(", ")) : null;
  if (scopeSet !== null && !scopeSet.has("repo")) {
    bail(
      `your token is missing the ${pc.bold('"repo"')} scope.\n` +
        `  ${pc.dim("run:")} gh auth refresh --scopes repo\n` +
        `  ${pc.dim("then:")} npx pullfrog init`
    );
  }

  spin.stop(`hello, ${pc.green(`@${user.login}`)}`);

  // 2. detect repo
  spin.start("detecting repository");
  const remote = parseGitRemote();
  spin.stop(`repository ${pc.green(`${remote.owner}/${remote.repo}`)}`);

  // 3. ensure app installation (also returns secret data)
  const secrets = await ensureInstallation({ token, owner: remote.owner, repo: remote.repo });

  // 4. select provider + model
  const providerId = await p.select({
    message: "select your LLM provider",
    options: CLI_PROVIDERS.map((provider) => ({
      value: provider.id,
      label: provider.name,
    })),
  });
  handleCancel(providerId);

  const provider = CLI_PROVIDERS.find((cp) => cp.id === providerId);
  if (!provider) bail(`unknown provider: ${providerId}`);

  let model: string;
  if (provider.models.length === 1) {
    model = provider.models[0].value;
    p.log.info(`using ${pc.bold(provider.models[0].label)}`);
  } else {
    const recommendedModel = provider.models.find((m) => m.hint === "recommended");
    const options = provider.models.map((m) => {
      if (m.hint) return { value: m.value, label: m.label, hint: m.hint };
      return { value: m.value, label: m.label };
    });
    const selected = await p.select(
      recommendedModel
        ? { message: "select model", initialValue: recommendedModel.value, options }
        : { message: "select model", options }
    );
    handleCancel(selected);
    model = selected;
  }

  // 5. check/set secret
  await handleSecret({ token, owner: remote.owner, repo: remote.repo, provider, secrets });

  // 6. create workflow
  spin.start("creating pullfrog.yml workflow");

  const result = await pullfrogApi<SetupApiData>({
    path: "/api/cli/setup",
    token,
    method: "POST",
    body: { owner: remote.owner, repo: remote.repo, model },
  });

  if (!result.ok) {
    bail(result.data.error || `api returned ${result.status}`);
  }

  if (result.data.already_existed) {
    spin.stop("pullfrog.yml already exists");
  } else if (result.data.pull_request_url) {
    spin.stop("created pull request with pullfrog.yml");
    p.log.info(`PR: ${pc.dim(result.data.pull_request_url)}`);
  } else {
    spin.stop("pullfrog.yml committed");
  }

  activeSpin = null;
  p.outro(`${pc.green("pullfrog is ready")} on ${pc.bold(`${remote.owner}/${remote.repo}`)}`);
}

export async function run() {
  try {
    await main();
  } catch (error) {
    if (activeSpin) {
      activeSpin.stop(pc.red("failed"));
      activeSpin = null;
    }
    const msg =
      error instanceof Error && error.name === "AbortError"
        ? "request timed out — check your network connection and try again"
        : error instanceof Error
          ? error.message
          : String(error);
    p.log.error(msg);
    process.exit(1);
  }
}
