#!/usr/bin/env node
import process from "node:process";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];

const HELP = `envz — lazygit for your .env files

Usage:
  envz [path]            Launch the interactive TUI (default: current dir)
  envz check [path]      Non-interactive CI check; exits non-zero on missing keys
  envz summary [path]    Print a one-line workspace summary
  envz --help            Show this help

Options for 'check':
  --allow-empty          Don't fail on present-but-empty keys
  --fail-on-extra        Also fail when env has keys not in .env.example

The monorepo angle: envz understands pnpm-workspace.yaml and package.json
"workspaces", groups .env files by package, and diffs each against its
.env.example so you can see missing/empty/extra keys across the whole repo.`;

function resolveRoot(positional) {
  return path.resolve(positional || ".");
}

async function main() {
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return;
  }

  if (cmd === "check") {
    const { check } = await import("../src/check.js");
    const positional = args.slice(1).find((a) => !a.startsWith("-"));
    const root = resolveRoot(positional);
    const result = await check(root, {
      allowEmpty: args.includes("--allow-empty"),
      failOnExtra: args.includes("--fail-on-extra"),
    });
    console.log(result.lines.join("\n"));
    process.exit(result.ok ? 0 : 1);
  }

  if (cmd === "summary") {
    const { summarize, headline } = await import("../src/summarize.js");
    const positional = args.slice(1).find((a) => !a.startsWith("-"));
    const s = await summarize(resolveRoot(positional));
    console.log(headline(s));
    return;
  }

  // default: launch TUI. First positional (if any) is the workspace path.
  const positional = args.find((a) => !a.startsWith("-"));
  const root = resolveRoot(positional);

  const [{ render }, React, { default: App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("../src/tui/App.js"),
  ]);

  if (!process.stdout.isTTY) {
    console.error("envz: no TTY detected. Use `envz check` or `envz summary` for non-interactive output.");
    process.exit(2);
  }

  const { waitUntilExit } = render(React.createElement(App, { root }));
  await waitUntilExit();
}

main().catch((err) => {
  console.error("envz error:", err && err.message ? err.message : err);
  process.exit(1);
});
