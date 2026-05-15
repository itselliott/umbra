# Umbra — Fleet/Admin Product Build Plan

How the single-user Chrome extension becomes a multi-tenant product MSPs resell.
Opinionated, phased, and explicit about what is assumed rather than known.

---

## Architecture at a glance (the target)

```
  managed collector extension          free lead-magnet extension
  (force-installed on client          (Chrome Web Store, audits
   browsers, POSTs inventory)          only your own browser)
            │                                   │
            │ HTTPS  inventory + change events   │  (no network)
            ▼                                    ▼
  ┌────────────────────────┐            renders locally
  │  Ingest API            │
  │  + server-side scoring │◄──── shared core: scoring engine
  │  (Next.js / Node, TS)  │      + permission-diff + types
  └───────────┬────────────┘
              │
       ┌──────▼───────┐      ┌──────────────────────────┐
       │  Postgres    │      │ Threat-intelligence svc  │
       │  multi-tenant│◄─────│ (Web Store polling,      │
       │  (Neon/      │      │  ownership-change &      │
       │   Supabase)  │      │  removal detection)      │
       └──────┬───────┘      └──────────────────────────┘
              │
       ┌──────▼────────────────────────┐
       │  MSP console (Next.js app)    │
       │  portfolio → client → device  │
       │  → extension; policy push     │
       │  SSO via WorkOS               │
       └───────────────────────────────┘
```

Three deployable units plus one shared library: **collector extension**, **backend
(ingest + console)**, **threat-intel service**, and a shared **`core`** package. A
pnpm/turborepo monorepo keeps the extension builds and the backend on one copy of the
scoring logic.

---

## Phase 0 — De-risk before committing (1–2 weeks, mostly not code)

The two assumptions that can sink the whole model are *deployment* and *policy push*.
Spike them before building Phase 1's real shape.

**Build:** a throwaway Chrome Enterprise test org. Force-install a trivial test
extension via Google Workspace admin; confirm `chrome.storage.managed` config injection
works; manually apply an `ExtensionInstallBlocklist` policy and confirm it actually
blocks. Separately, a 5-line collector that POSTs `chrome.management.getAll()` to a
throwaway endpoint.

**Milestone:** you know — not assume — that (a) a managed extension can be pushed and
configured centrally, and (b) policy can block an extension. Plus signed answers from
3–5 real MSPs on the validation questions below.

**Dependency:** none. Do this first.

---

## Phase 1 — Fleet inventory for one company (the design-partner demo)

The smallest thing that makes an MSP say "oh, I'd resell this": seeing *one client's
whole fleet* of extensions on one screen.

**What gets built**
- **Collector-lite**: a second build of the extension that, instead of rendering a
  local dashboard, POSTs its raw extension inventory (the `chrome.management.getAll()`
  payload — *not* scored locally) to the ingest API on install, on a daily alarm, and
  on `management` change events. Deployment for this phase = **manual install** on
  5–10 machines; force-install polish waits for Phase 2.
- **Ingest API**: one authenticated `POST /v1/inventory` endpoint. Node/TypeScript;
  Next.js API route is fine — it doubles as the console host later.
- **Postgres, multi-tenant schema from day one** (see data model below). Even though
  Phase 1 has a single client, every row carries `client_org_id` and `msp_id`.
- **Server-side scoring**: the `core` scoring engine (extracted from `audit.js`) runs
  on ingest, writes risk scores per observation.
- **Read-only console**: essentially today's dashboard UI, but fed from the backend and
  spanning *many devices* — a fleet roll-up, per-device drill-down, per-extension
  detail. Auth can be a single magic-link login for the demo; no MSP hierarchy yet.

**Milestone:** an MSP logs in and sees every extension across a client's 10 browsers,
risk-graded, with the same plain-English detail the single-user tool gives — something
they cannot get from Chrome today. No remediation yet; this is the value demo.

**Dependencies:** Phase 0 confirmed manual install works. Stack: Next.js on
Render/Railway/Vercel, Neon or Supabase Postgres.

---

## Phase 2 — The MSP console (the first sellable thing)

Turn "one company" into "an MSP's whole book of business," and make deployment real.

**What gets built**
- **Real multi-tenancy in the UI**: `MSP → client orgs → devices`. Portfolio view
  (every client, risk rollup each), drill into a client, drill into a device.
- **Auth + directory**: WorkOS for SSO and (later) directory sync — MSP buyers expect
  it. Role model: MSP admin, MSP technician, optionally client-org viewer.
- **Client onboarding**: an MSP adds a client, gets an **enrollment token**. The
  collector reads that token from `chrome.storage.managed`, so a client's browsers
  self-attribute to the right tenant with zero per-device login.
- **Force-install deployment docs + flow**: Google Workspace admin and the common MDMs;
  the managed-storage policy template that injects the enrollment token.
- **Server-side reporting**: the print-ready HTML/CSV/JSON export from the single-user
  tool, regenerated server-side, per client, optionally MSP-branded — the artifact an
  MSP hands their client or attaches to an insurance renewal.

**Milestone:** an MSP can onboard a client, push the collector fleet-wide, and run risk
reporting across their entire portfolio. This is the first thing you can charge for —
a paid pilot becomes possible.

**Dependencies:** Phase 1. WorkOS account.

---

## Phase 3 — Remediation / policy push (technically the riskiest)

Reading risk is a vitamin; *fixing* it is the painkiller MSPs pay for.

**What gets built**
- **Block / allowlist policy** managed in the console per client org, stored in
  Postgres.
- **Two enforcement paths**, because Chrome offers no single clean one:
  1. *Collector-enforced* — the collector pulls its client's block list and calls
     `chrome.management.setEnabled(id, false)`. Immediate, but a user can re-enable
     unless the extension is also policy-locked. Good for "disable now."
  2. *Policy-generated* — the console emits a Chrome Enterprise
     `ExtensionInstallBlocklist` / `Allowlist` policy the MSP applies via Workspace/MDM.
     Durable, but indirect.
  Ship path 1 first (fast, self-contained), then path 2 for durability.
- **Audit trail**: who blocked what, when, across which devices — the compliance artifact.

**Milestone:** from the console, an MSP blocks a risky extension and it actually goes
away across a client's fleet, with a logged trail.

**Dependencies:** Phase 2; **Phase 0 must have proven the policy mechanics** — if it
didn't, treat path 2 as research, not a committed deliverable.

---

## Phase 4 — Threat-intelligence service (the moat)

Permission scoring is cloneable in a weekend. A continuously-fed intel pipeline is not.
Can start in parallel once Phase 1's `core` package exists — it only changes scoring
*inputs*, not the collector.

**What gets built**
- A scheduled service that polls Chrome Web Store metadata to detect **removals**,
  **developer/ownership changes**, and version/permission history; ingests public
  security-research feeds; and maintains a growing corpus of analyzed extensions.
- Known-good / known-bad lists move from the stubbed seed in `audit.js` to a real,
  versioned dataset the backend reads at scoring time.
- The `core` scoring engine gains intel-aware signals — the collector ships nothing new;
  scores just get smarter on the server.

**Milestone:** Umbra flags what a scanner can't — "removed from the Web Store 6 days
ago," "changed owners last month." This is what separates it from the semantic-cmd-F
graveyard.

**Dependencies:** Phase 1's `core` extraction. **Feasibility unproven — see risks.**

---

## Phase 5 — MSP business layer (scale, after pilots prove the model)

Per-client billing and usage metering; RMM/PSA marketplace listings and integrations
(ConnectWise, NinjaOne, Atera, Kaseya) — themselves a distribution channel; white-label
/ co-branding; scheduled SLA reporting; directory sync for auto-enrolling new employees.

**Milestone:** Umbra runs as a product an MSP operates unattended across hundreds of
client seats.

**Dependencies:** Phase 2, and signal from real paid pilots that the model works.

---

## Data model sketch (lay this down in Phase 1)

```
msp(id, name, sso_config)
client_org(id, msp_id, name, enrollment_token)
app_user(id, msp_id, email, role)                  -- console logins
device(id, client_org_id, hostname, last_seen)
extension_catalog(ext_id, name, latest_version, ...) -- deduped across all tenants
extension_observation(id, device_id, ext_id, version, permissions[],
                      host_permissions[], install_type, enabled, score, tier, seen_at)
threat_intel(ext_id, store_status, ownership_changed_at, known_bad, known_good, ...)
policy(id, client_org_id, ext_id, action)           -- block | allow
audit_log(id, client_org_id, actor, action, ext_id, device_count, at)
```

Every tenant-scoped query filters on `msp_id` / `client_org_id`. Use Postgres row-level
security or a rigorously-applied app-layer scope — decide in Phase 1, never retrofit.

---

## Adapting the extension into the collector

**One shared brain, two thin shells.** Restructure the repo as a monorepo:

- **`packages/core`** — `audit.js` becomes a typed TS module here: `score`, `auditAll`,
  `summarize`, `plainEnglish`, `whyFlagged`, `remediation`, the permission-diff snapshot
  logic, and shared `ExtensionInfo` / result types. Pure, dependency-free, still covered
  by the existing test suite. **Consumed by all three** of: the free extension, the
  collector, and the backend. Server-side scoring is *literally the same code* — that's
  how local and cloud scores stay identical.
- **`apps/extension-free`** — today's extension, essentially unchanged. Bundles `core`,
  renders the local dashboard, no network. Stays the Web Store lead magnet.
- **`apps/extension-collector`** — a new, thinner build:
  - **Reuses as-is:** the `management` event wiring and the permission-diff snapshot
    logic from `background.js`.
  - **Drops:** `dashboard.html/js`, `popup` audit UI, the export code, the theme
    randomizer — the admin views all of that in the web console. The collector's only
    UI is a minimal "managed by your IT team / MSP" status page.
  - **Adds:** an inventory uploader (POST on install, daily alarm, and change events
    with backoff + offline queue); enrollment via `chrome.storage.managed` (the admin
    injects `{ enrollmentToken, apiBase }` through Workspace policy — no device login);
    optionally a block-list puller that enforces policy via
    `chrome.management.setEnabled`.
  - **Manifest differences:** still `management` + `storage`; **adds** host permission
    for the API domain; **drops** `notifications` (alerts move to the console);
    declared as force-installable; no `default_popup` audit UI.

**Staying in sync vs. diverging.** They share `core` — the scoring brain never forks.
They diverge only at the shell: the free build optimizes for a great solo experience and
zero network; the collector optimizes for silent, reliable reporting under management.
CI builds both from the monorepo on every change to `core`, so a scoring change can
never land in one without the other.

**Sequencing note:** do the `core` extraction *first*, inside Phase 1, before writing
the collector or the backend. Everything downstream depends on it.

---

## Riskiest pieces — validate with real MSPs *before* building

1. **Deployment reach (kills the model if wrong).** The collector model assumes MSPs
   can centrally force-install a browser extension across client fleets. Many SMBs have
   *no* centrally-managed browsers, or are on Microsoft Entra rather than Google
   Workspace, or are unmanaged entirely. **Validate:** ask 5 MSPs what fraction of their
   clients have manageable browsers, and via what (Workspace / Entra / MDM / nothing).
   If the answer is "most clients are unmanaged," the collector has to fall back to
   per-user install and the economics change. *This is the single biggest unchecked
   assumption.*

2. **Will MSPs actually resell it, and is there budget?** The entire business model.
   **Validate before Phase 2:** would they pay wholesale and mark it up? What ACV?
   Where does it sit — security line item, compliance, or nice-to-have?

3. **Policy-push reliability (Phase 3).** Chrome Enterprise policy plus the zoo of MDMs
   is more fragile than a slide makes it look. **Validate in Phase 0** on real managed
   devices; if it doesn't hold up, Phase 3 path 2 is research, not a commitment.

4. **Threat-intel sustainability (Phase 4 — the moat).** Polling the Chrome Web Store at
   scale may be rate-limited or actively blocked, and "ownership change" isn't a clean
   public signal. **Validate feasibility** before betting the moat on it; have a fallback
   (curated + community-sourced lists) if automated polling proves unviable.

5. **Free→paid funnel.** The lead-magnet → MSP-product funnel is assumed, not observed.
   Watch whether the free extension actually generates inbound, or whether the MSP
   channel has to be sold cold regardless.

---

## Explicit assumptions baked into this plan

- **MSPs are the right channel.** Carried over from the earlier strategy work; itself
  only lightly validated.
- **Target clients have centrally-managed browsers.** See risk #1 — the load-bearing
  assumption.
- **Chrome-first is enough for v1.** Edge is Chromium and should be cheap to follow;
  Firefox is a separate, later effort. Acceptable, but it narrows the initial market.
- **Server-side scoring == local scoring.** True *only if* `core` is genuinely shared
  code and not reimplemented. Non-negotiable: never fork the scoring engine.
- **A small team can carry this.** The plan deliberately leans on managed services
  (Neon/Supabase, WorkOS, a PaaS) and a monorepo to keep the surface area small — but
  Phases 3 and 4 are real engineering and will dominate the timeline.
