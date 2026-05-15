-- ============================================================
-- Umbra fleet/admin backend — auth layer
-- Console sessions. The browser holds an opaque cookie token;
-- the row here ties it to an app_user (and through them, an MSP).
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists session (
  token        text primary key,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists idx_session_user    on session(app_user_id);
create index if not exists idx_session_expires on session(expires_at);
