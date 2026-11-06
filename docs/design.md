# Design

The look is **Spine**, approved by Omar on Oct 28. The mockups are in [design/spine/](design/spine/): `Main.dc.html` is the brand board (mark, colour, type, zones, verdicts, voice), and `Spine-Run.dc.html`, `Spine-Decision.dc.html` and `Spine-Dashboard.dc.html` are the run view, the escalation screen and the dashboard that the later web steps build. They are HTML mockups with inline styles, kept as the source of truth. They load Google Fonts and a `support.js` that isn't kept here, so they show best in the design canvas; the app itself self-hosts its fonts.

The code is in `apps/web`: tokens in `src/styles/tokens.css`, the components in `src/design/`, the theme in `src/theme/`.

## The idea

Chaperone is the pause before money moves. The run view is one vertical timeline whose spine is the money's route, with the gates as stations on it. Aubergine appears only where Chaperone is holding something.

## Rules

- **Red means an attacker.** `--attacker` is filled where money reached one: the amount, the payout path and the "Paid attacker" pill. It is outlined, never filled, on the seller text Gate 1 flagged as steering the purchase: the passages it copied, the "Fact crosses" chip and its card in the seller column. That outline is what points to the cause: "you would've lost your money here, but we caught it for you". Not errors, not warnings, not a blocked cart. Omar's decision, Oct 29, replacing "red only means money reached an attacker".
- **A block is neutral.** A block is the firewall working, so it is graphite (`--block`), not red. A blocked run is a good outcome.
- **Seller text always sits behind the hatch.** Anything a seller wrote goes in a `seller` zone, which draws the hatch and gives the text its own ground. Only Gate 1 reads it, and nothing else on a screen quotes it outside that zone.
- **Each fact is said once.** A screen doesn't repeat a verdict, an amount or a reason in a second place. A summary row can open to detail, but the detail doesn't restate the summary.
- **A state reads without colour.** The five states have five silhouettes, so they read in greyscale, at 16px and without their label.
- **Copy is short, in sentence case, with no em dashes.** Say what happened, then what is the person's to decide. Never scold the agent and never alarm the person: "We've paused this purchase. Nothing has been charged."
- **English only, desktop first, no sign-in.** The top bar wraps and the run list stacks below 760px, but desktop is what is designed and screenshotted.

## Tokens

Defined once in `tokens.css`, light and dark. Components use these names and never raw colours. Light is the default, dark follows the device, and the theme switch overrides both (below).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F5F3F4 | #141015 | Page ground |
| `--surface` | #FFFFFF | #1C171E | Panels, rows |
| `--sunk` | #EEEAED | #110D12 | Recessed areas, hover |
| `--ink` | #1E1620 | #F1ECF0 | Text, the primary button |
| `--ink-2` | #4D4250 | #CFC5CE | Secondary text |
| `--muted` | #675B6A | #A396A5 | Meta text |
| `--line` | #E5DFE3 | #2E2630 | Dividers |
| `--line-strong` | #CBC2C9 | #463B48 | Outlines |
| `--on-ink` | #FFFFFF | #141015 | Text on `--ink` |
| `--focus` | #4A2348 | #D2AACB | Focus ring |
| `--hold` | #4A2348 | #D2AACB | The hold, and the mark (aubergine, mauve) |
| `--hold-tint` | #F1E8F0 | #2B202C | Held ground |
| `--approve` | #1F6A55 | #6CCBAF | Approve |
| `--approve-tint` | #E2F0E9 | #16271F | Approve ground |
| `--approve-ink` | #185443 | #8ADBC2 | Approve text |
| `--escalate` | #8A5700 | #E7B55A | Escalate, the person |
| `--escalate-tint` | #F7EBD6 | #30271A | Escalate ground |
| `--escalate-ink` | #6E4600 | #F0C774 | Escalate text |
| `--block` | #2F2A31 | #E2DCE3 | Block |
| `--block-tint` | #E9E6EA | #2A242C | Block ground |
| `--attacker` | #B3261E | #FF7B6E | An attacker: filled for paid money, outlined on flagged seller text. Never an error, a warning or a block |
| `--attacker-tint` | #FBE9E7 | #3A1E1D | Paid attacker ground (the flagged outline needs no tint) |
| `--on-attacker` | #FFFFFF | #141015 | Text on `--attacker` |
| `--z-cat` | #F1F5FA | #10171F | Catalog zone ground |
| `--z-cat-ink` | #2B4A6B | #A9C3E0 | Catalog label |
| `--z-cat-line` | #D3DFEC | #22303F | Catalog outline |
| `--z-route` | #ECE2EB | #2A1E2C | Route zone ground |
| `--z-route-ink` | #4A2348 | #D2AACB | Route label |
| `--z-seller` | #EFEAE4 | #1E1B17 | Seller zone ground |
| `--z-seller-ink` | #5C4F42 | #CDBFAE | Seller label |
| `--hatch` | rgba(110, 92, 74, .2) | rgba(190, 172, 150, .13) | The seller hatch lines |

Not colour: `--font-serif`, `--font-sans` and `--font-mono`; the type sizes `--text-display` (64), `--text-page-title` (42), `--text-money` (42 to 66), `--text-section` (22), `--text-item` (17), `--text-body` (15), `--text-meta` (12.5) and `--text-data` (12.5); the radii `--radius-xs` (6) to `--radius-xl` (18); and the spacing steps `--space-1` (4) to `--space-8` (64).

### Type

**Newsreader** speaks: headlines, verdict sentences and money. **Host Grotesk** works: the interface. **Fragment Mono** records: run IDs, times and other data. All three are self-hosted from `@fontsource` packages, so the hosted demo needs no request to a font service. The `.t-display`, `.t-page-title`, `.t-section`, `.t-item`, `.t-meta` and `.t-data` classes in `base.css` set each step of the scale.

### Theme

The theme follows the device until the person picks one. The switch has three options: match the device, light and dark. An explicit pick is stored in this browser (`localStorage`, key `chaperone-theme`) and written to `<html data-theme>`; matching the device removes both, so the `prefers-color-scheme` rules in `tokens.css` decide. A small script in `index.html` applies a stored pick before the first paint. The dark values appear twice in `tokens.css`, once for the device and once for `data-theme="dark"`; keep them identical.

## The mark and the wordmark

The mark is the **Hold**: a rounded bracket holding a dot, "the pause before money moves". `src/design/Mark.tsx` builds it from its construction rule on a 48 unit grid:

- the corner radius equals the dot's width (11);
- the stroke is half the dot (5.5);
- the dot sits a little toward the opening: held, not trapped;
- clear space is one dot on every side.

Below 20px a hand-cut version on a 16 unit grid replaces it, since the full mark's strokes blur. The mark takes its colour from `--hold`: aubergine in light, mauve in dark. `public/favicon.svg` is the 16px cut, switching colour with the device.

The wordmark (`Wordmark.tsx`) is the mark and "Chaperone" in Newsreader 500, tracked at -0.02em.

The product's name, logo and graphics never use PayPal's name or logo. "Built on PayPal" as plain text in a description is fine.

## Components

| Component | What it is for |
|---|---|
| `Pill` | A gate's or a review's state: `approve`, `held`, `escalate`, `block` or `attacker` ("Paid attacker"). Each has its own silhouette and an accessible name ("Verdict: Approve"). |
| `StateGlyph` | The five silhouettes alone, for places where a pill is too big. |
| `Zone` | One of the three grounds: `catalog` (plain), `route` (tinted) or `seller` (hatched, with the text on its own ground). |
| `ReadChip` | What a gate reads: the catalog, seller text in quarantine, never seller text, or the facts it writes. |
| `Disclosure` | A row with a one-line summary that opens to detail ("10 checks passed"). The detail waits behind it. |
| `Money` | An amount in whole cents, in Newsreader, in four sizes. `formatMoney` is the same without the element. |
| `Button` | The primary action is the one filled button on a screen; everything else is secondary. `buttonClass` styles a link as a button. |
| `EmptyState` | A page with nothing on it yet. It names what will appear there. |
| `Mark`, `Wordmark` | The brand, as above. |

## The run view

`/runs/:runId` (`src/run/`) draws one run as the Spine-Run mockup does. `timeline.ts` is the pure mapping from the run's events to a model (the outcome, the money, the items), tested over real logs; `RunTimeline.tsx` draws the model with the generic timeline in `src/timeline/`, whose items are only a time, a zone, a kind, a title and a body, so a different vertical timeline could replace it.

- **Where a finding goes is the zone it read.** Gate 0's rule results are a card in the catalog column beside its station, Gate 1's reading is a card in the seller column (with the passages it copied), and Gate 2's judgement is a card in the catalog column. The station on the spine holds only the verdict and what the gate reads.
- **The seller column is the only place seller words appear**, including the passages Gate 1 copied and the page text they are marked in. Titles, reasons and the header never quote them; the cells carry `data-zone`, and a test checks it.
- **Rows are moments, not a time scale.** Each row is an event or a group that shares one (what the agent opened and what it was served), labelled with the seconds into the run. The mockup scales rows by time; real runs have long quiet gaps that would stretch the page.
- **Filled red is given by the payee, not the config.** A run turns red when a payout went to a seller the server says is an attacker (`GET /events/runs/:runId/payees`), whatever the firewall setting was.
- **Outlined red is given by Gate 1.** The passages it copied as steering (the `marked` segments), the "Fact crosses" chip and its card get a 1.5px `--attacker` outline, as the mockup draws the poisoned review. It shows on any run where Gate 1 flagged something, whatever the verdict, since it says where an attacker's money would have come from; the page doesn't have to know whose review is poisoned, only what the extractor flagged. The outline sits on the seller text and its card, so it never reaches the header or the route. It is at least 5:1 against the seller ground in light and dark, so it needs no tint.
- **The mandate says what it didn't enforce.** The terms row "Not enforced" lists words from the request that weren't made a rule ("mid-range"), with the hint "In your request, but not made a rule".
- **The route ends in three exits**: capture and pay the seller, to the person, void the hold. The one taken is solid, the others dashed.
- **An escalated run shows the held cart and the two options** from the Spine-Decision screen, with Reject as the filled button. They post to `POST /events/runs/:runId/decision`.
- **A page Gate 1 copied a passage from is open**, so the outlined passage is seen where it was written and not behind a closed row; the pages with nothing flagged stay closed.
- **A run in progress is read again every 1.5 seconds** until its money is settled, a gate broke, or a person has to decide.

## The Runs page

`/runs` (`src/pages/Runs.tsx`) is the history: every run, newest first, fifty to a page, so it stays quick with the few hundred an eval writes. `src/runs/filters.ts` is the pure side (reading and writing the filters, applying them, paging) and `src/runs/state.ts` says how a run ended.

- **Filters sit above the list**: a search by run ID, then outcome, firewall setting, scenario and attack or benign, with "Clear filters" once any is on. Each is one native select, which is keyboard and screen-reader complete for free.
- **The filters live in the address** (`?outcome=blocked&firewall=full&scenario=sc_a01&kind=attack&q=mvsq&page=2`), so a filtered view can be shared. Only what differs from everything is written, a value that means nothing is read as no filter, and a change goes back to the first page. Typing in the search writes the address when the typing pauses.
- **An outcome is exactly one of eight**: approved, blocked, held for a person, hold released, paid attacker, firewall off, review failed, or not reviewed yet, in the run view's own order of precedence (money that reached an attacker first, however the run got there). The list shows the same "Paid attacker" pill as the run view.
- **Held for a person follows the money.** An escalated run is one of four things, from whether a person decided and whether the platform's hold is still open (`escalationOf` in `@firewall/events`, which the server's run list, the web's `isHeldForPerson` and the run view's `buildRun` all use, so none can disagree): *waiting* (nobody decided, hold open), *unfinished* (a person decided, but the hold is still open or the payouts never finished), *released* (hold closed with nobody deciding) and *decided* (a person decided, hold closed). Waiting and unfinished are "held for a person": they are the filter, the top bar's count and the inbox. A released run is its own outcome, "Hold released", with no pill and no decision to make: the eval voids the hold of every escalated cell when it settles it, and those aren't waiting on anyone. An unfinished run shows the escalate pill and "Decision not finished" in the list.
- **The firewall column says which setting the outcome comes from**, the last review's, and, small beside it, which settings reviewed the same checkout before it ("after Off, Gate 0 only"): an eval cell is reviewed under off, gate0 and full. The firewall filter is on that last setting.
- **Attack or benign comes from the arena**, not the run's name: the server answers it from the scenario (`kind`), as it answers whether an attacker was paid (`attackerPaid`, rebuilt from the scenario and seed, never guessed). The list marks an attack scenario with a small "Attack" badge. This is an operator's view, like the payees.

## Replay

A finished run (or one waiting on a person) has "Replay this run" above its timeline; a run in progress is followed live and offered the replay once it is over. Replay plays the run's own events in log order, and the timeline builds up as the playhead passes each one. It draws `buildRun(events.slice(0, position))`, the same mapping as the live view over a prefix of the log, so it can't drift from it; at the last position it is the run view. The pure side is `src/run/playhead.ts` (positions, delays, keys, what to call an event); `useReplay.ts` holds the state; `ReplayBar.tsx` is the control.

- **The bar sits at the foot of the page and stays in view** while the timeline is read: play and pause, a step back and forward, a scrubber over the events with "12 of 45 · 6.8s", the speed (1×, 4×, Instant) and "Exit replay". Under it, one line says what the event at the playhead was ("Gate 1 flagged a passage as steering"), in fixed words: a seller's text never reaches it.
- **Speed**: 1× waits the real gap between two events, with a quiet gap capped at 1.5 seconds (a model turn can take half a minute), 4× a quarter of that, Instant goes straight to the end.
- **The position is `?at=<n>`**: how many events are shown, from 1. An event's ID works too (`?at=ev_0028`), and a position past the end is the end. It opens a shared link at that moment, paused. The address follows the playhead once it is still, and is left alone while it plays (a browser limits how often a page may rewrite its address).
- **The header follows the playhead.** The headline, the money (held, then captured or voided, and red only once a payout reaches an attacker), the cost and a "Replay, event 12 of 45" badge are those of the log up to that event. A decision that was already made isn't offered again while the playhead is before it.
- **Keyboard**: space plays and pauses, the left and right arrows step one event, Home and End go to the ends. A button keeps its own space, a slider its own arrows, and a search box or menu everything.
- **Reduced motion**: with `prefers-reduced-motion` the replay opens paused on the first event, to be played or stepped, and the page scrolls to the newest row without animating.

## Escalation inbox

`/escalations` (`src/pages/Escalations.tsx`, with `src/inbox/`) is every purchase held for a person: each escalated run whose hold is still open, whether nobody has decided it or a person decided and the money hasn't moved, the same rule as the count in the top bar (`isHeldForPerson`, see the Runs page). A hold released with no decision isn't listed. The oldest hold comes first, since it has waited longest. It is what the Spine-Decision mockup becomes when there are several, with the decision made from the list.

- **An item says what the run page says.** The request, the held cart, and one line for each gate that escalated come from `buildRun` (`heldReasons` is the title of that gate's card in the run view), so the inbox can't disagree with the run. It is read from the run's events once, and again only when the run has grown. A gate's line never quotes seller text, and the inbox has no seller zone.
- **How long it has been held** is the time since the review escalated ("Held for 7 hours", on hover the time itself), and **when the hold ends** is the authorization's expiry as the payments lane recorded it ("Hold ends in 28 days"). The sandbox may not report an expiry; then nothing is said, and it is never worked out. A hold already released says nothing either.
- **Deciding is the run view's call.** `useDecision` and `DecisionButtons` (`run/DecisionPanel.tsx`) are shared: Reject and release hold is the filled button, Approve and pay the secondary, and the server's own message ("This server can't carry out a decision: ...", or the platform's refusal) is shown under them. The buttons stay on screen when the server can't decide, because a fake-adapter run can't be decided from the server.
- **A decided item leaves the list** and a short note takes its place at the top: "Approved. $109.99 was captured and the seller paid." or "Rejected. The hold on $128.98 was released and nobody was paid.", with a link to the run and a way to dismiss it. A decision that was written but not carried out (the platform refused) keeps its item in the list, since its hold is still open, until it goes through: the item says "Decision not finished", which decision was recorded and why the last attempt failed, and offers one button, "Finish and pay" or "Finish and release hold", which sends the same decision again (the server finishes what is left; the opposite decision is refused with a 409). The run view's decision panel does the same.
- **A released hold has nothing to decide.** The run view says "The hold was released without a decision." with the money voided and no buttons, and a decision sent for it anyway is refused with a 409 before anything is written.
- **Recently decided** lists the last five runs a person decided and whose money has moved, with Approved or Rejected (a reject is a block, so it is the neutral pill), and how long ago. It leaves out what the page just confirmed.
- **Colour.** A held purchase is amber (`escalate`), never red: nothing has reached an attacker.
- **It stays current.** The list is read again every 7 seconds while the tab is visible, and at once when the window gets focus or the tab comes back, so a run that escalates appears without a reload. It stops when the page is left. The list isn't drawn until each held run has been read, so an item doesn't move as the rest arrive.
- **Empty**: "Nothing is waiting on you", with the same `EmptyState` as the rest.

