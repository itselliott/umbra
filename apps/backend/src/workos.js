"use strict";
/* ============================================================
   Umbra — WorkOS AuthKit integration

   Active only when AUTH_MODE=workos. WorkOS answers "who is this
   person" (its hosted AuthKit page covers enterprise SSO, email +
   password, and social login); Umbra's own session layer (auth.js)
   handles "keep them logged in". So a successful WorkOS auth just
   resolves an email — which flows into auth.ssoLogin(), the same
   find-or-create path the dev login uses.

   The @workos-inc/node SDK is required lazily, so a dev-mode backend
   works fine without the package installed.
   ============================================================ */

const API_KEY = process.env.WORKOS_API_KEY;
const CLIENT_ID = process.env.WORKOS_CLIENT_ID;
const REDIRECT_URI =
  process.env.WORKOS_REDIRECT_URI || "http://localhost:3000/auth/workos/callback";

const enabled = process.env.AUTH_MODE === "workos";

let workos = null;
if (enabled) {
  if (!API_KEY || !CLIENT_ID) {
    throw new Error(
      "AUTH_MODE=workos requires WORKOS_API_KEY and WORKOS_CLIENT_ID in .env"
    );
  }
  let WorkOS;
  try {
    WorkOS = require("@workos-inc/node").WorkOS;
  } catch (e) {
    throw new Error(
      "AUTH_MODE=workos requires the @workos-inc/node package — run: npm install @workos-inc/node"
    );
  }
  workos = new WorkOS(API_KEY, { clientId: CLIENT_ID });
}

/* Server-side authorization URL for a confidential client. AuthKit handles
   the actual login UI. Returns a string to redirect the browser to. */
function authorizationUrl(state) {
  return workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: state
  });
}

/* Exchange the one-time code WorkOS sends to the callback for the user
   profile. We only need the email; auth.js does the rest. */
async function profileFromCode(code) {
  const result = await workos.userManagement.authenticateWithCode({
    code: code,
    clientId: CLIENT_ID
  });
  return result.user; // { id, email, firstName, lastName, ... }
}

module.exports = {
  enabled: enabled,
  redirectUri: REDIRECT_URI,
  authorizationUrl: authorizationUrl,
  profileFromCode: profileFromCode
};
