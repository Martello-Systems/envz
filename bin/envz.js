#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { stat } from "node:fs/promises";

const args = process.argv.slice(2);
const cmd = args[0];

const HELP = `envz — lazygit for your .env files

Usage:
  envz [path]            Launch the interactive TUI (default: current dir)
  envz check [path]      Non-interactive CI check; exits non-zero on missing keys
  envz summary [path]    Print a one-line workspace summary
  envz --help            Show this help

Options for 'check':
  --json                 Emit a machine-readable JSON report (CI-friendly)
  --allow-empty          Don't fail on present-but-empty keys
  --fail-on-extra        Also fail when env has keys not in .env.example

The monorepo angle: envz understands pnpm-workspace.yaml and package.json
"workspaces", groups .env files by package, and diffs each against its
.env.example so you can see missing/empty/extra keys across the whole repo.`;

function resolveRoot(positional) {
  return path.resolve(positional || ".");
}

/** Fail cleanly if the target path is missing or not a directory. */
async function assertDir(root) {
  let st;
  try {
    st = await stat(root);
  } catch {
    throw new UserError(`path not found: ${root}`);
  }
  if (!st.isDirectory()) {
    throw new UserError(`not a directory: ${root}`);
  }
}

class UserError extends Error {}

async function main() {
  if (cmd === "--help" || cmd === "-h" || cmd === "help" || args.includes("--help")) {
    console.log(HELP);
    return;
  }

  if (cmd === "check") {
    const positional = args.slice(1).find((a) => !a.startsWith("-"));
    const root = resolveRoot(positional);
    await assertDir(root);
    const opts = {
      allowEmpty: args.includes("--allow-empty"),
      failOnExtra: args.includes("--fail-on-extra"),
    };

    if (args.includes("--json")) {
      const { checkReport } = await import("../src/check.js");
      const report = await checkReport(root, opts);
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.ok ? 0 : 1);
    }

    const { check } = await import("../src/check.js");
    const result = await check(root, opts);
    console.log(result.lines.join("\n"));
    process.exit(result.ok ? 0 : 1);
  }

  if (cmd === "summary") {
    const positional = args.slice(1).find((a) => !a.startsWith("-"));
    const root = resolveRoot(positional);
    await assertDir(root);
    const { summarize, headline } = await import("../src/summarize.js");
    const s = await summarize(root);
    console.log(headline(s));
    return;
  }

  // default: launch TUI. First positional (if any) is the workspace path.
  const positional = args.find((a) => !a.startsWith("-"));
  const root = resolveRoot(positional);
  try {
    await assertDir(root);
  } catch (err) {
    // A non-flag first arg that isn't an existing path is likely a typo'd command.
    if (positional && !path.isAbsolute(positional) && !positional.includes(path.sep) && !positional.startsWith(".")) {
      throw new UserError(`unknown command "${positional}". Run \`envz --help\` to see available commands.`);
    }
    throw err;
  }

  if (!process.stdout.isTTY) {
    console.error("envz: no TTY detected. Use `envz check` or `envz summary` for non-interactive output.");
    process.exit(2);
  }

  const [{ render }, React, { default: App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("../src/tui/App.js"),
  ]);

  const { waitUntilExit } = render(React.createElement(App, { root }));
  await waitUntilExit();
}

main().catch((err) => {
  console.error("envz error:", err && err.message ? err.message : err);
  process.exit(1);
});
