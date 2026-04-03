import { basename } from "node:path";
import pc from "picocolors";

const VERSION = process.env.CLI_VERSION ?? "0.0.0";
const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(flag);
const bin = basename(process.argv[1] || "");
const PROG = bin === "pf" || bin === "pullfrog" ? bin : "pullfrog";

function printUsage(stream: typeof console.log) {
  stream(`usage: ${PROG} <command>\n`);
  stream("commands:");
  stream("  init    set up pullfrog on the current repository");
  stream("  gha     run the github action agent loop");
}

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`${pc.bold("pullfrog")} v${VERSION}\n`);
  printUsage(console.log);
  process.exit(0);
}

if (hasFlag("--version") || hasFlag("-v")) {
  console.log(VERSION);
  process.exit(0);
}

const command = args.find((a) => !a.startsWith("-"));

switch (command) {
  case "init":
    await import("./commands/init.ts").then((m) => m.run());
    break;
  case "gha":
    await import("./commands/gha.ts").then((m) => m.run(args));
    break;
  default:
    if (command) {
      console.error(`unknown command: ${pc.bold(command)}\n`);
    }
    printUsage(command ? console.error : console.log);
    process.exit(command ? 1 : 0);
}
