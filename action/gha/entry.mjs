import { execSync } from "node:child_process";
execSync("npx -y pullfrog gha", {
  stdio: "inherit",
  env: { ...process.env, npm_config_registry: "https://registry.npmjs.org" },
});
