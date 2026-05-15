"use strict";
/* ============================================================
   Umbra fleet/admin backend — Phase 2 (auth + onboarding)

   Auth (console):
     POST /auth/dev-login                email-only dev login
     POST /auth/logout
     GET  /auth/me
     GET  /auth/workos/callback          SSO seam (501 until configured)

   Console API — all behind requireAuth, scoped to the caller's MSP:
     GET  /v1/portfolio                  this MSP's client orgs
     POST /v1/clients                    onboard a new client org
     GET  /v1/clients/:id/overview       one client's fleet (+ enrollment token)
     GET  /v1/clients/:id/extensions
     GET  /v1/clients/:id/devices

   Collector API — NOT session-authed; the collector authenticates with
   its client org's enrollment token:
     POST /v1/inventory

     GET  /health
   ============================================================ */
require("dotenv").config();
const express = require("express");
const path = require("path");
const { query, withTransaction } = require("./db");
const { scoreInventory } = require("./scoring");
const auth = require("./auth");
const report = require("./report");
const workos = require("./workos");

const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || "http://localhost:3000";
const COLLECTOR_EXTENSION_ID =
  process.env.COLLECTOR_EXTENSION_ID || "REPLACE_WITH_PUBLISHED_COLLECTOR_EXTENSION_ID";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public"))); // serves the web console

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: auth.TTL_DAYS * 86400000
};

/* Returns the caller-owned client_org row, or null (used for tenant isolation). */
async function clientOwnedBy(clientOrgId, mspId) {
  const r = await query(
    "SELECT id, name, enrollment_token FROM client_org WHERE id = $1 AND msp_id = $2",
    [clientOrgId, mspId]
  );
  return r.rows[0] || null;
}

/* ---------- health ---------- */
app.get("/health", function (req, res) {
  res.json({ ok: true, service: "umbra-backend", version: "0.2.0" });
});

/* ============================================================
   Auth
   ============================================================ */
app.post("/auth/dev-login", async function (req, res) {
  try {
    const body = req.body || {};
    const user = await auth.devLogin(body.email, body.mspName);
    const sess = await auth.createSession(user.id);
    res.cookie(auth.COOKIE, sess.token, COOKIE_OPTS);
    res.json({ user: { email: user.email, role: user.role, mspId: user.msp_id } });
  } catch (err) {
    res.status(400).json({ error: err.message || "login failed" });
  }
});

app.post("/auth/logout", async function (req, res) {
  try {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
    await auth.destroySession(token);
    res.clearCookie(auth.COOKIE);
    res.json({ ok: true });
  } catch (err) {
    console.error("logout error:", err);
    res.status(500).json({ error: "logout failed" });
  }
});

app.get("/auth/me", async function (req, res) {
  try {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
    const user = await auth.resolveSession(token);
    if (!user) return res.status(401).json({ error: "not authenticated" });
    res.json({ user: { email: user.email, role: user.role, mspId: user.msp_id } });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ error: "auth check failed" });
  }
});

/* Tells the console which login UI to render. No auth required — the
   browser needs this *before* signing in. */
app.get("/auth/config", function (req, res) {
  res.json({ authMode: workos.enabled ? "workos" : "dev" });
});

/* WorkOS AuthKit — production SSO, active when AUTH_MODE=workos.
   /start sends the browser to AuthKit's hosted login. */
app.get("/auth/workos/start", function (req, res) {
  if (!workos.enabled) {
    return res.status(501).send("WorkOS SSO is not configured (set AUTH_MODE=workos)");
  }
  res.redirect(workos.authorizationUrl());
});

/* WorkOS redirects here after the user authenticates. We exchange the
   one-time code for the user's profile, then hand the email to Umbra's
   own session layer — WorkOS answers "who is this", auth.js handles
   "keep them logged in". */
app.get("/auth/workos/callback", async function (req, res) {
  try {
    if (!workos.enabled) {
      return res.status(501).send("WorkOS SSO is not configured (set AUTH_MODE=workos)");
    }
    const code = req.query.code;
    if (!code) return res.status(400).send("missing authorization code");

    const profile = await workos.profileFromCode(code);
    const user = await auth.ssoLogin(profile.email);
    const sess = await auth.createSession(user.id);
    res.cookie(auth.COOKIE, sess.token, COOKIE_OPTS);
    res.redirect("/");
  } catch (err) {
    console.error("workos callback error:", err);
    res.redirect("/?auth_error=1");
  }
});

/* ============================================================
   Collector ingest — authenticated by enrollment token, not a session
   ============================================================ */
app.post("/v1/inventory", async function (req, res) {
  try {
    const body = req.body || {};
    const enrollmentToken = body.enrollmentToken;
    const device = body.device;
    const extensions = body.extensions;

    if (!enrollmentToken || !device || !Array.isArray(extensions)) {
      return res
        .status(400)
        .json({ error: "enrollmentToken, device, and extensions[] are required" });
    }

    const org = await query(
      "SELECT id FROM client_org WHERE enrollment_token = $1",
      [enrollmentToken]
    );
    if (!org.rows.length) {
      return res.status(401).json({ error: "invalid enrollment token" });
    }
    const clientOrgId = org.rows[0].id;

    // score with the shared engine before touching the DB
    const scored = scoreInventory(extensions);

    const deviceId = await withTransaction(async function (client) {
      const dev = await client.query(
        `INSERT INTO device (client_org_id, hostname, last_seen)
         VALUES ($1, $2, now())
         ON CONFLICT (client_org_id, hostname)
         DO UPDATE SET last_seen = now()
         RETURNING id`,
        [clientOrgId, String(device.hostname || "unknown")]
      );
      const id = dev.rows[0].id;

      await client.query(
        "DELETE FROM extension_observation WHERE device_id = $1",
        [id]
      );

      // N+1 inserts — fine at Phase 1 scale; batch in Phase 2.
      for (const s of scored) {
        await client.query(
          `INSERT INTO extension_catalog (ext_id, name, latest_version, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (ext_id)
           DO UPDATE SET name = EXCLUDED.name,
                         latest_version = EXCLUDED.latest_version,
                         updated_at = now()`,
          [s.id, s.name || null, s.version || null]
        );
        await client.query(
          `INSERT INTO extension_observation
             (device_id, ext_id, version, permissions, host_permissions,
              install_type, enabled, score, tier, seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
          [
            id,
            s.id,
            s.version || null,
            JSON.stringify(s.permissions || []),
            JSON.stringify(s.hostPermissions || []),
            s.installType || null,
            s.enabled === undefined ? null : !!s.enabled,
            s.score,
            s.tier
          ]
        );
      }
      return id;
    });

    res.json({ ok: true, deviceId: deviceId, scored: scored.length });
  } catch (err) {
    console.error("ingest error:", err);
    res.status(500).json({ error: "ingest failed" });
  }
});

/* ============================================================
   Console API — all requireAuth, all scoped to req.user.msp_id
   ============================================================ */

/* this MSP's whole portfolio */
app.get("/v1/portfolio", auth.requireAuth, async function (req, res) {
  try {
    const rows = await query(
      `SELECT co.id, co.name,
              count(DISTINCT d.id)::int AS devices,
              (count(DISTINCT o.ext_id) FILTER (WHERE o.tier = 'critical'))::int
                AS critical_extensions
       FROM client_org co
       LEFT JOIN device d ON d.client_org_id = co.id
       LEFT JOIN extension_observation o ON o.device_id = d.id
       WHERE co.msp_id = $1
       GROUP BY co.id, co.name
       ORDER BY critical_extensions DESC, co.name`,
      [req.user.msp_id]
    );
    res.json({ clients: rows.rows });
  } catch (err) {
    console.error("portfolio error:", err);
    res.status(500).json({ error: "portfolio failed" });
  }
});

/* onboard a new client org under the caller's MSP */
app.post("/v1/clients", auth.requireAuth, async function (req, res) {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ error: "a client name is required" });
    const row = await query(
      `INSERT INTO client_org (msp_id, name)
       VALUES ($1, $2)
       RETURNING id, name, enrollment_token`,
      [req.user.msp_id, name]
    );
    res.json({
      client: {
        id: row.rows[0].id,
        name: row.rows[0].name,
        enrollmentToken: row.rows[0].enrollment_token
      }
    });
  } catch (err) {
    console.error("create client error:", err);
    res.status(500).json({ error: "could not create client" });
  }
});

/* one client's fleet overview (+ its enrollment token, for deployment) */
app.get("/v1/clients/:clientOrgId/overview", auth.requireAuth, async function (req, res) {
  try {
    const co = await clientOwnedBy(req.params.clientOrgId, req.user.msp_id);
    if (!co) return res.status(404).json({ error: "client org not found" });
    const clientOrgId = co.id;

    const devices = await query(
      "SELECT count(*)::int AS n FROM device WHERE client_org_id = $1",
      [clientOrgId]
    );
    const byTier = await query(
      `SELECT o.tier, count(DISTINCT o.ext_id)::int AS extensions
       FROM extension_observation o
       JOIN device d ON d.id = o.device_id
       WHERE d.client_org_id = $1
       GROUP BY o.tier`,
      [clientOrgId]
    );
    const risky = await query(
      `SELECT o.ext_id, c.name, o.tier,
              max(o.score)::int AS score,
              count(DISTINCT o.device_id)::int AS devices
       FROM extension_observation o
       JOIN device d ON d.id = o.device_id
       JOIN extension_catalog c ON c.ext_id = o.ext_id
       WHERE d.client_org_id = $1 AND o.tier IN ('critical', 'high')
       GROUP BY o.ext_id, c.name, o.tier
       ORDER BY score DESC`,
      [clientOrgId]
    );

    res.json({
      clientOrg: { id: co.id, name: co.name, enrollmentToken: co.enrollment_token },
      devices: devices.rows[0].n,
      byTier: byTier.rows,
      riskyExtensions: risky.rows
    });
  } catch (err) {
    console.error("overview error:", err);
    res.status(500).json({ error: "overview failed" });
  }
});

/* every extension across a client's fleet */
app.get("/v1/clients/:clientOrgId/extensions", auth.requireAuth, async function (req, res) {
  try {
    const co = await clientOwnedBy(req.params.clientOrgId, req.user.msp_id);
    if (!co) return res.status(404).json({ error: "client org not found" });
    const rows = await query(
      `SELECT o.ext_id, c.name, o.tier,
              max(o.score)::int AS score,
              count(DISTINCT o.device_id)::int AS devices
       FROM extension_observation o
       JOIN device d ON d.id = o.device_id
       JOIN extension_catalog c ON c.ext_id = o.ext_id
       WHERE d.client_org_id = $1
       GROUP BY o.ext_id, c.name, o.tier
       ORDER BY score DESC, c.name`,
      [co.id]
    );
    res.json({ clientOrgId: co.id, extensions: rows.rows });
  } catch (err) {
    console.error("extensions error:", err);
    res.status(500).json({ error: "extensions query failed" });
  }
});

/* devices in a client's fleet */
app.get("/v1/clients/:clientOrgId/devices", auth.requireAuth, async function (req, res) {
  try {
    const co = await clientOwnedBy(req.params.clientOrgId, req.user.msp_id);
    if (!co) return res.status(404).json({ error: "client org not found" });
    const rows = await query(
      `SELECT d.id, d.hostname, d.last_seen,
              count(o.id)::int AS extensions,
              (count(o.id) FILTER (WHERE o.tier IN ('critical', 'high')))::int AS risky
       FROM device d
       LEFT JOIN extension_observation o ON o.device_id = d.id
       WHERE d.client_org_id = $1
       GROUP BY d.id, d.hostname, d.last_seen
       ORDER BY risky DESC, d.last_seen DESC`,
      [co.id]
    );
    res.json({ clientOrgId: co.id, devices: rows.rows });
  } catch (err) {
    console.error("devices error:", err);
    res.status(500).json({ error: "devices query failed" });
  }
});

/* deployment artifacts — what the MSP pastes into Google Workspace / an MDM
   to force-install the collector and enroll this client's browsers */
app.get("/v1/clients/:clientOrgId/deployment", auth.requireAuth, async function (req, res) {
  try {
    const co = await clientOwnedBy(req.params.clientOrgId, req.user.msp_id);
    if (!co) return res.status(404).json({ error: "client org not found" });
    const managedConfig = { enrollmentToken: co.enrollment_token, apiBase: PUBLIC_API_BASE };
    res.json({
      clientOrg: { id: co.id, name: co.name },
      extensionId: COLLECTOR_EXTENSION_ID,
      apiBase: PUBLIC_API_BASE,
      managedConfig: managedConfig,
      managedConfigJson: JSON.stringify(managedConfig, null, 2)
    });
  } catch (err) {
    console.error("deployment error:", err);
    res.status(500).json({ error: "deployment lookup failed" });
  }
});

/* print-ready, MSP-branded fleet report for a client (rendered HTML) */
app.get("/v1/clients/:clientOrgId/report", auth.requireAuth, async function (req, res) {
  try {
    const co = await clientOwnedBy(req.params.clientOrgId, req.user.msp_id);
    if (!co) return res.status(404).send("client org not found");

    const mspRow = await query("SELECT name FROM msp WHERE id = $1", [req.user.msp_id]);
    const devices = await query(
      "SELECT count(*)::int AS n FROM device WHERE client_org_id = $1", [co.id]
    );
    const byTier = await query(
      `SELECT o.tier, count(DISTINCT o.ext_id)::int AS extensions
       FROM extension_observation o JOIN device d ON d.id = o.device_id
       WHERE d.client_org_id = $1 GROUP BY o.tier`, [co.id]
    );
    const exts = await query(
      `SELECT o.ext_id, c.name, o.tier, max(o.score)::int AS score,
              count(DISTINCT o.device_id)::int AS devices
       FROM extension_observation o JOIN device d ON d.id = o.device_id
       JOIN extension_catalog c ON c.ext_id = o.ext_id
       WHERE d.client_org_id = $1 GROUP BY o.ext_id, c.name, o.tier
       ORDER BY score DESC, c.name`, [co.id]
    );
    const devList = await query(
      `SELECT d.hostname, d.last_seen, count(o.id)::int AS extensions,
              (count(o.id) FILTER (WHERE o.tier IN ('critical', 'high')))::int AS risky
       FROM device d LEFT JOIN extension_observation o ON o.device_id = d.id
       WHERE d.client_org_id = $1 GROUP BY d.hostname, d.last_seen
       ORDER BY risky DESC, d.last_seen DESC`, [co.id]
    );

    const tierCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    byTier.rows.forEach(function (r) { tierCounts[r.tier] = r.extensions; });

    const html = report.buildClientReport({
      mspName: (mspRow.rows[0] && mspRow.rows[0].name) || "Your MSP",
      clientOrg: { name: co.name },
      generatedAt: new Date().toLocaleString(),
      devices: devices.rows[0].n,
      tierCounts: tierCounts,
      extensions: exts.rows,
      deviceList: devList.rows
    });
    res.type("html").send(html);
  } catch (err) {
    console.error("report error:", err);
    res.status(500).send("report generation failed");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Umbra backend listening on :" + PORT);
});

module.exports = app;
