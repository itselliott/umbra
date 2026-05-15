"use strict";
/* ============================================================
   Umbra — server-side fleet report

   buildClientReport(data) -> a polished, print-optimized standalone
   HTML document for one client's fleet, MSP-branded. Mirrors the
   single-user extension's report so the visual language is shared.
   Served (not downloaded) by GET /v1/clients/:id/report, so inline
   script/handlers are fine here.

   data = {
     mspName, clientOrg:{name}, generatedAt,
     devices:Number,
     tierCounts:{critical,high,medium,low},
     extensions:[{ext_id,name,tier,score,devices}],
     deviceList:[{hostname,extensions,risky,last_seen}]
   }
   ============================================================ */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function gradeOf(tc) {
  if (tc.critical > 0) return "F";
  if (tc.high >= 2) return "D";
  if (tc.high === 1) return "C";
  if (tc.medium >= 3) return "B";
  return "A";
}

function ago(ts) {
  if (!ts) return "never";
  var s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function buildClientReport(data) {
  data = data || {};
  var mspName = data.mspName || "Your MSP";
  var client = (data.clientOrg && data.clientOrg.name) || "Client";
  var when = data.generatedAt || new Date().toLocaleString();
  var deviceCount = data.devices || 0;
  var tc = data.tierCounts || { critical: 0, high: 0, medium: 0, low: 0 };
  var exts = data.extensions || [];
  var devs = data.deviceList || [];
  var g = gradeOf(tc);

  var GBG = { A: "#dcfce7", B: "#dcfce7", C: "#fef9c3", D: "#ffedd5", F: "#fee2e2" };
  var GFG = { A: "#15803d", B: "#15803d", C: "#b45309", D: "#c2410c", F: "#dc2626" };

  var sentence = tc.critical > 0
    ? tc.critical + " critical extension" + (tc.critical === 1 ? "" : "s") + " across this fleet need immediate removal."
    : tc.high > 0
      ? tc.high + " high-risk extension" + (tc.high === 1 ? "" : "s") + " should be reviewed."
      : tc.medium > 0 ? "A few extensions are worth a periodic review."
        : "No high-risk extensions found across this fleet.";

  var flagged = exts.filter(function (e) { return e.tier === "critical" || e.tier === "high"; });
  var details = flagged.map(function (e) {
    return '<div class="detail t-' + esc(e.tier) + '">' +
      '<div class="dh"><span class="dnum">' + e.score + '</span>' +
      '<div><div class="dname">' + esc(e.name || e.ext_id) + '</div>' +
      '<div class="id">' + esc(e.ext_id) + '</div></div>' +
      '<span class="dtag">' + esc(e.tier).toUpperCase() + '</span></div>' +
      '<p class="dm">On ' + e.devices + ' device' + (e.devices === 1 ? "" : "s") +
      ' in this fleet.</p></div>';
  }).join("");

  var extRows = exts.length
    ? exts.map(function (e) {
        return '<tr class="t-' + esc(e.tier) + '">' +
          '<td class="name">' + esc(e.name || e.ext_id) +
            '<div class="id">' + esc(e.ext_id) + '</div></td>' +
          '<td class="ctr num">' + e.score + '</td>' +
          '<td class="risk">' + esc(e.tier).toUpperCase() + '</td>' +
          '<td class="ctr">' + e.devices + '</td></tr>';
      }).join("")
    : '<tr><td colspan="4" class="empty">No extensions reported.</td></tr>';

  var devRows = devs.length
    ? devs.map(function (d) {
        return '<tr><td class="name">' + esc(d.hostname) + '</td>' +
          '<td class="ctr">' + d.extensions + '</td>' +
          '<td class="ctr">' + (d.risky || 0) + '</td>' +
          '<td>' + esc(ago(d.last_seen)) + '</td></tr>';
      }).join("")
    : '<tr><td colspan="4" class="empty">No devices reporting.</td></tr>';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    '<title>Umbra Fleet Report — ' + esc(client) + '</title><style>' +
    '*{box-sizing:border-box}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'color:#1a1d26;line-height:1.55;margin:0;background:#f4f5f7}' +
    '.bar{position:sticky;top:0;background:#13161f;color:#fff;display:flex;align-items:center;' +
      'gap:14px;padding:12px 22px}' +
    '.bar .t{font-weight:700;font-size:14px;flex:1}.bar .h{color:#9aa0b3;font-size:12px}' +
    '.bar button{background:#7c5cff;color:#fff;border:0;font-weight:700;font-size:13px;' +
      'padding:9px 16px;border-radius:8px;cursor:pointer;font-family:inherit}' +
    '.sheet{max-width:840px;margin:0 auto;background:#fff;padding:44px 54px 60px}' +
    '.brand{font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;font-weight:600}' +
    'h1{font-size:23px;margin:4px 0 0;letter-spacing:-.3px}' +
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
    '.ctr{text-align:center}td.name{font-weight:600;min-width:170px}' +
    '.id{color:#9ca3af;font-size:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:400}' +
    'td.risk{font-weight:700;font-size:10.5px}.empty{text-align:center;color:#9ca3af;padding:18px}' +
    'tr.t-critical td.risk,tr.t-critical td.num{color:#dc2626}' +
    'tr.t-high td.risk,tr.t-high td.num{color:#ea580c}' +
    'tr.t-medium td.risk,tr.t-medium td.num{color:#b45309}' +
    'tr.t-low td.risk,tr.t-low td.num{color:#15803d}' +
    '.detail{border:1px solid #e5e7eb;border-left-width:4px;border-radius:8px;padding:12px 15px;margin:9px 0}' +
    '.detail.t-critical{border-left-color:#dc2626}.detail.t-high{border-left-color:#ea580c}' +
    '.dh{display:flex;align-items:center;gap:11px}.dnum{font-size:22px;font-weight:800}' +
    '.detail.t-critical .dnum{color:#dc2626}.detail.t-high .dnum{color:#ea580c}' +
    '.dname{font-weight:700;font-size:14px}.dtag{margin-left:auto;font-size:10px;font-weight:700;' +
      'letter-spacing:.5px;color:#6b7280}.dm{margin:7px 0 0;font-size:12.5px;color:#4b5563}' +
    'footer{margin-top:34px;padding-top:13px;border-top:1px solid #e5e7eb;color:#9ca3af;' +
      'font-size:11px;line-height:1.6}' +
    '@media print{body{background:#fff}.bar{display:none}.sheet{max-width:none;padding:0}' +
      'tr,.detail{break-inside:avoid}h2{break-after:avoid}@page{margin:16mm}}' +
    '</style></head><body>' +
    '<div class="bar"><span class="t">&#9685; Umbra — Fleet Risk Report</span>' +
      '<span class="h">Pick &ldquo;Save as PDF&rdquo; as the destination</span>' +
      '<button onclick="window.print()">Save as PDF</button></div>' +
    '<div class="sheet">' +
    '<div class="brand">Prepared by ' + esc(mspName) + '</div>' +
    '<h1>' + esc(client) + ' — Browser-Extension Risk</h1>' +
    '<p class="sub">Generated ' + esc(when) + ' &middot; ' + deviceCount + ' device' +
      (deviceCount === 1 ? "" : "s") + ' &middot; ' + exts.length + ' distinct extension' +
      (exts.length === 1 ? "" : "s") + '</p>' +
    '<div class="grow"><div class="grade" style="background:' + GBG[g] + ';color:' + GFG[g] + '">' +
      g + '</div><div><div class="gl">Fleet risk grade</div>' +
      '<div class="gv">' + esc(sentence) + '</div></div></div>' +
    '<div class="sum">' +
      '<div><b>' + tc.critical + '</b>Critical</div>' +
      '<div><b>' + tc.high + '</b>High</div>' +
      '<div><b>' + tc.medium + '</b>Medium</div>' +
      '<div><b>' + tc.low + '</b>Low</div>' +
      '<div><b>' + deviceCount + '</b>Devices</div></div>' +
    (details ? '<h2>Flagged extensions &mdash; action needed</h2>' + details : '') +
    '<h2>Full inventory</h2>' +
    '<table><thead><tr><th>Extension</th><th class="ctr">Score</th><th>Risk</th>' +
      '<th class="ctr">Devices</th></tr></thead><tbody>' + extRows + '</tbody></table>' +
    '<h2>Devices</h2>' +
    '<table><thead><tr><th>Device</th><th class="ctr">Extensions</th>' +
      '<th class="ctr">Risky</th><th>Last report</th></tr></thead><tbody>' + devRows + '</tbody></table>' +
    '<footer>Generated by Umbra. Extensions are scored server-side by the @umbra/core engine ' +
    'from the chrome.management inventory each device reports. Reputation signals ' +
    '(known-bad lists, ownership-change and Web Store-removal detection) are seeded in this ' +
    'build and fully populated by the cloud threat-intelligence service in the production version.' +
    '</footer></div></body></html>';
}

module.exports = { buildClientReport: buildClientReport };
