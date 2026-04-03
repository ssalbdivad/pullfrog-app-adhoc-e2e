import { execSync } from "node:child_process";
try {
  execSync("npx -y pullfrog gha --post", {
    stdio: "inherit",
    env: { ...process.env, npm_config_registry: "https://registry.npmjs.org" },
  });
} catch {
  // best-effort cleanup
}
