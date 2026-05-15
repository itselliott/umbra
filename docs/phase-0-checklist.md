# Umbra — Phase 0 Checklist

De-risk the fleet/admin product **before** writing any of its code. Two tracks, run in
parallel, ~1–2 weeks:

- **Track A — MSP validation calls** (target: 5 real MSPs)
- **Track B — technical spikes** (target: 5 throwaway spikes, half-a-day to a day each)

End with the **decision gates** at the bottom: each must be GREEN before committing to
Phase 1's shape.

> Prop for the calls: the free single-user extension. Run it on your own browser live,
> show them the risk report. Don't pitch the fleet product — let the artifact do the
> talking and ask discovery questions.

---

## Track A — MSP validation calls

Goal: 5 MSPs, ~30 min each. **Discovery, not a pitch** — don't lead the witness. Where
to find them: r/msp, local/regional MSP peer groups and meetups, MSP-focused Slack/
Discord communities, LinkedIn outreach to "owner / vCISO / service delivery manager" at
small MSPs.

### A1. Does the problem resonate? (ask before describing Umbra)

- [ ] "When an employee at one of your clients installs a browser extension, do you have
      any visibility into that today?"
- [ ] "Have you ever had an incident — or a near-miss — involving a browser extension?"
- [ ] "Are your clients asking you about AI tools or 'shadow AI' yet? Is it on their radar?"
- [ ] "Earlier this year 30+ malicious AI extensions hit ~900K users. Is that the kind of
      thing you're already fielding questions about?"

**Bad answer:** shrugs, "not really something we think about." If the pain isn't *felt*,
nothing downstream matters.

### A2. Deployment reach — THE critical question (plan risk #1)

- [ ] "Roughly what percentage of your clients have centrally-managed browsers?"
- [ ] "When a client *is* managed, what's the management layer — Google Workspace,
      Microsoft Entra/Intune, a dedicated MDM, your RMM, something else?"
- [ ] "If I handed you a Chrome extension to deploy across a client's machines, could you
      push it without touching every device? Walk me through how."
- [ ] "What share of your clients are effectively unmanaged — BYOD, no central control?"

**Bad answer:** "most of our SMB clients aren't centrally managed" or "we're all Entra,
no Workspace." Either means the force-install collector model needs rework before Phase 1
(per-user install fallback, Entra support, or a different wedge entirely).

### A3. Would you resell it, and is there budget?

- [ ] "Do you resell security add-ons to clients today? Which ones, and roughly what do
      they cost the client per seat?"
- [ ] "Could browser/extension security be its own line item, or would it fold into an
      existing security bundle?"
- [ ] "If this existed — multi-tenant console, per-client reporting, one-click block
      across a fleet — would you resell it? At what kind of per-seat price?"
- [ ] "Who at your shop would own it — a security person, the tech who runs onboarding,
      you?"
- [ ] "What would make this a *no*? Price, a tool that already covers it, not enough
      client demand?"

**Bad answer:** "interesting, but not something I'd put budget against." The channel
economics don't work if no one will resell it.

### A4. Current tools / competition

- [ ] "Do you use anything today for browser or extension risk — LayerX, Spin.AI, Secure
      Annex, Chrome Enterprise's own reporting, anything?"
- [ ] If yes: "What's missing from it?" If no: "Why not — cost, didn't know it existed,
      not a priority?"

### A5. Compliance angle

- [ ] "Do any of your clients face compliance pressure that touches software inventory or
      AI usage — EU AI Act, cyber-insurance questionnaires, SOC 2?"
- [ ] "Would an exportable per-client audit report help with renewals or audits?"

**Capture per call:** managed-browser %, management layer(s), would-resell (y/n) + price,
biggest objection, whether the problem visibly landed.

---

## Track B — technical spikes (throwaway code)

Each spike is time-boxed and disposable — the goal is a yes/no, not production code.

### B1. Chrome Enterprise force-install

- [ ] Set up a Google Workspace trial or dev org.
- [ ] Build a trivial test extension; force-install it to an OU via Admin Console →
      Chrome → Apps & Extensions.
- [ ] Confirm it appears on a managed test machine with **no** manual install.

**Pass:** force-install works end to end. **Fail:** rethink deployment entirely.

### B2. `chrome.storage.managed` config injection

- [ ] Give the test extension a `managed_schema.json` and read `chrome.storage.managed`.
- [ ] Set a managed configuration value via Workspace policy.
- [ ] Confirm the extension reads injected `{ enrollmentToken, apiBase }` values.

**Pass:** the collector can be configured centrally with zero per-device login — this is
the enrollment mechanism. **Fail:** enrollment needs another design.

### B3. Policy-based block + collector-enforced block

- [ ] Apply `ExtensionInstallBlocklist` via Workspace; confirm a target extension is
      blocked/disabled on the test machine.
- [ ] Separately, from an extension holding the `management` permission, call
      `chrome.management.setEnabled(id, false)` on another extension — confirm it works,
      and note whether the user can simply re-enable it.

**Pass:** at least one enforcement path is reliable. Records which path to ship first in
Phase 3 and how durable each is.

### B4. Inventory POST round-trip

- [ ] 5-line collector: `chrome.management.getAll()` → `fetch()` POST to a throwaway
      endpoint (Cloudflare Worker, RequestBin, or ngrok + tiny Node server).
- [ ] Confirm `permissions` and `hostPermissions` arrive intact; note payload size and
      what host permission / CORS setup the POST requires.

**Pass:** the data Umbra needs is actually in the payload, and the network requirement is
understood.

### B5. Threat-intel feasibility (the moat)

- [ ] Pull metadata for a known extension from the Chrome Web Store; check what's
      retrievable — version, last-updated, developer, whether "removed" is detectable.
- [ ] Poll ~50 extensions; check for rate limiting, blocking, ToS concerns.
- [ ] Determine whether "ownership / developer change" is even an observable signal.

**Pass:** some viable intel path exists (automated *or* curated/community-sourced).
**Fail:** the moat is weaker than assumed — reconsider before Phase 4.

---

## Decision gates — all must be GREEN before Phase 1

| Gate | GREEN | RED → action |
|---|---|---|
| **Problem resonance** (A1) | Pain lands with most MSPs unprompted | Stop — the thesis is off, don't build |
| **Deployment reach** (A2, B1) | ≥ ~half of MSP clients centrally manageable via a layer you can support | Rework the collector model (per-user fallback / Entra / new wedge) before Phase 1 |
| **MSP willingness** (A3) | ≥ 3 of 5 would resell at a real per-seat price | Channel economics don't work yet — fix positioning or pricing first |
| **Enrollment** (B2) | `chrome.storage.managed` injection works | Redesign enrollment before building the collector |
| **Policy push** (B3) | At least the collector-enforced path is reliable | Phase 3 path 2 becomes research, not a commitment |
| **Threat-intel** (B5) | An automated or curated intel path is viable | Moat is weaker — reconsider Phase 4 scope before relying on it |

If **Deployment reach** or **Problem resonance** comes back RED, do not proceed to
Phase 1 as written — those are the load-bearing assumptions, and building on top of a
broken one is the most expensive mistake available here.
