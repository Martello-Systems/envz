import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyEnvFile,
  precedenceOrder,
  effectiveValues,
  templateForProfile,
  profilesPresent,
  DEFAULT_PROFILE,
} from "../src/profiles.js";
import { analyze } from "../src/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_ROOT = path.join(__dirname, "fixtures", "profiles");

test("classifyEnvFile maps every .env-family shape", () => {
  assert.deepEqual(classifyEnvFile(".env"), {
    name: ".env",
    profile: "default",
    isTemplate: false,
    isLocal: false,
  });
  assert.deepEqual(classifyEnvFile(".env.local"), {
    name: ".env.local",
    profile: "default",
    isTemplate: false,
    isLocal: true,
  });
  assert.deepEqual(classifyEnvFile(".env.example"), {
    name: ".env.example",
    profile: "default",
    isTemplate: true,
    isLocal: false,
  });
  assert.equal(classifyEnvFile(".env.sample").isTemplate, true);
  assert.equal(classifyEnvFile(".env.template").isTemplate, true);
  assert.equal(classifyEnvFile(".env.dist").isTemplate, true);

  const prod = classifyEnvFile(".env.production");
  assert.equal(prod.profile, "production");
  assert.equal(prod.isTemplate, false);
  assert.equal(prod.isLocal, false);

  const prodLocal = classifyEnvFile(".env.production.local");
  assert.equal(prodLocal.profile, "production");
  assert.equal(prodLocal.isLocal, true);

  const prodTmpl = classifyEnvFile(".env.production.example");
  assert.equal(prodTmpl.profile, "production");
  assert.equal(prodTmpl.isTemplate, true);
});

test("classifyEnvFile rejects non-.env names", () => {
  assert.equal(classifyEnvFile("env"), null);
  assert.equal(classifyEnvFile("package.json"), null);
  assert.equal(classifyEnvFile(".environment"), null);
});

test("precedenceOrder follows the Next.js/dotenv-flow convention", () => {
  assert.deepEqual(precedenceOrder(DEFAULT_PROFILE), [".env", ".env.local"]);
  assert.deepEqual(precedenceOrder("production"), [
    ".env",
    ".env.production",
    ".env.local",
    ".env.production.local",
  ]);
});

test("effectiveValues layers files with later (higher-precedence) winning", () => {
  const valuesByFile = {
    ".env": { A: "base", B: "base", C: "base" },
    ".env.production": { B: "prod" },
    ".env.local": { C: "local" },
  };
  const eff = effectiveValues("production", valuesByFile);
  assert.equal(eff.values.A, "base"); // only in .env
  assert.equal(eff.values.B, "prod"); // .env.production beats .env
  assert.equal(eff.values.C, "local"); // .env.local beats .env (last in order)
  assert.deepEqual(eff.layers, [".env", ".env.production", ".env.local"]);
});

test("templateForProfile prefers profile-specific then default", () => {
  const classes = [
    classifyEnvFile(".env.example"),
    classifyEnvFile(".env.production.example"),
  ];
  assert.equal(templateForProfile(classes, "production").name, ".env.production.example");
  assert.equal(templateForProfile(classes, "default").name, ".env.example");
  // staging has no own template -> falls back to default
  assert.equal(templateForProfile(classes, "staging").name, ".env.example");
});

test("profilesPresent lists default first", () => {
  const classes = [
    classifyEnvFile(".env"),
    classifyEnvFile(".env.production"),
    classifyEnvFile(".env.development"),
  ];
  assert.deepEqual(profilesPresent(classes), ["default", "development", "production"]);
});

test("analyze: .env.local override satisfies an empty default-profile key", async () => {
  const { packages } = await analyze(PROFILES_ROOT);
  const svc = packages.find((p) => p.relDir.endsWith("svc"));
  // API_KEY is empty in .env but set in .env.local -> default profile is clean
  assert.deepEqual(svc.diff.missing, []);
  assert.deepEqual(svc.diff.empty, []);
  const apiKey = svc.diff.keys.find((k) => k.key === "API_KEY");
  assert.equal(apiKey.status, "present");
  assert.equal(apiKey.value, "local-secret");
});

test("analyze: production profile diffs against its own template with correct layering", async () => {
  const { packages } = await analyze(PROFILES_ROOT);
  const svc = packages.find((p) => p.relDir.endsWith("svc"));
  const prod = svc.profiles.find((p) => p.profile === "production");
  assert.ok(prod, "production profile present");
  assert.equal(prod.templateFile, "packages/svc/.env.production.example");
  assert.deepEqual(prod.layers, [".env", ".env.production", ".env.local"]);
  // CDN_URL declared by prod template and set in .env.production -> present
  assert.deepEqual(prod.diff.missing, []);
  assert.deepEqual(prod.diff.empty, []);
  // LOG_LEVEL is in the env layers but not the production template -> extra
  assert.ok(prod.diff.extra.includes("LOG_LEVEL"));
});
