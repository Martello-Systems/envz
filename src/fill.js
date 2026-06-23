/**
 * Merge values from a sibling env into a target env, for a chosen set of keys.
 *
 * Non-destructive: never overwrites a NON-EMPTY existing value in the target.
 * A key is filled only if (a) it is requested, (b) it is missing or empty in
 * the target, and (c) the sibling has a non-empty value for it.
 *
 * Pure: returns a new merged object, does not mutate inputs and does not touch
 * the filesystem.
 *
 * @param {Record<string,string>} target   current target values (key->value)
 * @param {Record<string,string>} sibling  source-of-truth values (key->value)
 * @param {string[]} keys                   keys to attempt to fill
 * @returns {{ merged: Record<string,string>, filled: string[], skipped: string[] }}
 */
export function fillFromSibling(target, sibling, keys) {
  const merged = { ...target };
  const filled = [];
  const skipped = [];

  for (const key of keys) {
    const existing = merged[key];
    const hasValue = existing !== undefined && existing !== "";
    const candidate = sibling[key];
    const siblingHasValue = candidate !== undefined && candidate !== "";

    if (hasValue) {
      skipped.push(key); // never clobber an existing value
      continue;
    }
    if (!siblingHasValue) {
      skipped.push(key); // sibling can't help
      continue;
    }
    merged[key] = candidate;
    filled.push(key);
  }

  return { merged, filled, skipped };
}
