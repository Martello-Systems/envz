// Public API surface for envz domain logic.
export { parseEnv } from "./parse.js";
export { diff, diffText } from "./diff.js";
export { fillFromSibling } from "./fill.js";
export {
  discover,
  listEnvFiles,
  readWorkspaceGlobs,
  resolvePackageDirs,
  isEnvFileName,
  isExampleName,
} from "./discover.js";
export { analyze, summarize, headline, pickPrimary } from "./summarize.js";
export { check, checkReport } from "./check.js";
export { applyEnvUpdates, safeEnvTarget } from "./write-env.js";
export {
  classifyEnvFile,
  precedenceOrder,
  effectiveValues,
  templateForProfile,
  profilesPresent,
  DEFAULT_PROFILE,
} from "./profiles.js";
