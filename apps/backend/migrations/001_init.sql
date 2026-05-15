-- ============================================================
-- Umbra fleet/admin backend — initial multi-tenant schema
--
-- Tenancy model:  msp  ->  client_org  ->  device  ->  extension_observation
-- Every tenant-scoped row carries client_org_id (and an MSP is reachable
-- through it). Multi-tenant from day one — never retrofit.
-- Idempotent: safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- The paying customer: a Managed Service Provider.
create table if not exists msp (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- An MSP's client company (the tenant). Its enrollment_token is what a
-- deployed collector presents to attribute itself to the right tenant.
create table if not exists client_org (
  id                uuid primary key default gen_random_uuid(),
  msp_id            uuid not null references msp(id) on delete cascade,
  name              text not null,
  enrollment_token  text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at        timestamptz not null default now()
);
create index if not exists idx_client_org_msp on client_org(msp_id);

-- People who log into the console (MSP staff). Phase 2 fronts this with SSO.
create table if not exists app_user (
  id          uuid primary key default gen_random_uuid(),
  msp_id      uuid not null references msp(id) on delete cascade,
  email       text not null,
  role        text not null default 'technician',   -- 'msp_admin' | 'technician'
  created_at  timestamptz not null default now(),
  unique (msp_id, email)
);

-- A managed browser/device reporting in via the collector.
create table if not exists device (
  id             uuid primary key default gen_random_uuid(),
  client_org_id  uuid not null references client_org(id) on delete cascade,
  hostname       text not null,
  last_seen      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (client_org_id, hostname)
);
create index if not exists idx_device_client on device(client_org_id);

-- Deduplicated extension metadata, shared across all tenants.
create table if not exists extension_catalog (
  ext_id          text primary key,
  name            text,
  latest_version  text,
  updated_at      timestamptz not null default now()
);

-- One row per extension seen on a device at last report (snapshot model:
-- a device's observations are replaced wholesale on each ingest).
create table if not exists extension_observation (
  id                uuid primary key default gen_random_uuid(),
  device_id         uuid not null references device(id) on delete cascade,
  ext_id            text not null references extension_catalog(ext_id),
  version           text,
  permissions       jsonb not null default '[]',
  host_permissions  jsonb not null default '[]',
  install_type      text,
  enabled           boolean,
  score             int not null,
  tier              text not null,                  -- 'critical'|'high'|'medium'|'low'
  seen_at           timestamptz not null default now()
);
create index if not exists idx_obs_device on extension_observation(device_id);
create index if not exists idx_obs_ext    on extension_observation(ext_id);
create index if not exists idx_obs_tier   on extension_observation(tier);

-- Cloud threat intelligence (Phase 4). Seeded empty for now.
create table if not exists threat_intel (
  ext_id                text primary key,
  store_status          text,                       -- 'listed'|'removed'|'unknown'
  ownership_changed_at  timestamptz,
  known_bad             boolean not null default false,
  known_good            boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- Per-client block/allow policy (Phase 3 enforces it).
create table if not exists policy (
  id             uuid primary key default gen_random_uuid(),
  client_org_id  uuid not null references client_org(id) on delete cascade,
  ext_id         text not null,
  action         text not null,                     -- 'block' | 'allow'
  created_by     uuid references app_user(id),
  created_at     timestamptz not null default now(),
  unique (client_org_id, ext_id)
);

-- Who did what — the compliance trail.
create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  client_org_id  uuid not null references client_org(id) on delete cascade,
  actor          text,
  action         text not null,
  ext_id         text,
  device_count   int,
  at             timestamptz not null default now()
);
create index if not exists idx_audit_client on audit_log(client_org_id);
