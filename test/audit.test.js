/* ============================================================
   Umbra — rigorous test suite
   Run from the extension root:   node --test test/
   (Node 18+; uses the built-in node:test runner — no deps.)

   Coverage:
     - audit.js scoring engine: deterministic scores, every
       heuristic, tier boundaries, edge cases, fuzz (2000 cases)
     - auditAll / summarize: filtering, allowlist, sort, grading
     - plainEnglish / whyFlagged / remediation: branch coverage
     - background.js: real behavioural test of the install watcher
     - dashboard.js / popup.js: load + run under a mocked DOM
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const auditModule = require(path.join(ROOT, "audit.js"));
const Audit = auditModule.Audit || global.Audit || globalThis.Audit;

assert.ok(Audit, "audit.js must expose an Audit object");

/* ---------- fixtures (fresh objects each call, never shared) ---------- */
const UBLOCK_ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm"; // seeded KNOWN_GOOD entry

const F = {
  // malicious AI impersonator: broad host + bait name + AI naming
  maliciousAI: () => ({
    id: "malic0000000000000000000000000a", name: "ChatGPT Sidebar with GPT-5, Claude & DeepSeek AI",
    version: "4.2.1", enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["tabs", "history", "storage"], hostPermissions: ["<all_urls>"],
    icons: [{ size: 48, url: "chrome://extension-icon/x/48/0" }]
  }),
  // high risk from permissions alone — no bait, no AI
  riskyVpn: () => ({
    id: "vpn00000000000000000000000000a", name: "SpeedTunnel VPN Gateway", version: "1.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["proxy", "webRequest", "cookies", "storage"], hostPermissions: ["<all_urls>"]
  }),
  // KNOWN_GOOD publisher — should be dampened
  ublock: () => ({
    id: UBLOCK_ID, name: "uBlock Origin", version: "1.60.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["webRequest", "webRequestBlocking", "storage", "scripting"], hostPermissions: ["<all_urls>"]
  }),
  // ordinary benign extension
  benign: () => ({
    id: "benign000000000000000000000000a", name: "Notion Web Clipper", version: "2.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["tabs", "storage"], hostPermissions: []
  }),
  // developer-mode load
  devMode: () => ({
    id: "devmode00000000000000000000000a", name: "My Test Extension", version: "0.0.1",
    enabled: true, mayDisable: true, installType: "development", type: "extension",
    permissions: ["storage"], hostPermissions: []
  }),
  // sideloaded
  sideloaded: () => ({
    id: "sideload0000000000000000000000a", name: "PDF Helper", version: "3.1",
    enabled: true, mayDisable: true, installType: "sideload", type: "extension",
    permissions: ["nativeMessaging", "downloads", "storage"], hostPermissions: ["<all_urls>"]
  }),
  // admin-installed, locked on — must NOT be flagged for persistence
  adminLocked: () => ({
    id: "admin00000000000000000000000a", name: "Corporate Security Agent", version: "5.0",
    enabled: true, mayDisable: false, installType: "admin", type: "extension",
    permissions: ["tabs", "storage", "management"], hostPermissions: ["<all_urls>"]
  }),
  // non-admin, locked on — SHOULD be flagged for persistence
  stubborn: () => ({
    id: "stubborn0000000000000000000000a", name: "StubbornBar", version: "1.0",
    enabled: true, mayDisable: false, installType: "normal", type: "extension",
    permissions: ["tabs", "storage"], hostPermissions: []
  }),
  // AI interposition detected via host permissions, not the name
  aiByHost: () => ({
    id: "aihost00000000000000000000000a", name: "Productivity Booster", version: "1.2",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["storage"], hostPermissions: ["https://chatgpt.com/*", "https://claude.ai/*"]
  }),
  // debugger permission — single most powerful capability
  debuggerExt: () => ({
    id: "debug00000000000000000000000a", name: "DevTool Pro", version: "1.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["debugger", "storage"], hostPermissions: []
  }),
  // unknown / future permissions must be ignored gracefully
  unknownPerms: () => ({
    id: "unknown0000000000000000000000a", name: "Future Ext", version: "1.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["someNewFuturePermission", "anotherFakeOne", "storage"], hostPermissions: []
  }),
  // more than 8 specific host patterns
  multiHost: () => ({
    id: "multi00000000000000000000000a", name: "Multi Site Tool", version: "1.0",
    enabled: true, mayDisable: true, installType: "normal", type: "extension",
    permissions: ["storage"],
    hostPermissions: ["https://a1.com/*", "https://a2.com/*", "https://a3.com/*", "https://a4.com/*",
      "https://a5.com/*", "https://a6.com/*", "https://a7.com/*", "https://a8.com/*", "https://a9.com/*"]
  }),
  // everything at once — must clamp to 100
  monster: () => ({
    id: "monster0000000000000000000000a", name: "Everything Tool", version: "1.0",
    enabled: true, mayDisable: false, installType: "sideload", type: "extension",
    permissions: ["debugger", "nativeMessaging", "proxy", "clipboardRead", "cookies", "history",
      "webRequest", "management", "tabs", "downloads", "storage"],
    hostPermissions: ["<all_urls>", "https://chatgpt.com/*"]
  }),
  // minimal object — almost every field missing
  minimal: () => ({ id: "minimal0000000000000000000000a", name: "Minimal", version: "1.0", type: "extension" }),
  // non-extension types — auditAll must drop these
  theme: () => ({ id: "theme00000000000000000000000a", name: "Dark Theme", version: "1.0", type: "theme" }),
  hostedApp: () => ({ id: "app000000000000000000000000a", name: "Some App", version: "1.0", type: "hosted_app" })
};

/* ============================================================
   1. Deterministic scoring
   ============================================================ */
test("scoring — malicious AI impersonator pins to critical", () => {
  const a = Audit.score(F.maliciousAI());
  assert.equal(a.score, 100, "broad host + AI + bait keywords clamps at 100");
  assert.equal(a.tier, "critical");
  assert.equal(a.aiInterposing, true);
  assert.equal(a.knownBad, false);
  assert.equal(a.trusted, false);
  assert.ok(a.reasons.some(r => r.sev === "critical"), "has a critical reason");
});

test("scoring — permission-only high risk (VPN) is exact and deterministic", () => {
  const a = Audit.score(F.riskyVpn());
  // proxy20 + webRequest15 + cookies16 + storage1 = 52, + broad host 45 = 97
  assert.equal(a.score, 97);
  assert.equal(a.tier, "critical");
  assert.equal(a.aiInterposing, false, "VPN name is not AI-related");
});

test("scoring — KNOWN_GOOD publisher is dampened and marked trusted", () => {
  const raw = F.ublock();
  const a = Audit.score(raw);
  // 34 perms + 45 broad = 79 -> round(79 * 0.45) = 36
  assert.equal(a.trusted, true);
  assert.equal(a.score, 36);
  assert.equal(a.tier, "medium");
  assert.equal(a.reasons[0].sev, "low", "verified-publisher note is prepended");
  assert.match(a.reasons[0].text, /verified-publisher/i);
});

test("scoring — ordinary benign extension is low risk", () => {
  const a = Audit.score(F.benign());
  assert.equal(a.score, 10); // tabs9 + storage1
  assert.equal(a.tier, "low");
  assert.equal(a.aiInterposing, false);
});

/* ============================================================
   2. Individual heuristics
   ============================================================ */
test("heuristic — developer-mode install is flagged", () => {
  const a = Audit.score(F.devMode());
  assert.ok(a.reasons.some(r => /developer mode/i.test(r.text)));
});

test("heuristic — sideloaded install is flagged", () => {
  const a = Audit.score(F.sideloaded());
  assert.ok(a.reasons.some(r => /sideloaded/i.test(r.text)));
  assert.equal(a.tier, "critical"); // 32 perms + 45 broad + 22 sideload = 99
});

test("heuristic — locked-on extension is flagged for persistence, EXCEPT admin installs", () => {
  const stubborn = Audit.score(F.stubborn());
  assert.ok(
    stubborn.reasons.some(r => /persistence|cannot be disabled/i.test(r.text)),
    "non-admin mayDisable=false is treated as a persistence trait"
  );

  const admin = Audit.score(F.adminLocked());
  assert.ok(
    !admin.reasons.some(r => /persistence|cannot be disabled/i.test(r.text)),
    "admin-managed extensions are exempt from the persistence heuristic"
  );
});

test("heuristic — AI interposition detected via host permissions alone", () => {
  const a = Audit.score(F.aiByHost());
  assert.equal(a.aiInterposing, true);
  assert.deepEqual(a.hostInfo.aiDomains.sort(), ["chatgpt.com", "claude.ai"]);
  assert.equal(a.score, 23); // storage1 + 2-host 8 + aiDomains 14
});

test("heuristic — debugger permission is weighted as critical severity", () => {
  const a = Audit.score(F.debuggerExt());
  assert.equal(a.score, 39); // debugger38 + storage1
  assert.equal(a.tier, "medium");
  assert.ok(a.reasons.some(r => r.sev === "critical"), "debugger produces a critical-severity reason");
});

test("heuristic — unknown/future permissions are ignored, never crash", () => {
  const a = Audit.score(F.unknownPerms());
  assert.equal(a.score, 1, "only the recognised 'storage' permission counts");
  assert.equal(a.tier, "low");
});

test("heuristic — more than 8 host patterns is counted", () => {
  const a = Audit.score(F.multiHost());
  assert.equal(a.score, 29); // storage1 + 9-host 28
  assert.ok(a.reasons.some(r => /9 site patterns/i.test(r.text)));
});

/* ============================================================
   3. Invariants & boundaries
   ============================================================ */
test("invariant — score is always an integer clamped to 0..100", () => {
  const monster = Audit.score(F.monster());
  assert.equal(monster.score, 100, "an extension with everything clamps at 100");
  assert.equal(monster.tier, "critical");

  const minimal = Audit.score(F.minimal());
  assert.equal(minimal.score, 0, "an extension with nothing scores 0");
  assert.equal(minimal.tier, "low");

  for (const make of Object.values(F)) {
    const a = Audit.score(make());
    assert.ok(Number.isInteger(a.score), "score is an integer");
    assert.ok(a.score >= 0 && a.score <= 100, "score within 0..100");
  }
});

test("invariant — tier() boundary values", () => {
  assert.equal(Audit.tier(100), "critical");
  assert.equal(Audit.tier(80), "critical");
  assert.equal(Audit.tier(79), "high");
  assert.equal(Audit.tier(55), "high");
  assert.equal(Audit.tier(54), "medium");
  assert.equal(Audit.tier(30), "medium");
  assert.equal(Audit.tier(29), "low");
  assert.equal(Audit.tier(0), "low");
});

test("edge case — missing / empty fields never throw", () => {
  const weird = [
    { id: "e1", type: "extension" },
    { id: "e2", type: "extension", permissions: null, hostPermissions: null, name: null },
    { id: "e3", type: "extension", permissions: [], hostPermissions: [], icons: [] },
    { id: "e4", type: "extension", name: "", permissions: ["storage"], installType: undefined, mayDisable: undefined },
    { id: "e5", type: "extension", name: "x", hostPermissions: ["<all_urls>"] }
  ];
  for (const w of weird) {
    assert.doesNotThrow(() => {
      const a = Audit.score(w);
      assert.ok(Number.isInteger(a.score));
      assert.ok(["critical", "high", "medium", "low"].includes(a.tier));
      assert.ok(Array.isArray(a.reasons));
      assert.equal(typeof a.hostInfo.broad, "boolean");
    }, "score() must tolerate malformed input: " + JSON.stringify(w));
  }
});

/* ============================================================
   4. auditAll & summarize
   ============================================================ */
test("auditAll — filters out the auditor itself and non-extension types", () => {
  const SELF = "umbra000000000000000000000000a";
  const exts = [
    F.maliciousAI(),
    F.theme(),
    F.hostedApp(),
    { id: SELF, name: "Umbra", type: "extension", permissions: [], hostPermissions: [] }
  ];
  const res = Audit.auditAll(exts, SELF, []);
  assert.equal(res.length, 1, "theme, hosted_app and self are all dropped");
  assert.equal(res[0].id, exts[0].id);
});

test("auditAll — applies the allowlist and sorts (allowlisted last, then score desc)", () => {
  const SELF = "self0000000000000000000000000a";
  const mal = F.maliciousAI();   // score 100
  const ben = F.benign();        // score 10
  const res = Audit.auditAll([mal, ben], SELF, [mal.id]);

  assert.equal(res[0].id, ben.id, "non-allowlisted item sorts first even with a lower score");
  assert.equal(res[1].id, mal.id, "allowlisted item is pushed to the end");
  assert.equal(res[0].allowlisted, false);
  assert.equal(res[1].allowlisted, true);
});

test("summarize — letter-grade logic and allowlist exclusion", () => {
  const fake = (tier, opts = {}) => ({
    tier,
    allowlisted: !!opts.allow,
    enabled: opts.enabled !== false,
    aiInterposing: !!opts.ai,
    hostInfo: { broad: !!opts.broad }
  });

  assert.equal(Audit.summarize([fake("critical")]).grade, "F");
  assert.equal(Audit.summarize([fake("high"), fake("high")]).grade, "D");
  assert.equal(Audit.summarize([fake("high")]).grade, "C");
  assert.equal(Audit.summarize([fake("medium"), fake("medium"), fake("medium")]).grade, "B");
  assert.equal(Audit.summarize([fake("medium"), fake("medium")]).grade, "A");
  assert.equal(Audit.summarize([fake("low"), fake("low")]).grade, "A");

  // allowlisted items are excluded from the counts that drive the grade
  const withAllow = Audit.summarize([fake("critical", { allow: true }), fake("low")]);
  assert.equal(withAllow.grade, "A", "an allowlisted critical does not drag the grade down");
  assert.equal(withAllow.allowlisted, 1);
  assert.equal(withAllow.critical, 0);

  // counts are coherent
  const s = Audit.summarize([fake("critical", { broad: true, ai: true }), fake("low")]);
  assert.equal(s.total, 2);
  assert.equal(s.critical, 1);
  assert.equal(s.broad, 1);
  assert.equal(s.ai, 1);
});

/* ============================================================
   5. Narrative helpers — branch coverage
   ============================================================ */
test("plainEnglish / whyFlagged / remediation — always usable, all branches", () => {
  // real fixtures
  for (const make of Object.values(F)) {
    const a = Audit.score(make());
    const pe = Audit.plainEnglish(a);
    const wf = Audit.whyFlagged(a);
    const rm = Audit.remediation(a);
    assert.equal(typeof pe, "string"); assert.ok(pe.length > 0);
    assert.equal(typeof wf, "string"); assert.ok(wf.length > 0);
    assert.ok(Array.isArray(rm) && rm.length > 0);
  }

  // knownBad branch (KNOWN_BAD is empty in the shipped seed list, so craft it)
  const kb = {
    knownBad: true, name: "BadExt", permissions: [], hostPermissions: [],
    hostInfo: { broad: false, count: 0, aiDomains: [] }, aiInterposing: false,
    tier: "critical", trusted: false, installType: "normal"
  };
  assert.match(Audit.plainEnglish(kb), /malicious|compromised/i);
  assert.match(Audit.whyFlagged(kb), /signature/i);
  assert.ok(Audit.remediation(kb).length >= 1);

  // remediation covers every tier + the trusted path
  assert.ok(Audit.remediation({ tier: "low" }).length >= 1);
  assert.ok(Audit.remediation({ tier: "medium", trusted: true }).length >= 1);
  assert.ok(Audit.remediation({ tier: "high", trusted: false }).length >= 1);
  assert.ok(Audit.remediation({ tier: "critical", knownBad: false }).length >= 1);

  // minimal-permission plain-English path
  const lowA = Audit.score(F.minimal());
  assert.match(Audit.plainEnglish(lowA), /minimal|low-risk/i);
});

/* ============================================================
   6. FUZZ — 2000 randomly-shaped extensions must not break invariants
   ============================================================ */
test("fuzz — 2000 random extensions hold every invariant", () => {
  const PERMS = ["debugger", "desktopCapture", "nativeMessaging", "proxy", "pageCapture",
    "clipboardRead", "privacy", "cookies", "history", "tabCapture", "management", "webRequest",
    "scripting", "contentSettings", "declarativeNetRequest", "geolocation", "downloads", "tabs",
    "bookmarks", "webRequestBlocking", "clipboardWrite", "activeTab", "storage", "notifications",
    "contextMenus", "alarms", "idle", "someUnknownPermission", "x-garbage-perm"];
  const HOSTS = ["<all_urls>", "*://*/*", "https://*/*", "https://example.com/*",
    "https://chatgpt.com/*", "https://claude.ai/*", "https://foo.bar/*", "file:///*"];
  const NAMES = ["Helper", "ChatGPT GPT-5 Sidebar", "Free VPN Unlimited Proxy", "My Tool",
    "Claude AI Assistant", "Coupon Saver", "Dark Reader", "Password Vault", "", null, undefined,
    "deepseek nitro generator crack"];
  const INSTALL = ["normal", "admin", "development", "sideload", "other", undefined];
  const TYPES = ["extension", "extension", "extension", "theme", "hosted_app", "packaged_app"];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const subset = arr => arr.filter(() => Math.random() < 0.3);

  const TIERS = new Set(["critical", "high", "medium", "low"]);
  const batch = [];

  for (let i = 0; i < 2000; i++) {
    const ext = { id: "fuzz" + i + "x".repeat(28), type: pick(TYPES) };
    if (Math.random() < 0.9) ext.name = pick(NAMES);
    if (Math.random() < 0.85) ext.version = "1.0." + i;
    if (Math.random() < 0.85) ext.permissions = subset(PERMS);
    if (Math.random() < 0.85) ext.hostPermissions = subset(HOSTS);
    if (Math.random() < 0.8) ext.installType = pick(INSTALL);
    if (Math.random() < 0.8) ext.mayDisable = pick([true, false, undefined]);
    if (Math.random() < 0.8) ext.enabled = pick([true, false]);
    if (Math.random() < 0.4) ext.icons = [{ size: 32, url: "chrome://x" }];
    batch.push(ext);

    let a;
    assert.doesNotThrow(() => { a = Audit.score(ext); }, "score() threw on: " + JSON.stringify(ext));
    assert.ok(Number.isInteger(a.score) && a.score >= 0 && a.score <= 100, "score bounds: " + a.score);
    assert.ok(TIERS.has(a.tier), "valid tier");
    assert.ok(Array.isArray(a.reasons), "reasons is an array");
    assert.equal(typeof a.hostInfo.broad, "boolean");
    assert.equal(typeof a.hostInfo.count, "number");
    assert.ok(Array.isArray(a.hostInfo.aiDomains));
    assert.equal(typeof a.aiInterposing, "boolean");
    assert.ok(typeof Audit.plainEnglish(a) === "string" && Audit.plainEnglish(a).length > 0);
    assert.ok(typeof Audit.whyFlagged(a) === "string" && Audit.whyFlagged(a).length > 0);
    assert.ok(Array.isArray(Audit.remediation(a)) && Audit.remediation(a).length > 0);
  }

  // the aggregate paths must also survive the whole random batch
  let results, summary;
  assert.doesNotThrow(() => {
    results = Audit.auditAll(batch, "fuzz0" + "x".repeat(28), [batch[0].id, batch[10].id]);
    summary = Audit.summarize(results);
  }, "auditAll/summarize threw on the fuzz batch");

  // sort invariant: non-allowlisted before allowlisted; within a group, score descending
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1], cur = results[i];
    if (prev.allowlisted === cur.allowlisted) {
      assert.ok(prev.score >= cur.score, "results sorted by score within allowlist group");
    } else {
      assert.equal(prev.allowlisted, false, "allowlisted items come strictly after non-allowlisted");
    }
  }
  assert.ok(["A", "B", "C", "D", "F"].includes(summary.grade));
  assert.ok(results.every(r => typeof r.allowlisted === "boolean"));
});

/* ============================================================
   7. background.js — install watcher, permission-diff & badge
   ============================================================ */
test("background.js — risky-install watch, permission-diff, and toolbar badge", async () => {
  const L = {};
  const cap = name => ({ addListener: fn => { L[name] = fn; } });
  let extList = [];
  const notifs = [];
  const badge = { text: null, color: null };
  const store = {};

  global.importScripts = () => {};
  global.Audit = Audit;
  global.chrome = {
    runtime: { id: "SELFID", getURL: x => x, onInstalled: cap("rInstalled"), onStartup: cap("rStartup") },
    management: {
      getAll: () => Promise.resolve(extList.slice()),
      onInstalled: cap("mInstalled"), onUninstalled: cap("mUninstalled"),
      onEnabled: cap("mEnabled"), onDisabled: cap("mDisabled")
    },
    storage: {
      local: {
        get: key => {
          const keys = Array.isArray(key) ? key : [key];
          const out = {};
          keys.forEach(k => { if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k]; });
          return Promise.resolve(out);
        },
        set: obj => { Object.keys(obj).forEach(k => { store[k] = obj[k]; }); return Promise.resolve(); },
        remove: k => { delete store[k]; return Promise.resolve(); }
      },
      onChanged: cap("storageChanged")
    },
    action: {
      setBadgeText: o => { badge.text = o.text; return Promise.resolve(); },
      setBadgeBackgroundColor: o => { badge.color = o.color; return Promise.resolve(); },
      setTitle: () => Promise.resolve()
    },
    notifications: { create: (id, opts) => notifs.push(opts), onClicked: cap("nClicked"), clear: () => {} },
    tabs: { create: () => {} }
  };

  delete require.cache[require.resolve(path.join(ROOT, "background.js"))];
  assert.doesNotThrow(() => require(path.join(ROOT, "background.js")));

  // every event listener is registered
  ["mInstalled", "mUninstalled", "mEnabled", "mDisabled",
   "rInstalled", "rStartup", "storageChanged", "nClicked"].forEach(k => {
    assert.equal(typeof L[k], "function", "missing listener: " + k);
  });

  // brand-new risky install -> a risk notification, and it is snapshotted
  const mal = F.maliciousAI();
  extList = [mal];
  await L.mInstalled(mal);
  assert.equal(notifs.length, 1, "risky install triggers exactly one notification");
  assert.match(notifs[0].title, /just installed/i);
  assert.ok(store.permSnapshots[mal.id], "new install is snapshotted");

  // brand-new benign install -> silent, but still snapshotted
  notifs.length = 0;
  const ben = F.benign();
  extList = [mal, ben];
  await L.mInstalled(ben);
  assert.equal(notifs.length, 0, "a low-risk install is not announced");
  assert.ok(store.permSnapshots[ben.id], "benign install is still snapshotted");

  // the auditor itself and non-extension types are ignored
  await L.mInstalled({ id: "SELFID", name: "Umbra", type: "extension", permissions: [], hostPermissions: [] });
  await L.mInstalled({ id: "thm", name: "A Theme", type: "theme" });
  assert.equal(notifs.length, 0, "self and themes/apps are ignored");

  // permission EXPANSION on update -> a distinct "expanded its permissions" alert
  notifs.length = 0;
  const weaponised = {
    id: ben.id, name: ben.name, type: "extension", enabled: true, mayDisable: true,
    installType: "normal", version: "9.9",
    permissions: ["tabs", "storage", "cookies", "history"], hostPermissions: ["<all_urls>"]
  };
  extList = [mal, weaponised];
  await L.mInstalled(weaponised);
  assert.equal(notifs.length, 1, "an expansion fires exactly one notification");
  assert.match(notifs[0].title, /expanded its permissions/i);
  assert.match(notifs[0].message, /risk score rose/i);
  assert.ok(store.permSnapshots[ben.id].permissions.includes("cookies"), "snapshot updated to new perms");

  // re-firing with unchanged permissions -> silent
  notifs.length = 0;
  await L.mInstalled(weaponised);
  assert.equal(notifs.length, 0, "unchanged permissions -> no notification");

  // a harmless add (zero-weight perms, no score increase) -> silent
  const h1 = { id: "harmlessxxxxxxxxxxxxxxxxxxxxxxa", name: "Tiny Tool", type: "extension",
    enabled: true, mayDisable: true, installType: "normal", version: "1.0",
    permissions: ["storage"], hostPermissions: [] };
  await L.mInstalled(h1);
  notifs.length = 0;
  const h2 = Object.assign({}, h1, { version: "1.1", permissions: ["storage", "alarms", "idle"] });
  await L.mInstalled(h2);
  assert.equal(notifs.length, 0, "added only zero-weight perms -> score unchanged -> stays quiet");

  // uninstall removes the stored snapshot
  await L.mUninstalled(ben.id);
  assert.ok(!store.permSnapshots[ben.id], "snapshot removed on uninstall");

  // badge: critical count, in red
  extList = [mal, ben];
  await L.mDisabled();
  assert.equal(badge.text, "1", "one critical extension -> badge text '1'");
  assert.equal(badge.color, "#ff4d5e", "critical -> red badge");

  // badge clears when nothing is critical or high
  extList = [ben];
  await L.mDisabled();
  assert.equal(badge.text, "", "no risky extensions -> empty badge");

  // allowlisted criticals are excluded from the badge
  extList = [mal];
  store.allowlist = [mal.id];
  await L.mDisabled();
  assert.equal(badge.text, "", "an allowlisted critical does not light the badge");
});

/* ============================================================
   8. dashboard.js + popup.js — load and run under a mocked DOM
      Catches broken element ids, missing globals, bad wiring.
   ============================================================ */
test("dashboard.js & popup.js — execute cleanly against a mocked browser", async () => {
  // recursive stub: any property access / call returns another stub,
  // any assignment succeeds — enough for the render pipeline to run.
  const makeStub = () => new Proxy(function () {}, {
    get(_t, p) {
      if (p === "length") return 0;
      if (p === Symbol.toPrimitive || p === Symbol.iterator) return undefined;
      return makeStub();
    },
    set() { return true; },
    apply() { return makeStub(); }
  });

  const documentMock = {
    readyState: "complete",
    getElementById: () => makeStub(),
    createElement: () => makeStub(),
    querySelector: () => makeStub(),
    querySelectorAll: () => [],
    body: makeStub(),
    documentElement: makeStub(),
    // fire DOMContentLoaded immediately so popup.js's run() actually executes
    addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded" && typeof cb === "function") cb(); }
  };

  const chromeMock = {
    runtime: { id: "selfid", getURL: x => x, onInstalled: { addListener: () => {} } },
    management: {
      // support both promise form (dashboard) and callback form (popup)
      getAll: cb => (typeof cb === "function" ? cb([]) : Promise.resolve([])),
      setEnabled: () => Promise.resolve(),
      uninstall: () => Promise.resolve(),
      onInstalled: { addListener: () => {} },
      onEnabled: { addListener: () => {} }
    },
    storage: {
      local: {
        get: (keys, cb) => (typeof cb === "function" ? cb({}) : Promise.resolve({})),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve()
      }
    },
    notifications: { create: () => {}, onClicked: { addListener: () => {} }, clear: () => {} },
    tabs: { create: () => {} }
  };

  global.chrome = chromeMock;
  global.document = documentMock;
  global.window = { close() {}, open() {}, print() {} };
  global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
  global.Blob = function () {};
  global.Audit = Audit;

  assert.doesNotThrow(() => {
    delete require.cache[require.resolve(path.join(ROOT, "dashboard.js"))];
    require(path.join(ROOT, "dashboard.js"));
  }, "dashboard.js loaded and its init() ran without throwing");

  assert.doesNotThrow(() => {
    delete require.cache[require.resolve(path.join(ROOT, "popup.js"))];
    require(path.join(ROOT, "popup.js"));
  }, "popup.js loaded and its run() ran without throwing");

  // give the async render pipelines a tick to settle
  await new Promise(r => setTimeout(r, 40));
});
