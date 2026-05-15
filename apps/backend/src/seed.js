"use strict";
/* Creates one demo MSP + one client org + one console user, and prints
   the client's enrollment token so you can immediately test ingest.
   Run with:  npm run seed */
require("dotenv").config();
const { pool, query } = require("./db");

async function run() {
  const msp = await query(
    "INSERT INTO msp (name) VALUES ($1) RETURNING id",
    ["Demo MSP"]
  );
  const mspId = msp.rows[0].id;

  const org = await query(
    `INSERT INTO client_org (msp_id, name)
     VALUES ($1, $2)
     RETURNING id, enrollment_token`,
    [mspId, "Northwind Legal LLP"]
  );

  await query(
    "INSERT INTO app_user (msp_id, email, role) VALUES ($1, $2, $3)",
    [mspId, "admin@demo-msp.test", "msp_admin"]
  );

  const token = org.rows[0].enrollment_token;
  console.log("Seeded:");
  console.log("  MSP id            " + mspId);
  console.log("  Client org id     " + org.rows[0].id);
  console.log("  Enrollment token  " + token);
  console.log("");
  console.log("Sign in to the console at http://localhost:3000 with:  admin@demo-msp.test");
  console.log("");
  console.log("Or test the ingest endpoint directly:");
  console.log(
    "  curl -X POST localhost:3000/v1/inventory \\\n" +
    "    -H 'content-type: application/json' \\\n" +
    "    -d '{\"enrollmentToken\":\"" + token + "\"," +
    "\"device\":{\"hostname\":\"test-pc\"}," +
    "\"extensions\":[{\"id\":\"x\",\"name\":\"Free VPN Unlimited Proxy\",\"type\":\"extension\"," +
    "\"version\":\"1.0\",\"installType\":\"normal\",\"enabled\":true," +
    "\"permissions\":[\"proxy\",\"cookies\"],\"hostPermissions\":[\"<all_urls>\"]}]}'");
  console.log("");
  console.log("Then view the fleet:");
  console.log("  curl localhost:3000/v1/clients/" + org.rows[0].id + "/overview");

  await pool.end();
}

run().catch(function (err) {
  console.error("seed failed:", err.message);
  process.exit(1);
});
