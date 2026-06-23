import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink-testing-library";
import App from "../src/tui/App.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "fixtures", "monorepo");

// Minimal smoke test: render the TUI and confirm it draws the packages pane
// after the async workspace load settles. Not a substitute for the domain
// tests — purely a "does it mount and render" sanity check.
test("TUI renders the packages pane", async () => {
  const { lastFrame, unmount } = render(React.createElement(App, { root: ROOT }));
  // allow the analyze()/discover() effect to resolve
  await new Promise((r) => setTimeout(r, 250));
  const frame = lastFrame();
  unmount();
  assert.match(frame, /Packages/);
  assert.match(frame, /packages\/web|web/);
});
