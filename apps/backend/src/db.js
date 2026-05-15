"use strict";
/* Postgres connection pool + a small transaction helper.
   Connection string comes from DATABASE_URL (see .env.example);
   the default matches the local docker-compose Postgres. */
const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL || "postgres://umbra:umbra@localhost:5432/umbra";
/* Local docker Postgres needs no SSL; hosted Postgres (Neon, Supabase, RDS)
   does — turned on automatically when the URL asks for it, or via PGSSL=true. */
const useSSL =
  process.env.PGSSL === "true" || /sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString: connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

function query(text, params) {
  return pool.query(text, params);
}

/* Run `fn(client)` inside a BEGIN/COMMIT, rolling back on any throw. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
