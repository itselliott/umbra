/* ============================================================
   Umbra Collector — managed background service worker

   Reports this device's browser-extension inventory to the Umbra
   backend. It does NO local scoring and has NO audit UI — the
   backend scores (with the same @umbra/core engine), and the admin
   reviews everything in the Umbra console.

   Configured centrally: the MSP injects { enrollmentToken, apiBase }
   through a Google Workspace / MDM managed-storage policy. Until
   that arrives the collector sits idle ("not yet enrolled").

   Reports on: install, browser startup, any extension install/
   uninstall/enable/disable (debounced), a managed-config change,
   and a ~daily alarm. A failed POST is queued and retried.
   ============================================================ */
"use strict";

const DEVICE_ID_KEY = "umbra_device_id";
const QUEUE_KEY = "umbra_pending";
const LAST_SYNC_KEY = "umbra_last_sync";
const REPORT_ALARM = "umbra-report";
const DEBOUNCE_MS = 4000;
const PERIOD_MIN = 720; // ~daily

/* ---- central config ----
   Production: injected by the admin's managed-storage policy.
   Dev fallback: a locally-set config (umbra_dev_*), so the whole loop can
   be tested on one machine without a Workspace/MDM policy. Managed wins. */
async function getConfig() {
  const m = await chrome.storage.managed.get(["enrollmentToken", "apiBase"]);
  if (m.enrollmentToken && m.apiBase) {
    return {
      enrollmentToken: m.enrollmentToken,
      apiBase: m.apiBase.replace(/\/+$/, ""),
      source: "managed"
    };
  }
  const l = await chrome.storage.local.get(["umbra_dev_token", "umbra_dev_apibase"]);
  return {
    enrollmentToken: l.umbra_dev_token || null,
    apiBase: (l.umbra_dev_apibase || "").replace(/\/+$/, ""),
    source: "local"
  };
}

/* ---- stable per-device identifier (generated once, then persisted) ---- */
async function getDeviceId() {
  const d = await chrome.storage.local.get(DEVICE_ID_KEY);
  if (d[DEVICE_ID_KEY]) return d[DEVICE_ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

/* ---- build the inventory payload (null when not enrolled) ---- */
async function buildReport() {
  const cfg = await getConfig();
  if (!cfg.enrollmentToken || !cfg.apiBase) return null;
  const deviceId = await getDeviceId();
  const exts = await chrome.management.getAll();
  return {
    apiBase: cfg.apiBase,
    body: {
      enrollmentToken: cfg.enrollmentToken,
      device: { hostname: deviceId, userAgent: navigator.userAgent },
      extensions: exts.filter(function (e) {
        return e.type === "extension" && e.id !== chrome.runtime.id;
      })
    }
  };
}

/* ---- send it, with a one-slot offline retry queue ---- */
async function report() {
  const r = await buildReport();
  if (!r) return; // not enrolled yet — nothing to do
  try {
    const res = await fetch(r.apiBase + "/v1/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r.body)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await chrome.storage.local.set({ [LAST_SYNC_KEY]: Date.now() });
    await chrome.storage.local.remove(QUEUE_KEY);
  } catch (e) {
    // keep the latest payload; the next event or the daily alarm retries it
    await chrome.storage.local.set({
      [QUEUE_KEY]: { apiBase: r.apiBase, body: r.body, at: Date.now() }
    });
  }
}

/* ---- debounce: one user action can fire several management events ---- */
let debounceTimer = null;
function scheduleReport() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(report, DEBOUNCE_MS);
}

function ensureAlarm() {
  chrome.alarms.create(REPORT_ALARM, { periodInMinutes: PERIOD_MIN });
}

/* ---- events ---- */
chrome.runtime.onInstalled.addListener(function () { ensureAlarm(); report(); });
chrome.runtime.onStartup.addListener(function () { ensureAlarm(); report(); });

chrome.management.onInstalled.addListener(scheduleReport);
chrome.management.onUninstalled.addListener(scheduleReport);
chrome.management.onEnabled.addListener(scheduleReport);
chrome.management.onDisabled.addListener(scheduleReport);

chrome.storage.onChanged.addListener(function (changes, area) {
  // a managed-config change means the device was just enrolled or re-pointed
  if (area === "managed") return report();
  // dev fallback: react to a locally-set config change too
  if (area === "local" && (changes.umbra_dev_token || changes.umbra_dev_apibase)) {
    return report();
  }
});

chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name === REPORT_ALARM) report();
});

/* refresh on worker spin-up */
ensureAlarm();
report();
