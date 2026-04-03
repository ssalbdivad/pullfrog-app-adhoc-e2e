import { log } from "./cli.ts";

function isLocalUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * resolve the Pullfrog API base URL.
 *
 * in the action: API_URL is not explicitly set, so this falls back to https://pullfrog.com.
 * in local dev: API_URL=http://localhost:3000 (from .env).
 *
 * enforces https:// for non-local URLs to prevent cleartext credential transmission.
 */
export function getApiUrl(): string {
  const raw = process.env.API_URL || "https://pullfrog.com";
  const parsed = new URL(raw);

  if (parsed.protocol !== "https:" && !isLocalUrl(parsed)) {
    throw new Error(
      `API_URL must use https:// (got ${parsed.protocol}). only localhost is exempt.`
    );
  }

  log.debug(`resolved API_URL: ${raw}`);
  return raw;
}
