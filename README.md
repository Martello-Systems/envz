# envz

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE) [![Built by Martello Systems](https://img.shields.io/badge/built%20by-Martello%20Systems-0b0b14)](https://martellosystems.com)

**lazygit for your `.env` files.** A monorepo-native TUI to browse, diff, and sync
environment variables across the packages and profiles of a JS monorepo.

Most `.env` tooling treats your repo as one flat folder. Real JS monorepos
(pnpm workspaces, npm/yarn workspaces) have a `.env` per package plus
a root one, each with its own `.env.example`. Keys drift. Someone adds
`ANALYTICS_KEY` to `.env.example` and forgets to tell you. `envz` shows the whole
landscape at a glance and lets you fill a missing key straight from a sibling
package that already has it.

> Out of scope by design: `envz` does **not** store, encrypt, or sync secrets to
> a vault. It reads the `.env` files already on your disk. (That's Infisical's
> job, not ours.)

<!-- demo: replace with an asciinema/GIF of `envz` navigating a monorepo and filling a key -->
<!-- ![envz demo](docs/demo.gif) -->
_(Demo GIF coming soon.)_

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
npm install -g @martello-systems/envz
# or run without installing:
npx @martello-systems/envz
```

Requires Node 18+.

## Usage

```bash
envz                 # launch the TUI in the current workspace
envz path/to/repo    # launch the TUI in a specific workspace

envz summary         # one-line headline: "3 packages, 1 missing key, 3 drifted"
envz check           # CI-friendly check; non-zero exit if a required key is missing
envz check --json            # machine-readable report (see shape below)
envz check --allow-empty     # treat blank values as acceptable
envz check --fail-on-extra   # also fail on keys not in .env.example
envz check --profiles        # also print the per-profile breakdown per package
envz audit           # flag .env files with real values that git tracks / doesn't ignore
envz audit --json            # machine-readable audit report
envz --help
```

### In CI

```yaml
# fail the build if any required env key is missing or blank
- run: npx @martello-systems/envz check

# or consume the JSON report in your own tooling
- run: npx @martello-systems/envz check --json > env-report.json
```

`envz check` prints a per-package report and exits `1` when any key declared in a
`.env.example` is missing (or empty, unless `--allow-empty`). It exits `2` if the
target path doesn't exist.

### `check --json`

`envz check --json` emits a stable, machine-readable report and uses the same
exit code as the text check (`0` = clean, `1` = drift). Shape:

```jsonc
{
  "ok": false,
  "root": "/abs/path/to/workspace",
  "summary": { "packages": 3, "missing": 1, "empty": 1, "extra": 2, "driftedPackages": 3 },
  "failures": 2,                       // count that drove the non-zero exit
  "options": { "allowEmpty": false, "failOnExtra": false },
  "packages": [
    {
      "name": "@acme/web",
      "relDir": "packages/web",
      "isRoot": false,
      "hasExample": true,
      "hasEnv": true,
      "exampleFile": "packages/web/.env.example",
      "envFile": "packages/web/.env",
      "missing": ["ANALYTICS_KEY"],
      "empty": ["FEATURE_FLAG_BETA"],
      "extra": [],
      "present": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_NAME"],
      "profiles": [
        {
          "profile": "default",
          "templateFile": "packages/web/.env.example",
          "layers": [".env"],
          "missing": ["ANALYTICS_KEY"],
          "empty": ["FEATURE_FLAG_BETA"],
          "extra": [],
          "present": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_NAME"]
        }
      ]
    }
  ]
}
```

`failures` reflects the active flags: `--allow-empty` drops `empty` from the
count, `--fail-on-extra` adds `extra`. Every package carries a `profiles` array
with the full per-profile breakdown (`default` plus any named profiles like
`production`); `failures`/`summary` still roll up the **default** profile. Add
`--profiles` to the text check to print that breakdown too.

### `envz audit` — did a secret get committed?

`envz audit` is the `.env`-tooling take on the classic "oops, the real `.env`
is in the repo" mistake. It scans every **real** (non-template) `.env*` file
that holds a non-empty value and flags the ones git would carry: either already
**tracked**, or sitting **un-gitignored** where the next `git add .` sweeps them
in. Template files (`.env.example` / `.sample` / `.template` / `.dist`) are
skipped — they're meant to be committed. Exits `1` if anything is at risk, `0`
when clean, so it drops straight into CI:

```yaml
- run: npx @martello-systems/envz audit   # fail the build if a real .env is committable
```

It reports only file paths and a value *count*, never the secret values
themselves. Outside a git work tree it reports cleanly and exits `0` (it can't
know what's tracked).

## Profiles & precedence

Real repos don't just have `.env` and `.env.example`. They have `.env.local`,
`.env.production`, `.env.production.local`, profile-specific templates, and so
on. `envz` groups every file into a **profile** (a named environment) and applies
one explicit precedence rule per profile, matching what Next.js / `dotenv-flow`
actually load at runtime.

**Filename → profile**

| filename | profile | kind |
| --- | --- | --- |
| `.env` | `default` | real |
| `.env.local` | `default` | real (local override) |
| `.env.example` / `.sample` / `.template` / `.dist` | `default` | template |
| `.env.production` | `production` | real |
| `.env.production.local` | `production` | real (local override) |
| `.env.production.example` | `production` | template |

`.local` is an **override layer**, not its own profile: `.env.local` layers on
top of `.env` (default profile); `.env.<p>.local` layers on top of `.env.<p>`.

**Effective-value precedence** (highest wins):

```
default profile:     .env.local  >  .env
named profile <p>:    .env.<p>.local  >  .env.local  >  .env.<p>  >  .env
```

A key counts as **satisfied** if any layer in the profile provides a non-empty
value, so a secret you keep only in `.env.local` correctly clears the
"missing/empty" flag for that key.

**Required keys** for a profile come from its template, preferring the
profile-specific `.env.<p>.example` and falling back to the default
`.env.example`.

`envz check` / `envz summary` report on the **default** profile (the common
case). The full per-profile breakdown is available programmatically via
`analyze()` (`pkg.profiles`).

### Filling a key from a sibling

When you press `f`, `envz` looks across **sibling packages** in the same
workspace and auto-picks the first one whose effective `.env` has a non-empty
value for the selected key, then copies that value into the target's `.env`.
(There is no donor picker — it takes the first sibling that has the value.) It
never overwrites a value you've already set, and it never writes outside the
workspace or to a non-`.env` file.

## The TUI

Three panes: **package tree → that package's keys → the diff detail**. Drifted
packages are flagged in red; missing keys are highlighted. Press `f` on a
missing/empty key to fill it from a sibling package that already has a value for
it. Existing values are never overwritten.

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
npm test        # node:test, domain logic, profile rules, JSON check, real TUI keypress tests
npm run lint    # eslint (flat config)
```

The correctness proof lives in `test/` against fake monorepo fixtures under
`test/fixtures/`: `monorepo/` (root + `packages/web` + `packages/api`,
exercising missing / empty / extra / present) and `profiles/` (multi-profile
precedence with `.env.local` and `.env.production`). The TUI tests drive real
keypresses through `ink-testing-library` (navigate → fill → assert the file was
written), and `check --json` is tested for both shape and exit code. All fixture
`.env` values are fake.

## Limitations

- **Reads the files on disk only.** No secret storage, encryption, or vault sync
  (that's [Infisical](https://infisical.com)'s lane, on purpose).
- **`check` / `summary` totals report the default profile.** The full
  per-profile detail is surfaced in the CLI via `check --profiles` and in the
  `profiles` field of `check --json` (and the programmatic `analyze()` API,
  `pkg.profiles`); the rolled-up `summary` line stays default-profile only.
- **Fill copies from a sibling package's value.** It does not invent or fetch
  secrets. If no sibling has the key, there's nothing to fill from.
- **Workspace detection** reads `pnpm-workspace.yaml` and `package.json`
  `"workspaces"`. A repo with neither is treated as a single (root) package.

## License

Apache-2.0 © 2026 Martello Systems

---

Built by **[Martello Systems](https://martellosystems.com)**. We build
AI-assisted software and dev tooling. This is one of a family of open-source dev
tools we use internally and released. See what we build → open an issue, or get
in touch.

---

## Built by Martello Systems

`envz` is part of the open-source toolkit from **[Martello Systems](https://martellosystems.com)**. We ship AI-built software, spec to delivery in days. If this saved you time, come [see what we do](https://martellosystems.com).

Licensed under the [Apache License 2.0](LICENSE).
