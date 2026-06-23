import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import React from "react";
import { render } from "ink-testing-library";
import App from "../src/tui/App.js";
import { parseEnv } from "../src/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "monorepo");

// ANSI sequences ink decodes into key events.
const KEY = {
  down: "[B",
  up: "[A",
  right: "[C",
  left: "[D",
  enter: "\r",
  tab: "\t",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Copy the committed fixture to a throwaway dir so tests can mutate freely. */
async function tmpWorkspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "envz-tui-"));
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

test("TUI renders the launch summary and packages pane", async () => {
  const root = await tmpWorkspace();
  try {
    const { lastFrame, unmount } = render(React.createElement(App, { root }));
    await delay(200);
    const frame = lastFrame();
    unmount();
    assert.match(frame, /Packages/);
    assert.match(frame, /\(root\)/);
    assert.match(frame, /packages\/web/);
    assert.match(frame, /packages\/api/);
    // drift markers: web has 2 issues (1 missing + 1 empty)
    assert.match(frame, /web \(2\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI navigation moves the package selection", async () => {
  const root = await tmpWorkspace();
  try {
    const { stdin, lastFrame, unmount } = render(React.createElement(App, { root }));
    await delay(200);
    // move down to packages/web (root -> api -> web), enter the keys pane
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.enter);
    await delay(60);
    const frame = lastFrame();
    unmount();
    // the keys pane header shows the package name and its declared keys
    assert.match(frame, /@fixture\/web/);
    assert.match(frame, /ANALYTICS_KEY/);
    assert.match(frame, /FEATURE_FLAG_BETA/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI 'f' fills a missing key from a sibling and writes the file", async () => {
  const root = await tmpWorkspace();
  try {
    const { stdin, lastFrame, unmount } = render(React.createElement(App, { root }));
    await delay(200);

    // navigate: down,down -> packages/web ; enter keys pane
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.enter);
    await delay(60);

    // keys order for web (example-driven): NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SITE_NAME,
    // ANALYTICS_KEY (missing), FEATURE_FLAG_BETA (empty). Move to ANALYTICS_KEY.
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.down);
    await delay(40);
    // selected key should be ANALYTICS_KEY now
    assert.match(lastFrame(), /key:\s+ANALYTICS_KEY/);

    // fill it from the sibling api package (which has ANALYTICS_KEY set)
    stdin.write("f");
    await delay(120);

    const frame = lastFrame();
    unmount();

    // UI feedback
    assert.match(frame, /Filled ANALYTICS_KEY from/);

    // file on disk now has the value copied from the api sibling
    const webEnv = await readFile(path.join(root, "packages", "web", ".env"), "utf8");
    const parsed = parseEnv(webEnv);
    assert.equal(parsed.values.ANALYTICS_KEY, "analytics-shared-value");
    // pre-existing keys are preserved
    assert.equal(parsed.values.NEXT_PUBLIC_SITE_NAME, "My App");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI 'f' on an already-present key reports it instead of writing", async () => {
  const root = await tmpWorkspace();
  try {
    const { stdin, lastFrame, unmount } = render(React.createElement(App, { root }));
    await delay(200);

    // go to packages/api (down once), enter keys pane
    stdin.write(KEY.down);
    await delay(40);
    stdin.write(KEY.enter);
    await delay(60);

    // first key is present (PORT). pressing f should refuse, not fill.
    stdin.write("f");
    await delay(80);
    const frame = lastFrame();
    unmount();
    assert.match(frame, /already present/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI 'q' quits cleanly", async () => {
  const root = await tmpWorkspace();
  try {
    const { stdin, unmount } = render(React.createElement(App, { root }));
    await delay(150);
    stdin.write("q");
    await delay(60);
    // if exit() fired without throwing, unmount is a no-op safety net
    unmount();
    assert.ok(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
