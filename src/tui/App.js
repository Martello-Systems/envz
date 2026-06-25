import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import path from "node:path";
import { analyze } from "../summarize.js";
import { discover } from "../discover.js";
import { parseEnv } from "../parse.js";
import { fillFromSibling } from "../fill.js";
import { applyEnvUpdates, safeEnvTarget } from "../write-env.js";
import { classifyEnvFile, effectiveValues, DEFAULT_PROFILE } from "../profiles.js";
import { readFile } from "node:fs/promises";

/**
 * Compute a package's *effective* default-profile values, layering its real
 * env files in precedence order (`.env.local` over `.env`) the same way the app
 * loads them at runtime. This is the documented fill source: a value set only in
 * a sibling's `.env.local` is still a valid donor.
 * @param {import("../discover.js").EnvFile[]} envFiles
 * @returns {Promise<Record<string,string>>}
 */
async function effectiveDefaultValues(envFiles) {
  const valuesByFile = {};
  for (const f of envFiles) {
    const cls = classifyEnvFile(f.name);
    if (!cls || cls.isTemplate || cls.profile !== DEFAULT_PROFILE) continue;
    try {
      valuesByFile[f.name] = parseEnv(await readFile(f.path, "utf8")).values;
    } catch {
      valuesByFile[f.name] = {};
    }
  }
  return effectiveValues(DEFAULT_PROFILE, valuesByFile).values;
}

const STATUS_COLOR = {
  present: "green",
  missing: "red",
  empty: "yellow",
  extra: "blue",
};
const STATUS_GLYPH = {
  present: "✓",
  missing: "✗",
  empty: "○",
  extra: "+",
};

/**
 * Root TUI component. Props: { root: string }.
 * Three panes: packages | keys | detail. Arrow/jk to move, Tab to switch pane,
 * f to fill a missing/empty key from a sibling package that has it.
 */
export default function App({ root }) {
  const { exit } = useApp();
  const [analysis, setAnalysis] = useState(null);
  const [siblings, setSiblings] = useState({}); // relDir -> values map
  const [pkgIdx, setPkgIdx] = useState(0);
  const [keyIdx, setKeyIdx] = useState(0);
  const [pane, setPane] = useState(0); // 0 packages, 1 keys
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const a = await analyze(root);
    setAnalysis(a);
    // load sibling value maps (effective default-profile values per package)
    // as the fill source, so `.env.local` overrides are honored just like the
    // app loads them.
    const { packages } = await discover(root);
    const sib = {};
    for (const p of packages) {
      sib[p.relDir] = await effectiveDefaultValues(p.envFiles);
    }
    setSiblings(sib);
  }, [root]);

  useEffect(() => {
    load();
  }, [load]);

  const packages = analysis ? analysis.packages : [];
  const pkg = packages[pkgIdx];
  const keys = pkg && pkg.diff ? pkg.diff.keys : [];
  const activeKey = keys[keyIdx];

  const doFill = useCallback(
    async (targetPkg, key) => {
      // find a sibling package whose primary env has a non-empty value for key
      const donor = Object.entries(siblings).find(
        ([rel, vals]) => rel !== targetPkg.relDir && vals[key]
      );
      if (!donor) {
        setMessage(`No sibling has a value for ${key}`);
        return;
      }
      const [donorRel, donorVals] = donor;
      const targetVals = siblings[targetPkg.relDir] || {};
      const { merged, filled } = fillFromSibling(targetVals, donorVals, [key]);
      if (filled.length === 0) {
        setMessage(`Could not fill ${key}`);
        return;
      }
      // persist to the target's primary .env (create path if needed)
      const candidate = targetPkg.envFile
        ? targetPkg.envFile
        : path.join(targetPkg.relDir === "." ? "" : targetPkg.relDir, ".env");
      try {
        const targetEnvAbs = safeEnvTarget(root, candidate);
        await applyEnvUpdates(targetEnvAbs, { [key]: merged[key] });
        setMessage(`Filled ${key} from ${donorRel}`);
        await load();
      } catch (err) {
        setMessage(`Could not write ${key}: ${err.message}`);
      }
    },
    [siblings, root, load]
  );

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "r") {
      setMessage("Refreshed");
      load();
      return;
    }
    if (key.tab) {
      setPane((p) => (p === 0 ? 1 : 0));
      return;
    }
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";

    if (pane === 0) {
      if (up) setPkgIdx((i) => Math.max(0, i - 1)), setKeyIdx(0);
      if (down) setPkgIdx((i) => Math.min(packages.length - 1, i + 1)), setKeyIdx(0);
      if (key.return || key.rightArrow) setPane(1);
    } else {
      if (up) setKeyIdx((i) => Math.max(0, i - 1));
      if (down) setKeyIdx((i) => Math.min(keys.length - 1, i + 1));
      if (key.leftArrow) setPane(0);
      if (input === "f" && pkg && activeKey) {
        if (activeKey.status === "missing" || activeKey.status === "empty") {
          doFill(pkg, activeKey.key);
        } else {
          setMessage(`${activeKey.key} is already ${activeKey.status}`);
        }
      }
    }
  });

  if (!analysis) {
    return React.createElement(Text, null, "Loading workspace…");
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { bold: true }, "envz "),
      React.createElement(Text, { dimColor: true }, path.basename(analysis.root))
    ),
    React.createElement(
      Box,
      { flexDirection: "row" },
      // pane 1: packages
      React.createElement(
        Box,
        { flexDirection: "column", width: 28, borderStyle: "round", borderColor: pane === 0 ? "cyan" : "gray", paddingX: 1 },
        React.createElement(Text, { bold: true }, "Packages"),
        ...packages.map((p, i) => {
          const d = p.diff;
          const drift = d ? d.missing.length + d.empty.length : 0;
          const sel = i === pkgIdx;
          return React.createElement(
            Text,
            { key: p.relDir, inverse: sel && pane === 0, color: drift ? "red" : "green" },
            `${drift ? "●" : "○"} ${p.isRoot ? "(root)" : p.relDir}${drift ? ` (${drift})` : ""}`
          );
        })
      ),
      // pane 2: keys
      React.createElement(
        Box,
        { flexDirection: "column", width: 34, borderStyle: "round", borderColor: pane === 1 ? "cyan" : "gray", paddingX: 1 },
        React.createElement(Text, { bold: true }, pkg ? pkg.name : "Keys"),
        ...keys.map((k, i) =>
          React.createElement(
            Text,
            { key: k.key, inverse: i === keyIdx && pane === 1, color: STATUS_COLOR[k.status] },
            `${STATUS_GLYPH[k.status]} ${k.key}`
          )
        ),
        keys.length === 0 ? React.createElement(Text, { dimColor: true }, "no keys") : null
      ),
      // pane 3: detail
      React.createElement(
        Box,
        { flexDirection: "column", flexGrow: 1, borderStyle: "round", borderColor: "gray", paddingX: 1 },
        React.createElement(Text, { bold: true }, "Detail"),
        activeKey
          ? React.createElement(
              Box,
              { flexDirection: "column" },
              React.createElement(Text, null, `key:    ${activeKey.key}`),
              React.createElement(Text, { color: STATUS_COLOR[activeKey.status] }, `status: ${activeKey.status}`),
              React.createElement(Text, null, `value:  ${activeKey.value || "(none)"}`),
              activeKey.status === "missing" || activeKey.status === "empty"
                ? React.createElement(Text, { dimColor: true }, "press f to fill from a sibling")
                : null
            )
          : React.createElement(Text, { dimColor: true }, "select a key")
      )
    ),
    React.createElement(
      Box,
      null,
      React.createElement(
        Text,
        { dimColor: true },
        "↑/↓ or j/k move · Tab switch pane · f fill · r refresh · q quit"
      )
    ),
    message ? React.createElement(Text, { color: "magenta" }, message) : null
  );
}
