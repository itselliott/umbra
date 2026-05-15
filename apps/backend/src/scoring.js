"use strict";
/* Server-side scoring.

   This imports the SAME engine the extensions run, from the shared
   @umbra/core package. Scoring is never reimplemented here — that
   guarantees a device's risk score is identical whether computed
   locally in the free tool or server-side from a collector's report.

   Resolves via the npm-workspace symlink (@umbra/core) once `npm install`
   has run; falls back to the package path otherwise, so the backend
   still works before install or in environments without symlinks. */
let core;
try {
  core = require("@umbra/core");
} catch (e) {
  core = require("../../../packages/core/audit.js");
}
const { Audit } = core;

/* Takes the raw `chrome.management.getAll()` payload a collector posts
   and returns scored rows ready to persist. Non-extension types
   (themes, apps) are dropped, mirroring Audit.auditAll. */
function scoreInventory(extensions) {
  return (extensions || [])
    .filter(function (e) { return e && e.type === "extension"; })
    .map(function (e) {
      const a = Audit.score(e);
      return {
        id: a.id,
        name: a.name,
        version: a.version,
        permissions: a.permissions,
        hostPermissions: a.hostPermissions,
        installType: a.installType,
        enabled: a.enabled,
        score: a.score,
        tier: a.tier,
        aiInterposing: a.aiInterposing
      };
    });
}

module.exports = { scoreInventory, Audit };
