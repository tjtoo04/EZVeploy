# Design — EZVeploy ("the box wall")

`$impeccable document` equivalent, written from the built world (no subagent
capability in this harness — recorded inline). Ground truth over intention:
this describes the CSS/theme files as they ship, not a wish list.

## The world

A root panel that reads like **a wall of sneaker boxes under a work lamp**,
not like a dashboard in a browser tab. The admin is a lone root user at night:
the page is dark **board**, every piece of real content sits on **tissue**
(the inside of a box). Tenants are **shelves**; containers are **end labels**;
status is a **colorway chip**; action is **burnt orange**.

## Tokens

| Role | Value(s) | Used for |
| --- | --- | --- |
| Board (exteriors) | `#171006 → #a18469` (12-step ramp) | page ground, masthead, shelves, tags |
| Tissue (interiors) | `#fdf7ec → #2e241a` (12-step ramp) | tables, cards, chips, surfaces |
| Paper ink | `#f6eedd` on board / `#33240f` on tissue | all text |
| Burnt orange | primary `#e0761e`; hover `#ee913a`; pressed `#c9610d` | action, focus, pull spine, brand mark |
| Moss / rust / amber | `#6e9e4f` / `#c2512f` (text `#cf6a45`) / `#c98a1b` | status chips: up / down / warn |

Sources: `ui/src/theme.mjs` (PrimeVue preset — Aura base re-primitive'd) and
`ui/src/assets/main.css` (world chrome). The PrimeVue layer runs the **light**
scheme on tissue; board is painted by world CSS around it.

### Auto light / dark

The UI follows `prefers-color-scheme` end to end (`darkModeSelector:
"system"` in `ui/src/setup.js`; `color-scheme: light dark` on `:root`). Every
token is a CSS `light-dark()` pair, mirrored in the theme preset's `surface`
and component tokens (`ui/src/theme.mjs` — `boardLight` / `tissueDark` ramps).

- **Light scheme** = kraft exterior: page ground `#ece0c2`, masthead
  `#d4bd8f`, shelves `#c9b182`, board ink `#3f3118`; interiors stay cream
  tissue, controls ride on tissue.
- **Dark scheme** = the original charred board (`#20140a` ground), tissue
  interiors darken to `#241b10 → #e6d7b6`.
- Fixed material surfaces that do **not** flip: the log viewport (a terminal
  in both schemes, `--log-bg`/`--log-fg`), the error band, and the
  rust-on-tissue form-error text.
- Status & accent colors use per-scheme pairs (moss/rust/amber/orange)
  computed to hold 4.5:1 text / 3:1 graphics on every surface in both
  schemes. `::selection` is pinned `#33240f` on orange.
- The token table above lists dark-scheme values; light pairs live in the
  CSS/theme files.

## Typography

- **Condensed caps** (`'DejaVu Sans Condensed'`, `'Arial Narrow'`, DejaVu Sans) —
  brand, page titles, shelf names, labels, buttons, nav. Letterspaced
  `0.04–0.09em`, uppercase.
- **Mono** (DejaVu Sans Mono, Cascadia, JetBrains Mono, Consolas) — code-facing
  facts: ports, images, uids, timestamps, log viewport, script output.
- Body — DejaVu Sans / Liberation Sans / system-ui.
- System faces only, self-hosted-by-distribution: the VPS has no internet need
  for fonts; the register is Operate (workhorse faces are the sanctioned home).

## Layout & chrome

- **Masthead** — board-800 shelf on board-900 ground, 1px board-500 rule; brand
  mark (one-line box silhouette, orange) + EZVEPLOY caps + `root panel` tag;
  nav tabs as caps links with an orange active underline; right side session
  tag with a moss dot. A `fixture data` amber tag appears when the API reports
  fixture mode (synthetic demo data — labeled honestly in the UI).
- **Page head** — caps title (24px) + mono-meta + actions (Refresh) aligned
  right.
- **The wall** (Containers) — a PrimeVue DataTable, column headers hidden;
  group subheaders are the **shelves**: orange pull spine, tenant caps name +
  mono `#uid`, daemon state chip (`up` moss / `down` rust), count hint. Rows
  are end labels on tissue: caps name + short id, mono image, ports as mono
  size-runs (`8080→80›tcp`), status chip (dot + `Up 3 hours`). Empty tenants
  and daemon-down tenants get explicit rows — nothing disappears.
- **Observability** — back crumb (orange), user/name caps title, four stat
  chips (mono value over caps label), then the tissue-dark log viewport
  (mono, `pre-wrap`), toolbar with follow/pause. Frozen = muted label, no
  painted borders.
- **Add Domain** — one interior card (the box pulled halfway out): caps
  subhead, mono domain input, full-width tenant select, orange Provision
  button; success/failure bands with the script output; provisioned domains as
  a tissue table (caps domain, owner, ISO added, mono script output).

## Motion

One authored moment: the box slides half out — rows hover to tissue-100 plus an
orange left spine + orange chevron in `0.18s ease-out`. Everything else moves
only in response (follow/pause text state). Full `prefers-reduced-motion`
honoring.

## States

- Chips: `up` moss dot, `down` rust dot + lighter rust label, `warn` amber.
- Log view: snapshot ↔ following ↔ reconnecting (amber) ↔ frozen (label-only).
- Buttons: orange primary with dark-ink text; `p-button` loading spinner on
  Provision; disabled while in-flight.
- Errors: mono rust text on a light rust tint, naming the problem and (for
  script failures) the output. Empty states: one-line box silhouette + caps.
- Focus: 2px orange ring + 1px offset everywhere.

## Accessibility

Contrast computed from shipped tokens (see the finish review): body 15.6:1,
meta 5.15:1 min, button text 4.84:1, all status/dimension text ≥ 4.5:1 (the
rust chip text uses a dedicated lighter rust `#cf6a45` for 4.6:1 on board);
decorative arrows orange-600 ≥ 3:1. Focus rings visible; controls keyboard
operable; log viewport aria-labeled; icons from one stroke family (PrimeIcons).

## Anti-patterns (enforced)

No kickers, no section numbers, no glyph/emoji icons, no gradient text, no
glass, no side-tab/border-left accents (a detector finding was fixed by moving
the frozen cue into text), no hard offset shadows, no gray-on-gray, no
sparklines/progress rings for data that is a raw number.

## Components map

PrimeVue supplies behavior only: DataTable (row groups, row click), Select,
InputText, Button, Toast, Message. Every surface decision is world CSS on the
shipped tokens. The log view, chips, shelves and stat cards are hand-built.

## Responsive

Desktop-first (admin panel). The stage is a single 1180px rail; shelves and
rows reflow to single-column below ~720px with identical content. Mobile was
not render-verified this session (headless screenshot budget) — see the finish
record.
