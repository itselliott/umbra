/* Umbra Collector — status popup.
   Read-only status when enrolled; a small dev-config form when not.
   In production the MSP enrolls the device via a managed-storage policy
   (which always takes precedence) — the form is purely a local-testing
   convenience, writing to chrome.storage.local. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function ago(ts) {
    if (!ts) return "never";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  /* Mirror of the worker's getConfig: managed policy wins, local is the
     dev fallback. */
  async function getConfig() {
    var m = await chrome.storage.managed.get(["enrollmentToken", "apiBase"]);
    if (m.enrollmentToken && m.apiBase) {
      return { apiBase: m.apiBase, source: "managed" };
    }
    var l = await chrome.storage.local.get(["umbra_dev_token", "umbra_dev_apibase"]);
    if (l.umbra_dev_token && l.umbra_dev_apibase) {
      return { apiBase: l.umbra_dev_apibase, source: "local" };
    }
    return null;
  }

  function statusView(cfg, local) {
    document.getElementById("body").innerHTML =
      '<div class="row"><span class="dot ok"></span>Managed &amp; reporting</div>' +
      '<p>Reporting extension inventory to<br><code>' + esc(cfg.apiBase) + '</code></p>' +
      '<p>Last report: ' + ago(local.umbra_last_sync) +
        (local.umbra_pending ? ' &middot; retry queued' : '') + '</p>' +
      '<div class="muted">Device ' + esc(String(local.umbra_device_id || "").slice(0, 8)) +
        '… &middot; ' +
        (cfg.source === "managed"
          ? 'managed by your organization'
          : 'configured locally (dev mode)') +
      '</div>';
  }

  function devFormView() {
    document.getElementById("body").innerHTML =
      '<div class="row"><span class="dot warn"></span>Not yet enrolled</div>' +
      '<p>In production your IT team or MSP enrolls this device through a managed ' +
      'policy. For local testing, connect it manually:</p>' +
      '<div class="form">' +
        '<input id="tokIn" placeholder="Enrollment token" autocomplete="off">' +
        '<input id="apiIn" placeholder="http://localhost:3000" autocomplete="off">' +
        '<button id="connectBtn">Connect</button>' +
      '</div>' +
      '<div class="formMsg" id="formMsg"></div>';

    document.getElementById("connectBtn").addEventListener("click", async function () {
      var tok = document.getElementById("tokIn").value.trim();
      var api = document.getElementById("apiIn").value.trim();
      var msg = document.getElementById("formMsg");
      if (!tok || !api) {
        msg.className = "formMsg";
        msg.textContent = "Both fields are required.";
        return;
      }
      await chrome.storage.local.set({ umbra_dev_token: tok, umbra_dev_apibase: api });
      msg.className = "formMsg ok";
      msg.textContent = "Connected — reporting now.";
      setTimeout(render, 700);
    });
  }

  async function render() {
    var cfg = await getConfig();
    var local = await chrome.storage.local.get([
      "umbra_last_sync", "umbra_device_id", "umbra_pending"
    ]);
    if (cfg) statusView(cfg, local);
    else devFormView();
  }

  document.addEventListener("DOMContentLoaded", render);
})();
