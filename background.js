/* ============================================================
   Umbra — background service worker
   Two jobs:
     1. Real-time watch — warn on a newly installed risky
        extension, AND warn when an already-installed extension
        EXPANDS its permissions in an update (the classic
        "benign extension gets bought and weaponised" attack).
     2. Toolbar badge — a live count of critical- (red) and
        high-risk (orange) extensions on the Umbra icon.
   ============================================================ */
importScripts("audit.js");

var SNAP_KEY = "permSnapshots";

/* ---------- helpers ---------- */
function joinList(arr) {
  if (!arr.length) return "more access";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + " and " + arr[1];
  return arr.slice(0, -1).join(", ") + ", and " + arr[arr.length - 1];
}

function saveSnapshots(snaps) {
  var obj = {};
  obj[SNAP_KEY] = snaps;
  return chrome.storage.local.set(obj);
}

/* ---------- toolbar badge ---------- */
function updateBadge() {
  return Promise.all([
    chrome.management.getAll(),
    chrome.storage.local.get("allowlist")
  ]).then(function (out) {
    var exts = out[0] || [];
    var allow = (out[1] && out[1].allowlist) || [];
    var results = Audit.auditAll(exts, chrome.runtime.id, allow);

    var critical = 0, high = 0;
    results.forEach(function (r) {
      if (r.allowlisted) return;
      if (r.tier === "critical") critical++;
      else if (r.tier === "high") high++;
    });

    var text = "", color = "#3ecf8e", title = "Umbra — audit your extensions";
    if (critical) {
      text = String(critical);
      color = "#ff4d5e";
      title = "Umbra — " + critical + " critical-risk extension" + (critical === 1 ? "" : "s") + " active";
    } else if (high) {
      text = String(high);
      color = "#ff8c42";
      title = "Umbra — " + high + " high-risk extension" + (high === 1 ? "" : "s") + " to review";
    }

    chrome.action.setBadgeBackgroundColor({ color: color });
    chrome.action.setBadgeText({ text: text });
    chrome.action.setTitle({ title: title });
  }).catch(function () { /* worker can race during startup — ignore */ });
}

/* ---------- permission snapshots ---------- */
function snapshotAll() {
  return chrome.management.getAll().then(function (exts) {
    var snaps = {};
    exts.forEach(function (e) {
      if (e.type !== "extension" || e.id === chrome.runtime.id) return;
      snaps[e.id] = {
        version: e.version,
        permissions: e.permissions || [],
        hostPermissions: e.hostPermissions || []
      };
    });
    return saveSnapshots(snaps);
  });
}

function notifyRiskyInstall(info) {
  var a = Audit.score(info);
  if (a.tier !== "critical" && a.tier !== "high") return false;
  var plain = Audit.plainEnglish(a).replace(/<[^>]+>/g, "");
  chrome.notifications.create("umbra-new-" + info.id, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Umbra: " + (a.tier === "critical" ? "Critical" : "High") + "-risk extension just installed",
    message: "\"" + info.name + "\" — " + plain,
    priority: 2,
    requireInteraction: a.tier === "critical"
  });
  return true;
}

/* Compare an updated extension against its stored snapshot. Notifies only
   when permissions were ADDED *and* Umbra's risk score actually rose, so a
   harmless add (e.g. "alarms") stays quiet. */
function notifyExpansion(info, prev) {
  var prevPerms = prev.permissions || [];
  var prevHosts = prev.hostPermissions || [];
  var curPerms = info.permissions || [];
  var curHosts = info.hostPermissions || [];

  var addedPerms = curPerms.filter(function (p) { return prevPerms.indexOf(p) === -1; });
  var addedHosts = curHosts.filter(function (h) { return prevHosts.indexOf(h) === -1; });
  if (!addedPerms.length && !addedHosts.length) return false;

  var prevScore = Audit.score({
    id: info.id, name: info.name, type: "extension",
    permissions: prevPerms, hostPermissions: prevHosts, installType: info.installType
  }).score;
  var now = Audit.score(info);
  if (now.score <= prevScore) return false; // permissions changed, but not riskier — stay quiet

  var bits = [];
  addedPerms.forEach(function (p) {
    bits.push(Audit.PERM_LABEL[p] || ("the \"" + p + "\" capability"));
  });
  var prevBroad = Audit.score({
    id: info.id, type: "extension", permissions: [], hostPermissions: prevHosts
  }).hostInfo.broad;
  if (now.hostInfo.broad && !prevBroad) {
    bits.push("the ability to read and change every website you visit");
  } else if (addedHosts.length) {
    bits.push("access to " + addedHosts.length + " more site" + (addedHosts.length === 1 ? "" : "s"));
  }

  chrome.notifications.create("umbra-expand-" + info.id + "-" + info.version, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Umbra: \"" + info.name + "\" expanded its permissions",
    message: "After updating to v" + info.version + " it now also wants " + joinList(bits) +
      ". Its Umbra risk score rose from " + prevScore + " to " + now.score +
      ". Open Umbra to review whether that's expected.",
    priority: 2,
    requireInteraction: now.tier === "critical"
  });
  return true;
}

/* Fires for both fresh installs and updates. */
function handleInstalled(info) {
  if (!info || info.id === chrome.runtime.id || info.type !== "extension") {
    return updateBadge();
  }
  return chrome.storage.local.get(SNAP_KEY).then(function (d) {
    var snaps = (d && d[SNAP_KEY]) || {};
    var prev = snaps[info.id];
    if (prev) {
      notifyExpansion(info, prev);     // already known — diff its permissions
    } else {
      notifyRiskyInstall(info);        // brand-new — run the risk check
    }
    snaps[info.id] = {
      version: info.version,
      permissions: info.permissions || [],
      hostPermissions: info.hostPermissions || []
    };
    return saveSnapshots(snaps);
  }).then(updateBadge);
}

/* ---------- events ---------- */
chrome.management.onInstalled.addListener(handleInstalled);

chrome.management.onUninstalled.addListener(function (id) {
  var cleanup = chrome.storage.local.get(SNAP_KEY).then(function (d) {
    var snaps = (d && d[SNAP_KEY]) || {};
    if (snaps[id]) {
      delete snaps[id];
      return saveSnapshots(snaps);
    }
  });
  return Promise.all([cleanup, updateBadge()]);
});

chrome.management.onEnabled.addListener(function (info) {
  if (info && info.type === "extension" && info.id !== chrome.runtime.id) {
    var a = Audit.score(info);
    if (a.tier === "critical") {
      chrome.notifications.create("umbra-enabled-" + info.id, {
        type: "basic",
        iconUrl: "icon128.png",
        title: "Umbra: a critical-risk extension was just enabled",
        message: "\"" + info.name + "\" is active again. Open Umbra to review it.",
        priority: 2
      });
    }
  }
  return updateBadge();
});

chrome.management.onDisabled.addListener(function () { return updateBadge(); });

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes.allowlist) updateBadge();
});

chrome.notifications.onClicked.addListener(function (id) {
  chrome.notifications.clear(id);
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onInstalled.addListener(function (details) {
  snapshotAll().then(updateBadge);
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  }
});

chrome.runtime.onStartup.addListener(function () { updateBadge(); });

/* refresh the badge as soon as the worker spins up */
updateBadge();
