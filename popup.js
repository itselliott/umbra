/* ============================================================
   Umbra — popup
   A compact, at-a-glance read of the current browser's risk,
   with a button into the full dashboard.
   ============================================================ */
(function () {
  "use strict";

  var GRADE_COLOR = {
    A: "var(--low)", B: "var(--low)", C: "var(--medium)",
    D: "var(--high)", F: "var(--critical)"
  };
  var GRADE_BG = {
    A: "var(--low-bg)", B: "var(--low-bg)", C: "var(--medium-bg)",
    D: "var(--high-bg)", F: "var(--critical-bg)"
  };
  var GRADE_LINE = {
    A: "Clean. Nothing high-risk installed.",
    B: "Mostly clean — a few extensions worth reviewing.",
    C: "One high-risk extension is installed.",
    D: "Multiple high-risk extensions are installed.",
    F: "Critical risk — act now."
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    window.close();
  }

  function render(results, sum) {
    document.getElementById("scanned").textContent = sum.total + " extensions";

    var topRisks = results.filter(function (r) {
      return !r.allowlisted && (r.tier === "critical" || r.tier === "high");
    }).slice(0, 3);

    var html = "";

    // grade block
    html += '<div class="gradeRow">';
    html += '<div class="grade" style="background:' + GRADE_BG[sum.grade] + ';color:' + GRADE_COLOR[sum.grade] + '">' + sum.grade + '</div>';
    html += '<div><div class="gt">Browser risk grade</div>';
    html += '<div class="gs">' + GRADE_LINE[sum.grade] + '</div></div>';
    html += '</div>';

    // stats
    html += '<div class="stats">';
    html += '<div class="stat crit"><div class="n">' + sum.critical + '</div><div class="l">Critical</div></div>';
    html += '<div class="stat high"><div class="n">' + sum.high + '</div><div class="l">High</div></div>';
    html += '<div class="stat ai"><div class="n">' + sum.ai + '</div><div class="l">AI access</div></div>';
    html += '</div>';

    // top risks or clean state
    if (topRisks.length) {
      html += '<div class="top">Your riskiest extensions</div>';
      topRisks.forEach(function (r) {
        html += '<div class="risk">';
        html += '<div class="ri">' + (r.icon ? '<img src="' + esc(r.icon) + '" alt="">' : '◉') + '</div>';
        html += '<div class="rn">' + esc(r.name) + '</div>';
        html += '<div class="rp s-' + r.tier + '">' + r.score + '</div>';
        html += '</div>';
      });
    } else {
      html += '<div class="clean">✓ &nbsp;No high-risk extensions found in this browser.</div>';
    }

    html += '<button class="btn" id="open">Open full audit →</button>';
    html += '<div class="foot">Runs entirely on your device. Nothing is uploaded.</div>';

    var body = document.getElementById("body");
    body.innerHTML = html;
    document.getElementById("open").addEventListener("click", openDashboard);
  }

  function applyTheme(theme) {
    if (!theme || !theme.vars) return;
    var root = document.documentElement;
    Object.keys(theme.vars).forEach(function (k) {
      root.style.setProperty(k, theme.vars[k]);
    });
  }

  function run() {
    chrome.storage.local.get(["allowlist", "theme"], function (data) {
      applyTheme(data && data.theme);
      var allow = (data && data.allowlist) || [];
      chrome.management.getAll(function (exts) {
        var results = Audit.auditAll(exts, chrome.runtime.id, allow);
        var sum = Audit.summarize(results);
        render(results, sum);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", run);
})();
