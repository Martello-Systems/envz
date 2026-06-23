import { test } from "node:test";
import assert from "node:assert/strict";
import { diffText } from "../src/diff.js";

test("classifies present / missing / empty / extra", () => {
  const example = "A=x\nB=x\nC=x\n";
  const env = "A=value\nB=\nD=extra\n";
  const r = diffText(env, example);

  assert.deepEqual(r.present, ["A"]);
  assert.deepEqual(r.missing, ["C"]);
  assert.deepEqual(r.empty, ["B"]);
  assert.deepEqual(r.extra, ["D"]);
});

test("status entries cover every key once", () => {
  const r = diffText("A=1\nZ=9\n", "A=x\nB=x\n");
  const byKey = Object.fromEntries(r.keys.map((k) => [k.key, k.status]));
  assert.equal(byKey.A, "present");
  assert.equal(byKey.B, "missing");
  assert.equal(byKey.Z, "extra");
  assert.equal(r.keys.length, 3);
});

test("present value is carried through", () => {
  const r = diffText("A=hello\n", "A=x\n");
  assert.equal(r.keys[0].value, "hello");
});

test("no example means all env keys are extra", () => {
  const r = diffText("A=1\nB=2\n", "");
  assert.deepEqual(r.extra, ["A", "B"]);
  assert.equal(r.missing.length, 0);
});

test("clean env has no drift", () => {
  const r = diffText("A=1\nB=2\n", "A=x\nB=x\n");
  assert.equal(r.missing.length, 0);
  assert.equal(r.empty.length, 0);
  assert.equal(r.extra.length, 0);
  assert.deepEqual(r.present, ["A", "B"]);
});
