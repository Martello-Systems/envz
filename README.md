# envz

**lazygit for your `.env` files.** A monorepo-native TUI to browse, diff, and sync
environment variables across the packages and profiles of a JS monorepo.

Most `.env` tooling treats your repo as one flat folder. Real JS monorepos
(Turborepo, pnpm workspaces, npm/yarn workspaces) have a `.env` per package plus
a root one, each with its own `.env.example`. Keys drift. Someone adds
`ANALYTICS_KEY` to `.env.example` and forgets to tell you. `envz` shows the whole
landscape at a glance and lets you fill a missing key straight from a sibling
package that already has it.

> Out of scope by design: `envz` does **not** store, encrypt, or sync secrets to
> a vault. It reads the `.env` files already on your disk. (That's Infisical's
> job, not ours.)

## The monorepo angle

`envz` reads your `pnpm-workspace.yaml` and/or `package.json` `"workspaces"`,
resolves the package globs, and groups every `.env*` file by the package it
lives in. For each package it diffs the real `.env` against its `.env.example`
and classifies every key:

| status      | meaning                                            |
| ----------- | -------------------------------------------------- |
| ✓ `present` | in `.env.example` and set in `.env`                |
| ✗ `missing` | in `.env.example`, absent from `.env`              |
| ○ `empty`   | in `.env.example`, present in `.env` but blank     |
| + `extra`   | in `.env` but not declared in `.env.example`       |

## Install

```bash
npm install -g envz
# or run without installing:
npx envz
```

Requires Node 18+.

## Usage

```bash
envz                 # launch the TUI in the current workspace
envz path/to/repo    # launch the TUI in a specific workspace

envz summary         # one-line headline: "3 packages, 1 missing key, 3 drifted"
envz check           # CI-friendly check; non-zero exit if a required key is missing
envz check --allow-empty     # treat blank values as acceptable
envz check --fail-on-extra   # also fail on keys not in .env.example
envz --help
```

### In CI

```yaml
# fail the build if any required env key is missing or blank
- run: npx envz check
```

`envz check` prints a per-package report and exits `1` when any key declared in a
`.env.example` is missing (or empty, unless `--allow-empty`).

## The TUI

Three panes: **package tree → that package's keys → the diff detail**. Drifted
packages are flagged in red; missing keys are highlighted. Press `f` on a
missing/empty key to fill it from a sibling package that already has a value for
it — existing values are never overwritten.

```
envz monorepo
╭──────────────────────────╮╭────────────────────────────────╮╭────────────────────────────────────╮
│ Packages                 ││ @fixture/web                   ││ Detail                             │
│ ○ (root)                 ││ ✓ NEXT_PUBLIC_API_URL          ││ key:    ANALYTICS_KEY              │
│ ○ packages/api           ││ ✓ NEXT_PUBLIC_SITE_NAME        ││ status: missing                    │
│ ● packages/web (2)       ││ ✗ ANALYTICS_KEY                ││ value:  (none)                     │
│                          ││ ○ FEATURE_FLAG_BETA            ││ press f to fill from a sibling     │
╰──────────────────────────╯╰────────────────────────────────╯╰────────────────────────────────────╯
↑/↓ or j/k move · Tab switch pane · f fill · r refresh · q quit
```

### Keybindings

| key             | action                          |
| --------------- | ------------------------------- |
| `↑`/`↓` or `j`/`k` | move within the active pane  |
| `Tab`           | switch between packages / keys  |
| `→` / `Enter`   | descend into a package's keys   |
| `←`             | back to the package list        |
| `f`             | fill the selected missing/empty key from a sibling |
| `r`             | re-scan the workspace           |
| `q`             | quit                            |

## How "fill from sibling" works

When you press `f` on a missing or empty key, `envz` looks for another package
in the same workspace whose `.env` has a non-empty value for that key, and writes
it into the target's `.env` (preserving comments, ordering, and any `export`
prefixes). It will **never** overwrite a value you've already set. This is the
non-destructive `fillFromSibling` operation, the same one covered by the tests.

## Programmatic API

The domain logic is pure and exported for reuse:

```js
import { discover, parseEnv, diff, summarize, fillFromSibling } from "envz";

const s = await summarize(process.cwd());
console.log(s.missingTotal, s.driftedPackages);
```

## Development

```bash
npm install
npm test        # node:test — pure domain logic + a TUI smoke test
```

The correctness proof lives in `test/` against a fake monorepo fixture under
`test/fixtures/monorepo/` (root + `packages/web` + `packages/api`, exercising
missing / empty / extra / present cases).

## License

MIT © 2026 Martello Systems
