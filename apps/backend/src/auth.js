"use strict";
/* ============================================================
   Umbra console — session-based auth

   Two modes, behind one provider-agnostic session layer:
     - Dev mode (default): email-only "dev login", no password —
       for local development and demos. Find-or-create an MSP +
       admin user for the email, then start a session.
     - WorkOS SSO (production): set AUTH_MODE=workos plus the
       WorkOS env vars. The session layer below is unchanged —
       wiring WorkOS only means having its callback resolve an
       SSO profile to an app_user, then calling createSession().

   Sessions live in Postgres (see migration 002); the browser
   holds an opaque httpOnly cookie token.
   ============================================================ */
const crypto = require("crypto");
const { query } = require("./db");

const COOKIE = "umbra_session";
const TTL_DAYS = 30;

/* Minimal Cookie-header parser — avoids a cookie-parser dependency.
   Pure function, easy to unit-test. */
function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(function (pair) {
    const i = pair.indexOf("=");
    if (i < 0) return;
    const k = pair.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

async function createSession(appUserId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TTL_DAYS * 86400000);
  await query(
    "INSERT INTO session (token, app_user_id, expires_at) VALUES ($1, $2, $3)",
    [token, appUserId, expires]
  );
  return { token: token, expires: expires };
}

/* Returns the app_user (with msp_id + role) for a live session, else null. */
async function resolveSession(token) {
  if (!token) return null;
  const r = await query(
    `SELECT u.id, u.email, u.role, u.msp_id
     FROM session s
     JOIN app_user u ON u.id = s.app_user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return r.rows[0] || null;
}

async function destroySession(token) {
  if (token) await query("DELETE FROM session WHERE token = $1", [token]);
}

/* Express middleware — attaches req.user / req.sessionToken, or 401s. */
function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  resolveSession(token)
    .then(function (user) {
      if (!user) return res.status(401).json({ error: "not authenticated" });
      req.user = user;
      req.sessionToken = token;
      next();
    })
    .catch(function (err) {
      console.error("auth error:", err);
      res.status(500).json({ error: "auth failed" });
    });
}

/* Find-or-create an MSP + admin user for an email address. Shared by the
   dev login and the WorkOS SSO callback. */
async function findOrCreateUser(email, mspName) {
  email = String(email || "").trim().toLowerCase();
  if (!email || email.indexOf("@") < 1) {
    throw new Error("a valid email address is required");
  }

  let user = (await query(
    "SELECT id, email, role, msp_id FROM app_user WHERE email = $1",
    [email]
  )).rows[0];

  if (!user) {
    const domain = email.split("@")[1] || "New";
    const msp = (await query(
      "INSERT INTO msp (name) VALUES ($1) RETURNING id",
      [mspName || (domain + " (MSP)")]
    )).rows[0];
    user = (await query(
      `INSERT INTO app_user (msp_id, email, role)
       VALUES ($1, $2, 'msp_admin')
       RETURNING id, email, role, msp_id`,
      [msp.id, email]
    )).rows[0];
  }
  return user;
}

/* Dev login: email-only, no password. Disabled when AUTH_MODE=workos so it
   can't be a production backdoor. */
async function devLogin(email, mspName) {
  if (process.env.AUTH_MODE === "workos") {
    throw new Error("dev login is disabled (AUTH_MODE=workos)");
  }
  return findOrCreateUser(email, mspName);
}

/* SSO login: called from the WorkOS callback once WorkOS has verified the
   user — the email is already trusted at that point. */
async function ssoLogin(email, mspName) {
  return findOrCreateUser(email, mspName);
}

module.exports = {
  COOKIE: COOKIE,
  TTL_DAYS: TTL_DAYS,
  parseCookies: parseCookies,
  createSession: createSession,
  resolveSession: resolveSession,
  destroySession: destroySession,
  requireAuth: requireAuth,
  devLogin: devLogin,
  ssoLogin: ssoLogin
};
