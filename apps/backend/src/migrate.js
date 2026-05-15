"use strict";
/* Applies every .sql file in ../migrations in filename order.
   Migrations are written idempotently (CREATE TABLE IF NOT EXISTS …),
   so re-running is safe. Run with:  npm run migrate */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function run() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter(function (f) { return f.endsWith(".sql"); })
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    process.stdout.write("applying " + file + " ... ");
    await pool.query(sql);
    console.log("ok");
  }
  await pool.end();
  console.log("migrations complete (" + files.length + " file(s))");
}

run().catch(function (err) {
  console.error("migration failed:", err.message);
  process.exit(1);
});
