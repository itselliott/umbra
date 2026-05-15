/* ============================================================
   Umbra Console — Phase 2 (auth + onboarding)
   Vanilla JS, no build step.
     - checks /auth/me on load; shows a login screen if needed
     - portfolio is scoped to the signed-in user's MSP (no id pasting)
     - add a client org, get its enrollment token (with copy)
     - ?client=<id> drills into one client's fleet
   ============================================================ */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var scopeEl = document.getElementById("scope");
  var authArea = document.getElementById("authArea");
  var currentUser = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function qs() { return new URLSearchParams(location.search); }
  function ago(ts) {
    if (!ts) return "never";
    var s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  async function getJSON(url) {
    var res = await fetch(url);
    if (!res.ok) {
      var e = new Error("HTTP " + res.status + " from " + url);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }
  async function postJSON(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var e = new Error(data.error || ("HTTP " + res.status));
      e.status = res.status;
      throw e;
    }
    return data;
  }
  function render(html) { app.innerHTML = html; }

  function tokenBox(token) {
    return '<div class="token-box"><code>' + esc(token) + '</code>' +
      '<button class="btn-sm" data-copy="' + esc(token) + '">Copy</button></div>';
  }
  function wireCopy() {
    app.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var val = b.getAttribute("data-copy");
        navigator.clipboard.writeText(val).then(function () {
          var prev = b.textContent;
          b.textContent = "Copied";
          setTimeout(function () { b.textContent = prev; }, 1200);
        });
      });
    });
  }

  function errorView(msg) {
    render(
      '<div class="card err"><h2>Couldn\'t load that</h2><p>' + esc(msg) + '</p>' +
      '<p><a href="?">&larr; back to portfolio</a></p></div>'
    );
  }

  /* ---------- auth ---------- */
  function renderAuthArea() {
    if (!currentUser) { authArea.innerHTML = ""; return; }
    authArea.innerHTML =
      '<span class="user-chip">' + esc(currentUser.email) + '</span>' +
      '<button class="btn-sm" id="logoutBtn">Sign out</button>';
    document.getElementById("logoutBtn").addEventListener("click", async function () {
      await fetch("/auth/logout", { method: "POST" });
      location.href = "/";
    });
  }

  async function loginView() {
    scopeEl.textContent = "";
    authArea.innerHTML = "";

    var mode = "dev";
    try {
      mode = (await getJSON("/auth/config")).authMode || "dev";
    } catch (e) { /* backend unreachable — fall back to the dev form */ }

    if (mode === "workos") {
      var errNote = qs().get("auth_error")
        ? '<div class="formMsg">Sign-in failed or was cancelled — try again.</div>'
        : "";
      render(
        '<div class="login">' +
          '<h1>Sign in to Umbra Console</h1>' +
          '<p class="sub">Single sign-on via WorkOS — your organization’s identity ' +
          'provider, email and password, or a social login.</p>' +
          '<div class="login-card">' +
            '<button id="ssoBtn" style="flex:1">Sign in with SSO</button>' +
          '</div>' + errNote +
        '</div>'
      );
      document.getElementById("ssoBtn").addEventListener("click", function () {
        location.href = "/auth/workos/start";
      });
      return;
    }

    render(
      '<div class="login">' +
        '<h1>Sign in to Umbra Console</h1>' +
        '<p class="sub">Dev mode — email only, no password. ' +
        'Try <code>admin@demo-msp.test</code> after <code>npm run seed</code>, ' +
        'or any email to spin up a fresh MSP.</p>' +
        '<div class="login-card">' +
          '<input id="emailIn" type="email" placeholder="you@your-msp.com" autocomplete="email">' +
          '<button id="loginBtn">Sign in</button>' +
        '</div>' +
        '<div class="formMsg" id="loginMsg"></div>' +
      '</div>'
    );
    var go = async function () {
      var email = document.getElementById("emailIn").value.trim();
      var msg = document.getElementById("loginMsg");
      if (!email) { msg.textContent = "Enter an email address."; return; }
      msg.textContent = "Signing in…";
      try {
        await postJSON("/auth/dev-login", { email: email });
        location.href = "/";
      } catch (e) {
        msg.textContent = e.message;
      }
    };
    document.getElementById("loginBtn").addEventListener("click", go);
    document.getElementById("emailIn").addEventListener("keydown", function (e) {
      if (e.key === "Enter") go();
    });
  }

  /* ---------- portfolio ---------- */
  async function portfolioView() {
    scopeEl.textContent = "Portfolio";
    render('<div class="loading">Loading portfolio…</div>');
    var data = await getJSON("/v1/portfolio");
    var clients = data.clients || [];

    var rows = clients.length
      ? clients.map(function (c) {
          var crit = c.critical_extensions
            ? '<span class="pill s-critical">' + c.critical_extensions + '</span>'
            : '<span class="muted">0</span>';
          return '<tr data-client="' + esc(c.id) + '">' +
            '<td class="name">' + esc(c.name) + '<div class="id">' + esc(c.id) + '</div></td>' +
            '<td class="num">' + c.devices + '</td>' +
            '<td class="num">' + crit + '</td>' +
            '<td class="chev">&rsaquo;</td></tr>';
        }).join("")
      : '<tr><td colspan="4" class="empty">No client orgs yet — add your first one above.</td></tr>';

    render(
      '<header class="page"><div class="page-top">' +
        '<h1>Client portfolio</h1>' +
        '<button class="btn" id="addClientBtn">+ Add client</button></div>' +
        '<p class="sub">' + clients.length + ' client org' + (clients.length === 1 ? '' : 's') +
        ' &middot; sorted by critical risk</p></header>' +
      '<div id="addClientSlot"></div>' +
      '<div class="tbl"><table><thead><tr>' +
        '<th>Client</th><th>Devices</th><th>Critical extensions</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    );

    app.querySelectorAll("tr[data-client]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        location.search = "?client=" + encodeURIComponent(tr.getAttribute("data-client"));
      });
    });
    document.getElementById("addClientBtn").addEventListener("click", showAddClient);
  }

  function showAddClient() {
    var slot = document.getElementById("addClientSlot");
    slot.innerHTML =
      '<div class="add-card">' +
        '<label>New client organization</label>' +
        '<div class="add-row">' +
          '<input id="newClientName" placeholder="e.g. Northwind Legal LLP" autocomplete="off">' +
          '<button id="createClientBtn">Create</button>' +
        '</div>' +
        '<div class="formMsg" id="addMsg"></div>' +
      '</div>';

    var create = async function () {
      var name = document.getElementById("newClientName").value.trim();
      var msg = document.getElementById("addMsg");
      if (!name) { msg.textContent = "Enter a client name."; return; }
      msg.textContent = "Creating…";
      try {
        var res = await postJSON("/v1/clients", { name: name });
        slot.innerHTML =
          '<div class="add-card ok">' +
            '<label>Created &mdash; ' + esc(res.client.name) + '</label>' +
            '<p class="sub">Deploy the collector to this client with its enrollment token:</p>' +
            tokenBox(res.client.enrollmentToken) +
            '<p class="sub" style="margin-top:10px">' +
              '<a href="?client=' + esc(res.client.id) + '">Open ' + esc(res.client.name) + ' &rsaquo;</a>' +
              ' &nbsp;·&nbsp; <a href="?">refresh portfolio</a></p>' +
          '</div>';
        wireCopy();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
    document.getElementById("createClientBtn").addEventListener("click", create);
    document.getElementById("newClientName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") create();
    });
  }

  /* ---------- client fleet ---------- */
  function statCard(label, val, sub, alarm) {
    return '<div class="card-stat' + (alarm ? ' alarm' : '') + '">' +
      '<div class="lbl">' + esc(label) + '</div>' +
      '<div class="val">' + val + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div>';
  }

  async function clientView(clientId) {
    scopeEl.textContent = "Client fleet";
    render('<div class="loading">Loading fleet…</div>');

    var overview = await getJSON("/v1/clients/" + encodeURIComponent(clientId) + "/overview");
    var extData = await getJSON("/v1/clients/" + encodeURIComponent(clientId) + "/extensions");
    var devData = await getJSON("/v1/clients/" + encodeURIComponent(clientId) + "/devices");

    var t = { critical: 0, high: 0, medium: 0, low: 0 };
    (overview.byTier || []).forEach(function (r) { t[r.tier] = r.extensions; });

    var cards =
      statCard("Devices", overview.devices, "reporting in") +
      statCard("Critical", t.critical, "extensions", t.critical > 0) +
      statCard("High", t.high, "extensions", t.high > 0) +
      statCard("Medium", t.medium, "extensions") +
      statCard("Low", t.low, "extensions");

    var exts = extData.extensions || [];
    var extRows = exts.length
      ? exts.map(function (e) {
          return '<tr>' +
            '<td class="name">' + esc(e.name || e.ext_id) +
              '<div class="id">' + esc(e.ext_id) + '</div></td>' +
            '<td class="num">' + e.devices + '</td>' +
            '<td><span class="pill s-' + esc(e.tier) + '">' + e.score + '</span></td>' +
            '<td class="tier-cell">' + esc(e.tier) + '</td></tr>';
        }).join("")
      : '<tr><td colspan="4" class="empty">No extensions reported yet — deploy the collector to this client.</td></tr>';

    var devs = devData.devices || [];
    var devRows = devs.length
      ? devs.map(function (d) {
          var risky = d.risky
            ? '<span class="pill s-high">' + d.risky + '</span>'
            : '<span class="muted">0</span>';
          return '<tr>' +
            '<td class="name">' + esc(d.hostname) + '</td>' +
            '<td class="num">' + d.extensions + '</td>' +
            '<td class="num">' + risky + '</td>' +
            '<td class="muted">' + ago(d.last_seen) + '</td></tr>';
        }).join("")
      : '<tr><td colspan="4" class="empty">No devices yet.</td></tr>';

    render(
      '<header class="page"><a class="back" href="?">&larr; portfolio</a>' +
        '<div class="page-top"><h1>' + esc(overview.clientOrg.name) + '</h1>' +
        '<button class="btn" id="reportBtn">Export report</button></div>' +
        '<p class="sub">' + overview.devices + ' device' + (overview.devices === 1 ? '' : 's') +
        ' &middot; ' + exts.length + ' distinct extension' + (exts.length === 1 ? '' : 's') +
        '</p></header>' +
      '<div class="deploy-card">' +
        '<div class="dc-label">Collector enrollment token</div>' +
        tokenBox(overview.clientOrg.enrollmentToken) +
        '<p class="sub"><a href="?client=' + esc(clientId) + '&v=deploy">Full deployment guide &rsaquo;</a>' +
        ' — force-install settings and managed config for Google Workspace / MDM.</p>' +
      '</div>' +
      '<div class="cards">' + cards + '</div>' +
      '<h2 class="sec">Extensions across the fleet</h2>' +
      '<div class="tbl"><table><thead><tr>' +
        '<th>Extension</th><th>Devices</th><th>Score</th><th>Risk</th>' +
      '</tr></thead><tbody>' + extRows + '</tbody></table></div>' +
      '<h2 class="sec">Devices</h2>' +
      '<div class="tbl"><table><thead><tr>' +
        '<th>Device</th><th>Extensions</th><th>Risky</th><th>Last report</th>' +
      '</tr></thead><tbody>' + devRows + '</tbody></table></div>'
    );
    wireCopy();
    document.getElementById("reportBtn").addEventListener("click", function () {
      window.open("/v1/clients/" + encodeURIComponent(clientId) + "/report", "_blank");
    });
  }

  /* ---------- deployment guide ---------- */
  function step(n, title, bodyHtml) {
    return '<div class="step"><div class="step-n">' + n + '</div>' +
      '<div class="step-body"><h3>' + esc(title) + '</h3><div>' + bodyHtml + '</div></div></div>';
  }
  function codeBlock(text) {
    return '<div class="code-block"><pre>' + esc(text) + '</pre>' +
      '<button class="btn-sm" data-copy="' + esc(text) + '">Copy</button></div>';
  }

  async function deployView(clientId) {
    scopeEl.textContent = "Deployment";
    render('<div class="loading">Loading deployment artifacts…</div>');
    var d = await getJSON("/v1/clients/" + encodeURIComponent(clientId) + "/deployment");
    var placeholder = d.extensionId.indexOf("REPLACE_") === 0;

    render(
      '<header class="page"><a class="back" href="?client=' + esc(clientId) + '">&larr; ' +
        esc(d.clientOrg.name) + '</a>' +
        '<h1>Deploy the Umbra Collector</h1>' +
        '<p class="sub">Force-install and configure the collector across ' + esc(d.clientOrg.name) +
        '’s managed browsers — Google Workspace Admin Console, or any Chrome-policy MDM.</p></header>' +
      '<div class="deploy-steps">' +
        step(1, "Force-install the collector extension",
          "In Admin Console &rarr; Chrome &rarr; Apps &amp; Extensions, add this extension to the " +
          "client’s org unit and set the installation policy to <b>Force install</b>." +
          codeBlock(d.extensionId) +
          (placeholder
            ? '<p class="warn-note">Placeholder ID — replace it with the collector’s real ' +
              'Chrome Web Store ID once published (set <code>COLLECTOR_EXTENSION_ID</code> on the backend).</p>'
            : "")) +
        step(2, "Set the managed configuration",
          "On that same extension, paste this into <b>Policy for extensions</b>. It enrolls every " +
          "browser at this client to the right tenant — with no per-device login." +
          codeBlock(d.managedConfigJson)) +
        step(3, "Confirm",
          "Within a few minutes the client’s browsers appear under <b>" + esc(d.clientOrg.name) +
          "</b> in your portfolio, and the collector’s popup on any device reads " +
          "&ldquo;Managed &amp; reporting.&rdquo;") +
      '</div>'
    );
    wireCopy();
  }

  /* ---------- route ---------- */
  async function route() {
    try {
      var me = await fetch("/auth/me");
      if (me.status === 401) { loginView(); return; }
      if (!me.ok) throw new Error("auth check failed");
      currentUser = (await me.json()).user;
      renderAuthArea();

      var p = qs();
      if (p.get("client")) {
        if (p.get("v") === "deploy") return await deployView(p.get("client"));
        return await clientView(p.get("client"));
      }
      return await portfolioView();
    } catch (e) {
      if (e && e.status === 401) return loginView();
      errorView(e && e.message ? e.message : String(e));
    }
  }

  route();
})();
