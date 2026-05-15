# How Umbra Is Built

Umbra is a browser-extension risk auditor. It inspects the extensions installed in
a Chrome browser — a single machine, or an entire managed fleet — and scores each
one for data-exfiltration risk, with particular attention to AI-branded extensions
that embed themselves in tools like ChatGPT and Claude and can read everything typed
into them.

There are two products and a single engine beneath both:

- a **free, single-user extension** that audits the browser it is installed in,
  entirely locally; and
- a **multi-tenant fleet platform** — a managed collector extension, a backend, and
  a web console — that lets a managed service provider (MSP) audit extension risk
  across every browser in each of their client organizations.

Both compute risk with the same scoring engine, so a given extension receives an
identical score whether it is evaluated on a user's own machine or server-side from
a fleet report.

## Architecture

The system is four components plus one shared library, organized as an
npm-workspaces monorepo:

```
packages/core/             @umbra/core — the scoring engine
apps/extension-collector/  the managed collector extension
apps/backend/              Express API, web console, Postgres migrations
audit.js, manifest.json…   the free single-user extension (repository root)
docs/                      documentation
test/                      test suite
```

`@umbra/core` is the dependency of everything else. The free extension, the
collector, and the backend all consume it; nothing reimplements scoring.

## The scoring engine — `@umbra/core`

The scoring engine takes a Chrome `ExtensionInfo` object — the metadata Chrome's
`management` API already exposes about an installed extension — and returns a
structured assessment: a 0–100 risk score, a tier (`critical` / `high` / `medium` /
`low`), the specific reasons behind the score, a plain-English summary, and ordered
remediation steps. It makes no network calls; every judgement is derived from the
extension's own declared metadata.

The score combines several signals:

- **API permissions** are weighted by how dangerous they are if abused. `debugger`
  and `nativeMessaging` score heavily; `storage` and `alarms` barely register.
- **Host permissions** are analyzed for breadth. Access to every site (`<all_urls>`
  and equivalents) is treated as critical-weight, and access to known AI-tool
  domains is flagged on its own.
- **AI interposition** — an extension that can read content on AI tools, whether by
  host permission or by name, is called out specifically, because that is exactly
  where prompts, source code, and credentials get typed.
- **Install source** — sideloaded or developer-mode extensions, which never passed
  Chrome Web Store review, raise the score.
- **Naming heuristics** flag extensions whose names impersonate well-known products
  or use known bait keywords.
- **A persistence signal** — an extension that cannot be disabled through Chrome's
  normal controls, and is not enterprise-managed, is treated as a
  malware-persistence trait.
- **Reputation** — a curated known-good list dampens the score for recognized
  publishers; a known-bad list forces a maximum score.

The result is clamped to 0–100 and mapped to a tier. The engine also exposes
fleet-level helpers: auditing a whole list of extensions at once, applying an
allowlist, and producing a summary with a letter grade.

Because the engine is environment-agnostic JavaScript, the same file runs in the
browser (where it attaches to the global scope) and under Node (where it is an
ordinary module). That single shared implementation is what guarantees a device's
score is the same wherever it is computed.

## The free extension

A Manifest V3 Chrome extension that audits the browser it runs in. It requests only
three permissions — `management`, `storage`, and `notifications` — and makes no
network calls; the audit is entirely local.

Its dashboard lists every installed extension with a risk grade and a per-extension
breakdown: what the extension can do, why it was flagged, and what to do about it.
Remediation is real rather than advisory — extensions can be disabled or uninstalled
directly from the dashboard, and a persistent allowlist silences ones that have been
reviewed and accepted.

A background service worker provides continuous monitoring. It warns when a
newly installed extension is high-risk, and it keeps a snapshot of every extension's
permissions so it can warn when an update *expands* them and raises the risk score —
catching the common attack in which a benign extension is sold and quietly
weaponized in a later release. A toolbar badge shows a live count of critical- and
high-risk extensions.

Audits can be exported as a print-ready HTML report, a CSV, or raw JSON.

## The collector extension

The collector is the fleet counterpart of the free extension: a deliberately thin
Manifest V3 extension with no dashboard and no local scoring. Its only job is to
report.

It is deployed centrally — force-installed across an organization's browsers through
a Google Workspace or MDM policy — and configured the same way. The administrator
injects an enrollment token and the backend's API base through Chrome's
managed-storage policy; the collector reads them from `chrome.storage.managed` and
needs no per-device login. Until that configuration arrives, it stays idle.

Once enrolled, it reports the browser's raw extension inventory to the backend: on
install, on browser startup, whenever an extension is installed, removed, enabled,
or disabled (debounced), when its own configuration changes, and on a roughly daily
alarm. A failed report is queued and retried. Each device is identified by a stable
generated ID.

## The backend

A Node and Express service backed by Postgres. It does three things: ingests
collector reports, serves the console API, and serves the console itself.

**Ingest.** A collector POSTs one device's raw inventory, authenticated by its
client organization's enrollment token. The backend scores that inventory
server-side with `@umbra/core` and persists the result.

**Data model.** The schema is multi-tenant from its first migration. An MSP owns
client organizations; each client organization owns devices; each device has a set
of scored extension observations. Supporting tables hold a deduplicated extension
catalog, threat-intelligence data, per-client block/allow policy, an audit log, and
console sessions. Every tenant-scoped query is filtered by the caller's MSP.

**Auth.** The console uses a session-based auth layer that is deliberately
provider-agnostic. Sessions live in Postgres; the browser holds an opaque cookie
token. Two front ends plug into that layer: a dev mode with email-only login for
local development, and WorkOS AuthKit for production single sign-on. Switching
between them is an environment-variable change — the session layer is identical
either way. The collector's ingest endpoint is separate; it authenticates by
enrollment token, not a session.

**Console API.** A set of tenant-scoped endpoints: the signed-in MSP's portfolio,
one client organization's fleet overview, its extensions and its devices, client
onboarding, a deployment-artifact generator (the managed-storage configuration an
administrator pastes into Workspace), and a branded, print-ready fleet report
rendered server-side.

## The web console

A dependency-free, vanilla-JavaScript single-page app, served as static files by the
backend. A signed-in user sees only their own MSP's data: a portfolio of client
organizations sorted by risk, a per-client fleet view with summary cards and full
extension and device tables, an onboarding flow that issues a new client's
enrollment token, a step-by-step deployment guide, and an export button for the
branded report.

## Data flow

A managed browser's collector reads `chrome.management` and POSTs the raw inventory
to the backend. The backend scores it with `@umbra/core` and writes the observations
to Postgres. The console reads them back, scoped to the signed-in MSP, and presents
them. The free extension follows the same scoring path, but keeps everything local —
there is no backend in that case.

## Testing

The scoring engine and the extension modules are covered by a test suite built on
Node's built-in `node:test` runner, with no external dependencies. It includes
deterministic score assertions, a check of every individual heuristic and tier
boundary, edge cases for malformed input, a fuzz pass over thousands of randomly
shaped extensions, a behavioral test of the background worker, and load and smoke
tests of the UI modules under a mocked browser.

## Current state

Umbra is a working implementation: the free extension, the collector, the backend,
and the console all run and are tested. Two pieces are intentionally minimal in this
build. The reputation and threat-intelligence data is a small seed set rather than a
continuously updated feed, and production single sign-on requires a WorkOS account
to enable — the integration is wired, and the default is dev auth. Both sit behind
clean interfaces, so they extend the system rather than change it.

## Stack and principles

The codebase is plain, framework-light JavaScript in an npm-workspaces monorepo. The
backend is Express on Postgres; the console is hand-written vanilla JavaScript with
no build step; the extensions are Manifest V3 with no bundler. A few principles run
through it:

- **One scoring engine, never forked.** Local and server-side scores are identical
  because they are produced by the same code.
- **Local-first by default.** The free tool makes no network calls and requests the
  minimum set of permissions.
- **Multi-tenant from the first migration.** Tenancy was never retrofitted.
- **Provider-agnostic auth.** The session layer does not know or care whether an
  identity came from a dev login or enterprise SSO.
