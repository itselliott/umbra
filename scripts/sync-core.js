"use strict";
/* ============================================================
   Keeps the extension's bundled audit.js byte-identical to the
   canonical packages/core/audit.js.

   The Chrome extension loads a plain folder, so it needs the
   scoring engine physically present — there is no bundler yet.
   Until the extension is relocated under apps/ with a build step,
   this script is the "build": run it after editing the canonical
   engine so the extension never forks from @umbra/core.

   Usage (from repo root):  node scripts/sync-core.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const canonical = path.join(repoRoot, "packages", "core", "audit.js");

const targets = [
  path.join(repoRoot, "audit.js")            // current root-level extension build
  // When the extension is relocated, add e.g.:
  // path.join(repoRoot, "apps", "extension-free", "audit.js"),
  // path.join(repoRoot, "apps", "extension-collector", "audit.js"),
];

const src = fs.readFileSync(canonical, "utf8");
for (const target of targets) {
  fs.writeFileSync(target, src);
  console.log("synced -> " + path.relative(repoRoot, target));
}
console.log("done — " + targets.length + " target(s) in sync with packages/core/audit.js");
