/* ============================================================
   Umbra — dashboard
   Reads the real extensions installed in this browser via
   chrome.management, scores them locally, and lets you act:
   disable, uninstall, or allowlist — for real.
   MV3-safe: no inline script, all wiring via addEventListener.
   ============================================================ */
(function () {
  "use strict";

  var SEV_COLOR = {
    critical: "var(--critical)", high: "var(--high)",
    medium: "var(--medium)", low: "var(--low)"
  };
  var SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  var TIER_LABEL = {
    critical: "Critical risk", high: "High risk",
    medium: "Medium risk", low: "Low risk"
  };
  var GRADE_COLOR = {
    A: "var(--low)", B: "var(--low)", C: "var(--medium)",
    D: "var(--high)", F: "var(--critical)"
  };
  var GRADE_BG = {
    A: "var(--low-bg)", B: "var(--low-bg)", C: "var(--medium-bg)",
    D: "var(--high-bg)", F: "var(--critical-bg)"
  };
  var SOURCE_LABEL = {
    normal: "Chrome Web Store", admin: "Admin policy",
    development: "Developer mode", sideload: "Sideloaded", other: "Other source"
  };

  var state = {
    results: [], summary: null, filter: "all", query: "",
    allow: [], openId: null, scanTime: null
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function topReason(a) {
    if (!a.reasons.length) return null;
    return a.reasons.slice().sort(function (x, y) {
      return SEV_RANK[x.sev] - SEV_RANK[y.sev];
    })[0];
  }
  function iconHtml(a, cls) {
    if (a.icon) {
      return '<div class="' + cls + '"><img class="ext-thumb" src="' + esc(a.icon) + '" alt=""></div>';
    }
    var glyph = a.aiInterposing ? "✦" : "◉";
    return '<div class="' + cls + '">' + glyph + "</div>";
  }
  function wireImages() {
    var imgs = document.querySelectorAll("img.ext-thumb");
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener("error", function () {
        var p = this.parentNode;
        if (p) { this.remove(); p.textContent = "◉"; }
      });
    }
  }
  var toastTimer;
  function toast(msg, kind) {
    var el = $("toast");
    el.className = "toast" + (kind === "err" ? " err" : "");
    el.innerHTML = kind === "ok" ? "<b>✓</b>&nbsp;&nbsp;" + esc(msg)
                 : kind === "err" ? "<b>!</b>&nbsp;&nbsp;" + esc(msg)
                 : esc(msg);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  /* ---------- data ---------- */
  function refresh() {
    return Promise.all([
      chrome.management.getAll(),
      chrome.storage.local.get("allowlist")
    ]).then(function (out) {
      var exts = out[0] || [];
      state.allow = (out[1] && out[1].allowlist) || [];
      state.results = Audit.auditAll(exts, chrome.runtime.id, state.allow);
      state.summary = Audit.summarize(state.results);
      state.scanTime = new Date();
      renderAll();
    });
  }

  function persistAllow() {
    return chrome.storage.local.set({ allowlist: state.allow });
  }

  /* ---------- render: header / cards / hero / chips ---------- */
  function renderAll() {
    var s = state.summary;
    $("scopeCount").textContent = "· " + s.total + " extensions";
    $("scanTime").textContent = "Scanned " + state.scanTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    renderCards();
    renderHero();
    renderChips();
    renderTable();
    wireImages();
    if (state.openId) {
      var still = state.results.filter(function (r) { return r.id === state.openId; })[0];
      if (still) openDrawer(state.openId); else closeDrawer();
    }
  }

  function renderCards() {
    var s = state.summary;
    var cards = [
      { lbl: "Extensions", val: s.total, sub: s.enabled + " currently enabled" },
      { lbl: "Critical risk", val: s.critical, sub: s.high + " more rated high", alarm: s.critical > 0 },
      { lbl: "Broad access", val: s.broad, sub: "can read every site you visit", alarm: s.broad > 0 },
      { lbl: "Touch AI tools", val: s.ai, sub: "can read your AI chats", alarm: s.ai > 0 },
      { lbl: "Risk grade", grade: s.grade, sub: s.allowlisted + " allowlisted, not counted" }
    ];
    $("cards").innerHTML = cards.map(function (c) {
      return '<div class="card ' + (c.alarm ? "alarm" : "") + '">' +
        '<div class="lbl">' + c.lbl + "</div>" +
        (c.grade
          ? '<div class="grade" style="background:' + GRADE_BG[c.grade] + ";color:" + GRADE_COLOR[c.grade] + '">' + c.grade + "</div>"
          : '<div class="val">' + c.val + "</div>") +
        '<div class="sub">' + c.sub + "</div></div>";
    }).join("");
  }

  function renderHero() {
    var hero = $("hero"), s = state.summary;
    var risky = state.results.filter(function (r) {
      return !r.allowlisted && (r.tier === "critical" || r.tier === "high");
    });
    hero.style.display = "flex";

    if (!risky.length) {
      hero.className = "hero ok";
      $("heroIco").textContent = "✅";
      $("heroTitle").textContent = "No high-risk extensions in this browser";
      $("heroText").innerHTML = "Umbra found nothing critical or high-risk right now. "
        + "It will keep watching — you'll get a notification the moment a risky extension is installed.";
      $("heroActs").innerHTML = "";
      return;
    }

    hero.className = "hero bad";
    $("heroIco").textContent = "🚨";
    $("heroTitle").textContent = "This browser is exposed right now";

    var crit = risky.filter(function (r) { return r.tier === "critical"; });
    var aiRisky = risky.filter(function (r) { return r.aiInterposing; });
    var lead = crit.length
      ? "<b>" + crit.length + " critical</b> and " + (risky.length - crit.length) + " high-risk extension"
        + (risky.length - crit.length === 1 ? "" : "s")
      : "<b>" + risky.length + " high-risk extension" + (risky.length === 1 ? "" : "s") + "</b>";
    var aiBit = aiRisky.length
      ? " — and " + aiRisky.length + " of them can read everything you type into ChatGPT, Claude, and other AI tools"
      : "";
    $("heroText").innerHTML = lead + " " + (risky.length === 1 ? "is" : "are")
      + " installed and active in this browser" + aiBit
      + ". Open any row below for a plain-English breakdown and one-click removal.";

    var acts = "";
    if (crit.length) acts += '<button class="btn danger" data-act="disable-critical">Disable all critical (' + crit.length + ")</button>";
    acts += '<button class="btn ghost" data-act="export">Export audit report</button>';
    $("heroActs").innerHTML = acts;
  }

  function renderChips() {
    var r = state.results;
    var counts = {
      all: r.length,
      critical: r.filter(function (x) { return x.tier === "critical"; }).length,
      high: r.filter(function (x) { return x.tier === "high"; }).length,
      medium: r.filter(function (x) { return x.tier === "medium"; }).length,
      low: r.filter(function (x) { return x.tier === "low"; }).length,
      ai: r.filter(function (x) { return x.aiInterposing; }).length,
      allow: r.filter(function (x) { return x.allowlisted; }).length
    };
    var defs = [
      ["all", "All"], ["critical", "Critical"], ["high", "High"],
      ["medium", "Medium"], ["low", "Low"], ["ai", "Touches AI"], ["allow", "Allowlisted"]
    ];
    $("chips").innerHTML = defs.map(function (d) {
      return '<div class="chip ' + (state.filter === d[0] ? "active" : "") + '" data-filter="' + d[0] + '">' +
        d[1] + '<span class="n">' + counts[d[0]] + "</span></div>";
    }).join("");
  }

  /* ---------- render: table ---------- */
  function visibleRows() {
    var q = state.query.toLowerCase();
    return state.results.filter(function (a) {
      if (state.filter === "ai" && !a.aiInterposing) return false;
      if (state.filter === "allow" && !a.allowlisted) return false;
      if (["critical", "high", "medium", "low"].indexOf(state.filter) !== -1 && a.tier !== state.filter) return false;
      if (q && a.name.toLowerCase().indexOf(q) === -1 && a.id.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderTable() {
    var rows = visibleRows();
    if (!rows.length) {
      $("rows").innerHTML = '<tr><td colspan="6" class="empty">No extensions match this filter.</td></tr>';
      return;
    }
    $("rows").innerHTML = rows.map(function (a) {
      var tr = topReason(a);
      var flags = [];
      if (a.aiInterposing) flags.push('<span class="badge ai">✦ Touches AI</span>');
      if (a.installType === "sideload" || a.installType === "other")
        flags.push('<span class="badge sideload">⚠ Sideloaded</span>');
      if (a.installType === "development")
        flags.push('<span class="badge sideload">⚠ Dev mode</span>');
      if (!a.enabled) flags.push('<span class="badge disabled">● Disabled</span>');
      if (a.trusted) flags.push('<span class="badge trusted">✓ Verified</span>');
      if (a.allowlisted) flags.push('<span class="badge allow">✓ Allowlisted</span>');
      var flagsHtml = flags.length ? '<div class="flags">' + flags.join("") + "</div>" : '<span class="dash">—</span>';

      return '<tr data-id="' + esc(a.id) + '" class="' + (a.allowlisted || !a.enabled ? "row-muted" : "") + '">' +
        '<td><div class="ext-cell">' + iconHtml(a, "ext-icon") +
          '<div><div class="ext-name">' + esc(a.name) + "</div>" +
          '<div class="ext-sub">v' + esc(a.version) + " · " + esc(a.id.slice(0, 16)) + "…</div></div></div></td>" +
        "<td>" + flagsHtml + "</td>" +
        '<td style="font-size:12.5px;color:var(--muted)">' + (SOURCE_LABEL[a.installType] || a.installType) + "</td>" +
        '<td style="font-size:12.5px;color:var(--muted)">' + (tr ? esc(tr.text) : "Minimal permissions") + "</td>" +
        '<td><span class="score-pill s-' + a.tier + '">' + a.score + "</span></td>" +
        '<td><span class="chev">›</span></td></tr>';
    }).join("");
  }

  /* ---------- drawer ---------- */
  function openDrawer(id) {
    var a = state.results.filter(function (r) { return r.id === id; })[0];
    if (!a) return;
    state.openId = id;

    var perms = a.reasons.slice().sort(function (x, y) { return SEV_RANK[x.sev] - SEV_RANK[y.sev]; });
    var rem = Audit.remediation(a);

    var sourceLine = SOURCE_LABEL[a.installType] || a.installType;
    if (!a.enabled) sourceLine += " · currently disabled";
    if (a.mayDisable === false) sourceLine += " · locked on";

    var hostBlock = "";
    if (a.hostPermissions && a.hostPermissions.length) {
      hostBlock = '<div class="sec"><h4>Sites it can access (' + a.hostPermissions.length + ')</h4>' +
        '<div class="hostlist">' + a.hostPermissions.map(esc).join("<br>") + "</div></div>";
    }

    var actions = "";
    if (a.enabled) {
      actions += '<button class="btn danger" data-act="disable" data-id="' + esc(a.id) + '">Disable now</button>';
    } else {
      actions += '<button class="btn" data-act="enable" data-id="' + esc(a.id) + '">Re-enable</button>';
    }
    actions += '<button class="btn" data-act="uninstall" data-id="' + esc(a.id) + '">Uninstall…</button>';
    actions += a.allowlisted
      ? '<button class="btn ghost" data-act="unallow" data-id="' + esc(a.id) + '">Remove from allowlist</button>'
      : '<button class="btn ghost" data-act="allow" data-id="' + esc(a.id) + '">Add to allowlist</button>';

    var lockedNote = a.mayDisable === false
      ? '<div class="note">This extension is locked on (often an enterprise policy). If you did not expect that, contact whoever manages this device — Umbra cannot disable a policy-managed extension.</div>'
      : "";

    $("drawer").innerHTML =
      '<div class="drawer-head">' +
        '<button class="close" data-act="close">✕</button>' +
        '<div class="dh-top">' + iconHtml(a, "dh-icon") +
          '<div><h3>' + esc(a.name) + "</h3>" +
          '<div class="pub">v' + esc(a.version) + " · " + esc(sourceLine) + "</div></div></div>" +
      "</div>" +
      '<div class="drawer-body">' +
        '<div class="score-block s-' + a.tier + '">' +
          '<div class="score-num" style="color:' + SEV_COLOR[a.tier] + '">' + a.score + "</div>" +
          '<div class="meta"><div class="tier" style="color:' + SEV_COLOR[a.tier] + '">' + TIER_LABEL[a.tier] + "</div>" +
            '<div class="ml">' + esc(a.id) + "</div>" +
            (a.aiInterposing ? '<div class="ml" style="color:#b9a6ff">✦ Can read what you type into AI tools</div>' : "") +
          "</div></div>" +

        '<div class="sec"><h4>What it can do</h4>' +
          perms.map(function (p) {
            return '<div class="perm"><span class="dot" style="background:' + SEV_COLOR[p.sev] + '"></span>' +
              '<span class="ptext">' + esc(p.text) + "</span>" +
              '<span class="psev" style="color:' + SEV_COLOR[p.sev] + '">' + p.sev + "</span></div>";
          }).join("") +
        "</div>" +

        '<div class="sec"><h4>In plain English</h4>' +
          '<div class="prose">' + Audit.plainEnglish(a) + "</div></div>" +

        '<div class="sec"><h4>Why Umbra flagged it</h4>' +
          '<div class="prose warn">' + esc(Audit.whyFlagged(a)) + "</div></div>" +

        hostBlock +

        '<div class="sec"><h4>Recommended action</h4>' +
          '<ol class="remediation">' + rem.map(function (r, i) {
            return "<li><span class=\"step\">" + (i + 1) + "</span>" + esc(r) + "</li>";
          }).join("") + "</ol></div>" +

        '<div class="drawer-actions">' + actions + "</div>" +
        lockedNote +
      "</div>";

    $("drawer").classList.add("open");
    $("scrim").classList.add("open");
    wireImages();
  }

  function closeDrawer() {
    state.openId = null;
    $("drawer").classList.remove("open");
    $("scrim").classList.remove("open");
  }

  /* ---------- real actions ---------- */
  function doDisable(id) {
    var a = byId(id);
    chrome.management.setEnabled(id, false).then(function () {
      toast('"' + a.name + '" disabled', "ok");
      return refresh();
    }).catch(function (e) {
      toast("Couldn't disable: " + friendlyErr(e), "err");
    });
  }
  function doEnable(id) {
    var a = byId(id);
    chrome.management.setEnabled(id, true).then(function () {
      toast('"' + a.name + '" re-enabled');
      return refresh();
    }).catch(function (e) {
      toast("Couldn't enable: " + friendlyErr(e), "err");
    });
  }
  function doUninstall(id) {
    var a = byId(id);
    chrome.management.uninstall(id, { showConfirmDialog: true }).then(function () {
      toast('"' + a.name + '" uninstalled', "ok");
      state.openId = null;
      return refresh();
    }).catch(function (e) {
      var m = String(e && e.message || e);
      if (/cancell?ed/i.test(m)) return; // user backed out of Chrome's dialog
      toast("Couldn't uninstall: " + friendlyErr(e), "err");
    });
  }
  function doAllow(id, add) {
    var a = byId(id);
    var i = state.allow.indexOf(id);
    if (add && i === -1) state.allow.push(id);
    if (!add && i !== -1) state.allow.splice(i, 1);
    persistAllow().then(refresh).then(function () {
      toast(add ? '"' + a.name + '" added to allowlist — alert silenced'
                : '"' + a.name + '" removed from allowlist', "ok");
    });
  }
  function disableAllCritical() {
    var crit = state.results.filter(function (r) {
      return r.tier === "critical" && r.enabled && r.mayDisable !== false && !r.allowlisted;
    });
    if (!crit.length) { toast("No critical extensions can be auto-disabled."); return; }
    Promise.all(crit.map(function (r) {
      return chrome.management.setEnabled(r.id, false).catch(function () { return null; });
    })).then(function () {
      return refresh();
    }).then(function () {
      toast(crit.length + " critical extension" + (crit.length === 1 ? "" : "s") + " disabled", "ok");
    });
  }
  function byId(id) {
    return state.results.filter(function (r) { return r.id === id; })[0] || { name: "Extension" };
  }
  function friendlyErr(e) {
    var m = String(e && e.message || e || "unknown error");
    if (/policy|force/i.test(m)) return "it is managed by an enterprise policy.";
    return m;
  }

  /* ---------- export ---------- */
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  /* Build a polished, print-optimized standalone HTML report.
     Opened from disk it is an ordinary file:// page (not an extension
     page), so its inline "Save as PDF" button works normally. */
  function buildReportHtml() {
    var s = state.summary;
    var when = state.scanTime.toLocaleString();
    var ordered = state.results.slice().sort(function (a, b) {
      if (a.allowlisted !== b.allowlisted) return a.allowlisted ? 1 : -1;
      return b.score - a.score;
    });
    var GBG = { A: "#dcfce7", B: "#dcfce7", C: "#fef9c3", D: "#ffedd5", F: "#fee2e2" };
    var GFG = { A: "#15803d", B: "#15803d", C: "#b45309", D: "#c2410c", F: "#dc2626" };
    var sentence = s.critical > 0
      ? s.critical + " critical extension" + (s.critical === 1 ? "" : "s") + " need immediate removal."
      : s.high > 0
        ? s.high + " high-risk extension" + (s.high === 1 ? "" : "s") + " should be reviewed."
        : s.medium > 0 ? "A few extensions are worth a periodic review."
          : "No high-risk extensions found in this browser.";

    var rows = ordered.map(function (a) {
      var tr = topReason(a);
      var risk = a.allowlisted ? "ALLOWLISTED" : a.tier.toUpperCase();
      var cls = a.allowlisted ? "t-allow" : "t-" + a.tier;
      return '<tr class="' + cls + '">' +
        '<td class="name">' + esc(a.name) + '<div class="id">' + esc(a.id) + '</div></td>' +
        '<td class="ctr num">' + a.score + '</td>' +
        '<td class="risk">' + risk + '</td>' +
        '<td>' + esc(SOURCE_LABEL[a.installType] || a.installType) + (a.enabled ? '' : ' &middot; disabled') + '</td>' +
        '<td class="ctr">' + (a.aiInterposing ? '&#9679;' : '') + '</td>' +
        '<td class="ctr">' + (a.hostInfo.broad ? '&#9679;' : '') + '</td>' +
        '<td class="reason">' + (tr ? esc(tr.text) : 'Minimal permissions') + '</td></tr>';
    }).join("");

    var flagged = ordered.filter(function (a) {
      return !a.allowlisted && (a.tier === "critical" || a.tier === "high");
    });
    var details = flagged.map(function (a) {
      return '<div class="detail t-' + a.tier + '">' +
        '<div class="dh"><span class="dnum">' + a.score + '</span>' +
        '<div><div class="dname">' + esc(a.name) + '</div>' +
        '<div class="id">' + esc(a.id) + '</div></div>' +
        '<span class="dtag">' + a.tier.toUpperCase() + '</span></div>' +
        '<p class="dp">' + esc(Audit.plainEnglish(a).replace(/<\/?b>/g, "")) + '</p>' +
        '<p class="dwhy"><b>Why flagged:</b> ' + esc(Audit.whyFlagged(a)) + '</p>' +
        '<p class="dwhy"><b>Recommended:</b> ' + esc(Audit.remediation(a).join(" ")) + '</p></div>';
    }).join("");

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<title>Umbra Extension Risk Audit</title><style>' +
      '*{box-sizing:border-box}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
        'color:#1a1d26;line-height:1.55;margin:0;background:#f4f5f7}' +
      '.bar{position:sticky;top:0;background:#13161f;color:#fff;display:flex;align-items:center;' +
        'gap:14px;padding:12px 22px}' +
      '.bar .t{font-weight:700;font-size:14px;flex:1}.bar .h{color:#9aa0b3;font-size:12px}' +
      '.bar button{background:#7c5cff;color:#fff;border:0;font-weight:700;font-size:13px;' +
        'padding:9px 16px;border-radius:8px;cursor:pointer;font-family:inherit}' +
      '.sheet{max-width:840px;margin:0 auto;background:#fff;padding:44px 54px 60px}' +
      'h1{font-size:23px;margin:0;letter-spacing:-.3px}' +
      '.sub{color:#6b7280;font-size:13px;margin:5px 0 0}' +
      '.grow{display:flex;align-items:center;gap:16px;margin:24px 0 6px}' +
      '.grade{width:58px;height:58px;border-radius:13px;display:flex;align-items:center;' +
        'justify-content:center;font-size:32px;font-weight:800}' +
      '.grow .gl{font-size:12px;color:#6b7280}.grow .gv{font-size:15px;font-weight:700;margin-top:1px}' +
      '.sum{display:flex;gap:9px;margin:18px 0 4px;flex-wrap:wrap}' +
      '.sum div{border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;font-size:11.5px;color:#6b7280}' +
      '.sum b{display:block;font-size:21px;color:#1a1d26;font-weight:800}' +
      'h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;' +
        'margin:34px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}' +
      'th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #eef0f2;vertical-align:top}' +
      'th{font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;border-bottom:1px solid #e5e7eb}' +
      '.ctr{text-align:center}td.name{font-weight:600;min-width:160px}' +
      '.id{color:#9ca3af;font-size:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:400}' +
      'td.risk{font-weight:700;font-size:10.5px}.reason{color:#4b5563}' +
      'tr.t-critical td.risk,tr.t-critical td.num{color:#dc2626}' +
      'tr.t-high td.risk,tr.t-high td.num{color:#ea580c}' +
      'tr.t-medium td.risk,tr.t-medium td.num{color:#b45309}' +
      'tr.t-low td.risk,tr.t-low td.num{color:#15803d}tr.t-allow td.risk{color:#9ca3af}' +
      '.detail{border:1px solid #e5e7eb;border-left-width:4px;border-radius:8px;padding:13px 16px;margin:10px 0}' +
      '.detail.t-critical{border-left-color:#dc2626}.detail.t-high{border-left-color:#ea580c}' +
      '.dh{display:flex;align-items:center;gap:11px}.dnum{font-size:22px;font-weight:800}' +
      '.detail.t-critical .dnum{color:#dc2626}.detail.t-high .dnum{color:#ea580c}' +
      '.dname{font-weight:700;font-size:14px}.dtag{margin-left:auto;font-size:10px;font-weight:700;' +
        'letter-spacing:.5px;color:#6b7280}' +
      '.dp{margin:9px 0 0;font-size:13px}.dwhy{margin:6px 0 0;font-size:12.5px;color:#4b5563}' +
      'footer{margin-top:34px;padding-top:13px;border-top:1px solid #e5e7eb;color:#9ca3af;' +
        'font-size:11px;line-height:1.6}' +
      '@media print{body{background:#fff}.bar{display:none}.sheet{max-width:none;padding:0}' +
        'tr,.detail{break-inside:avoid}h2{break-after:avoid}@page{margin:16mm}}' +
      '</style></head><body>' +
      '<div class="bar"><span class="t">&#9685; Umbra &mdash; Extension Risk Audit</span>' +
        '<span class="h">Pick &ldquo;Save as PDF&rdquo; as the destination</span>' +
        '<button onclick="window.print()">Save as PDF</button></div>' +
      '<div class="sheet"><h1>Extension Risk Audit</h1>' +
      '<p class="sub">Generated ' + esc(when) + ' &middot; ' + s.total + ' extensions scanned in this browser</p>' +
      '<div class="grow"><div class="grade" style="background:' + GBG[s.grade] + ';color:' + GFG[s.grade] + '">' +
        s.grade + '</div><div><div class="gl">Overall browser risk grade</div>' +
        '<div class="gv">' + esc(sentence) + '</div></div></div>' +
      '<div class="sum">' +
        '<div><b>' + s.critical + '</b>Critical</div>' +
        '<div><b>' + s.high + '</b>High</div>' +
        '<div><b>' + s.broad + '</b>Read every site</div>' +
        '<div><b>' + s.ai + '</b>Touch AI tools</div>' +
        '<div><b>' + s.enabled + '</b>Enabled</div>' +
        '<div><b>' + s.allowlisted + '</b>Allowlisted</div></div>' +
      (details ? '<h2>Flagged extensions &mdash; action needed</h2>' + details : '') +
      '<h2>Full inventory</h2>' +
      '<table><thead><tr><th>Extension</th><th class="ctr">Score</th><th>Risk</th><th>Source</th>' +
        '<th class="ctr">AI</th><th class="ctr">All sites</th><th>Top reason</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<footer>Generated locally by Umbra (concept build v0.1.0) from the chrome.management API. ' +
      'No data left this device. &ldquo;AI&rdquo; marks extensions that can read content on AI tools such as ' +
      'ChatGPT and Claude; &ldquo;All sites&rdquo; marks extensions that can read and change every page you visit. ' +
      'Reputation signals are seeded in this build and fully populated by the cloud threat-intelligence service ' +
      'in the production version.</footer></div></body></html>';
  }

  function exportPdf() {
    download("umbra-audit-" + stamp() + ".html", buildReportHtml(), "text/html");
    toast("Print-ready report downloaded — open it, then click “Save as PDF”", "ok");
    closeExportMenu();
  }

  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportCsv() {
    var head = ["Extension", "Extension ID", "Version", "Risk score", "Risk tier", "Source",
      "Enabled", "Touches AI tools", "Reads all sites", "Allowlisted", "Top reason",
      "API permissions", "Host permissions"];
    var lines = [head.map(csvCell).join(",")];
    state.results.forEach(function (a) {
      var tr = topReason(a);
      lines.push([
        a.name, a.id, a.version, a.score, a.tier,
        SOURCE_LABEL[a.installType] || a.installType,
        a.enabled ? "yes" : "no",
        a.aiInterposing ? "yes" : "no",
        a.hostInfo.broad ? "yes" : "no",
        a.allowlisted ? "yes" : "no",
        tr ? tr.text : "Minimal permissions",
        a.permissions.join("; "),
        a.hostPermissions.join("; ")
      ].map(csvCell).join(","));
    });
    download("umbra-audit-" + stamp() + ".csv", "﻿" + lines.join("\r\n"), "text/csv");
    toast("CSV exported — one row per extension", "ok");
    closeExportMenu();
  }

  function exportJson() {
    download("umbra-audit-" + stamp() + ".json", JSON.stringify({
      generated: state.scanTime.toISOString(),
      summary: state.summary,
      extensions: state.results
    }, null, 2), "application/json");
    toast("JSON exported", "ok");
    closeExportMenu();
  }

  function toggleExportMenu() {
    var m = $("exportMenu");
    if (m) m.hidden = !m.hidden;
  }
  function closeExportMenu() {
    var m = $("exportMenu");
    if (m) m.hidden = true;
  }
  function onExportMenuClick(e) {
    var btn = e.target.closest("[data-export]");
    if (!btn) return;
    var kind = btn.getAttribute("data-export");
    if (kind === "pdf") return exportPdf();
    if (kind === "csv") return exportCsv();
    if (kind === "json") return exportJson();
  }

  /* ---------- theme randomizer ---------- */
  var THEME_VARS = ["--bg", "--panel", "--panel-2", "--border", "--brand", "--brand-dim"];
  function hsl(h, s, l) { return "hsl(" + h + " " + s + "% " + l + "%)"; }
  function randomTheme() {
    var base = Math.floor(Math.random() * 360);
    var accent = (base + 90 + Math.floor(Math.random() * 180)) % 360;
    return {
      base: base, accent: accent,
      vars: {
        "--bg": hsl(base, 24, 6),
        "--panel": hsl(base, 20, 10),
        "--panel-2": hsl(base, 18, 14),
        "--border": hsl(base, 15, 23),
        "--brand": hsl(accent, 83, 68),
        "--brand-dim": hsl(accent, 55, 23)
      }
    };
  }
  function applyTheme(theme) {
    var root = document.documentElement;
    if (!theme || !theme.vars) {
      THEME_VARS.forEach(function (k) { root.style.removeProperty(k); });
      return;
    }
    THEME_VARS.forEach(function (k) {
      if (theme.vars[k]) root.style.setProperty(k, theme.vars[k]);
    });
  }
  function shuffleTheme() {
    var theme = randomTheme();
    applyTheme(theme);
    chrome.storage.local.set({ theme: theme });
    toast("Theme shuffled — hue " + theme.base + "°, accent " + theme.accent + "°");
  }
  function resetTheme() {
    applyTheme(null);
    chrome.storage.local.remove("theme");
    toast("Theme reset to default");
  }
  function loadTheme() {
    return chrome.storage.local.get("theme").then(function (d) {
      if (d && d.theme) applyTheme(d.theme);
    });
  }

  /* ---------- event wiring (delegation only) ---------- */
  function onChipsClick(e) {
    var chip = e.target.closest("[data-filter]");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    renderChips(); renderTable(); wireImages();
  }
  function onRowsClick(e) {
    var tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    openDrawer(tr.getAttribute("data-id"));
  }
  function onDrawerClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    var id = btn.getAttribute("data-id");
    if (act === "close") return closeDrawer();
    if (act === "disable") return doDisable(id);
    if (act === "enable") return doEnable(id);
    if (act === "uninstall") return doUninstall(id);
    if (act === "allow") return doAllow(id, true);
    if (act === "unallow") return doAllow(id, false);
  }
  function onHeroClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    if (act === "disable-critical") return disableAllCritical();
    if (act === "export") return exportPdf();
  }

  function init() {
    $("chips").addEventListener("click", onChipsClick);
    $("rows").addEventListener("click", onRowsClick);
    $("drawer").addEventListener("click", onDrawerClick);
    $("heroActs").addEventListener("click", onHeroClick);
    $("scrim").addEventListener("click", closeDrawer);
    $("search").addEventListener("input", function (e) {
      state.query = e.target.value;
      renderTable(); wireImages();
    });
    $("rescanBtn").addEventListener("click", function () {
      $("scanTime").textContent = "Re-scanning…";
      refresh().then(function () { toast("Re-scanned " + state.summary.total + " extensions", "ok"); });
    });
    $("exportBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      toggleExportMenu();
    });
    $("exportMenu").addEventListener("click", onExportMenuClick);
    $("shuffleBtn").addEventListener("click", shuffleTheme);
    $("resetThemeBtn").addEventListener("click", resetTheme);
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".export-wrap")) closeExportMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeDrawer(); closeExportMenu(); }
    });
    loadTheme();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
