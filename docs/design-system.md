# Design system

Quorum's interface is deliberately quiet. The page is flat, the type is one family, the borders are hairlines, and the
only loud thing on any screen is the data. The direction came from a close read of motion.dev, studeylearn.com,
johneytech.com and ui.shadcn.com (the section structure and footer of johneytech in particular), plus the brief's
rules: no purple gradients, no scroll-jacking, no odd visibility indicators, nothing that reads as generated.
(animejs.com could not be opened in the browser tool during the build, so it was not used as a reference.)

## Principles

1. **Flat and typographic.** Color is a neutral ground. Hierarchy comes from size, weight and space, not decoration.
2. **One accent, used for data and focus only.** The primary button is monochrome (near-black on light, near-white on
   dark). Blue appears in charts, links in running text, selected states and the focus ring, never as a button fill.
3. **Motion answers actions.** Things fade or rise a few pixels when they appear in response to something you did.
   Nothing animates on scroll, nothing loops (except spinners and skeletons), and nothing hijacks the scroll position.
4. **Say what happened.** Empty states point to the next action, errors say what went wrong and how to fix it, and one
   action keeps one name from button to toast.
5. **Honest limits are part of the design.** Notices explain what is and is not private; the footer and results pages
   say the tally is not certified.

## Tokens

Defined as CSS variables in `src/app/globals.css` and exposed to Tailwind through `@theme inline`.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#fafafa` | `#09090b` | Page ground |
| `--card` | `#ffffff` | `#141414` | Raised surface (cards, dialogs, chart surface) |
| `--fg` | `#0a0a0a` | `#fafafa` | Text |
| `--muted` / `--muted-fg` | `#f4f4f5` / `#6b6b73` | `#1c1c1f` / `#a1a1aa` | Quiet fills / secondary text |
| `--border` / `--input` | `#e6e6e8` / `#d4d4d8` | `#262629` / `#3a3a40` | Hairlines / form borders |
| `--primary` / `--primary-fg` | `#171717` / `#fafafa` | `#fafafa` / `#0a0a0a` | Primary button |
| `--accent` | `#2a78d6` | `#3987e5` | Data, focus, selection (marks and rings, not small text) |
| `--accent-text` | `#1f67c0` | `#6aa6f0` | The accent as small text, for example in the blue badge. Computed ≥ 4.5:1 on its soft background in both themes |
| `--good` `--warn` `--danger` (+ `-soft`) | `#0a7a2f` `#8a5a00` `#c0302f` | `#3fbf6a` `#e8b13c` `#ef6a68` | Status, always paired with an icon and words |
| `--chart-1` | `#2a78d6` | `#3987e5` | The single data color |
| `--chart-track` | `#cde2fb` | `#1d2f4a` | Bar track / secondary series |
| `--chart-mute` | `#b9b9c0` | `#55555c` | Deliberately de-emphasized data |
| `--chart-grid` | `#e6e6e8` | `#262629` | Gridlines (barely there) |
| `--stage-1..3` | `#86b6ef` `#3987e5` `#1c5cab` | same | Ordered stages (listed → verified → voted) |

**Type.** Geist Sans for everything, Geist Mono for ids and codes. Headings use tight negative tracking
(`-0.03em` at display sizes); body is 15 to 16 px with generous line height; paragraphs are capped near 65 characters
(`max-w-prose`). Sentence case throughout; no all-caps labels.

**Shape.** Radii of 6, 8, 12 and 16 px by element size. Borders are 1 px hairlines. The only shadows are on popovers
and menus.

**Spacing.** Tailwind's 4 px scale. Cards pad 20 to 24 px; sections separate with generous vertical rhythm and a
hairline rule rather than boxed bands.

## Layout

- **Marketing:** a single column with a narrow reading measure, one hero with a live ballot specimen, a stepped "how it
  works" panel, principle cards, a call to action with an information card, and a footer with an oversized wordmark.
- **App shell:** a slim top bar (brand, theme toggle, account menu), with election screens inside a tab navigation
  that reads as a short, ordered path: Overview, Ballot, Voters, Settings, Turnout, Results, Analytics, Activity. The
  Voters tab appears only for restricted elections, and Results and Analytics show a locked state that says when they
  unlock rather than an empty page.
- **Voter flow:** one narrow column, a constant width across all steps so the layout never jumps, with a visible
  step indicator (verify, choose, review) and a summary before submission.
- **Mobile:** screens were reviewed at about 380 px as well as desktop. Tables become lists below the `sm` breakpoint,
  the election tab bar scrolls horizontally, and chart label density scales with width. Form controls are 40 px tall;
  buttons come in 32, 36 and 44 px sizes.

## Screens

Marketing home, security and privacy limits, sign in, sign up, forgot and reset password, invite acceptance;
dashboard and first-run onboarding, new organization, organization (elections and members), new election;
election overview with lifecycle, ballot editor, voters list, import (upload or paste), import review, settings,
turnout with roll call, results, analytics, activity log; public voting page (verify, choose, review, done, already
voted, closed, not yet open), public results page; 404, error and global-error pages. Each exists in light and dark.

## Components

`src/components/ui/`: button, form controls, dialog (native `<dialog>`), toast, copy field, theme toggle, small
primitives (card, notice, badge, empty state, skeleton). `src/components/charts/`: shared chart kit (axes, tooltip,
legend, table toggle), ranked bars, participation stages, cumulative and hourly turnout charts. Results and analytics
views are shared between the admin pages and the public results page, so both render the same gated payload.

## Charts

Charts are hand-built SVG. Rules applied to every chart:

- **One form per job.** Ranked horizontal bars for tallies and margins, stages for participation, a cumulative line
  and hourly columns for turnout over time. No pies, no dual axes, no 3D.
- **One hue.** Data is the accent blue; context is track blue or neutral grey. Nothing is categorical-multi-hue, so
  there is no legend to decode.
- **Never color alone.** Every bar and mark has a text label or a value beside it, a tooltip on hover and keyboard
  focus, and every chart has a **Table** view with the same numbers. Forced-colors mode draws marks with an outline.
- **Honest scale.** Bars start at zero. Time series include zero-vote hours (a gap is not a missing point) and
  aggregate by day for long elections. The last axis label is end-anchored so it never clips.
- **Recessive furniture.** Hairline grid, muted axis text, no chart borders.

### Palette validation

The chart colors were checked with a data-visualization palette validator (OKLCH lightness band, chroma floor, contrast
against the chart surface, and ordered-ramp rules). The validator is a development tool and is not shipped in this
repository; the results below are what it reported against the actual card colors.

| Check | Light (`#ffffff` card) | Dark (`#141414` card) |
| --- | --- | --- |
| Single data color (`--chart-1`): lightness band, chroma floor, contrast ≥ 3:1 | Pass | Pass |
| Stage ramp (`--stage-1..3`): monotone lightness, adjacent ΔL ≥ 0.06, single hue, end contrast | Pass (light end 2.11:1) | Pass (end 2.78:1) |

Notes. The stage ramp's lighter steps clear the surface at about 2:1 to 2.8:1, which is the validator's floor for ordered
ramps, not the 3:1 required for categorical marks. That is acceptable here only because every stage is also named and
valued in text next to its bar, as noted above. The status colors (`--good`, `--warn`, `--danger`) are used for text and
icons with their soft backgrounds and are always paired with words. They were selected for contrast on their `-soft`
backgrounds but were not run through the categorical validator, because they are not series colors.

## Motion

| Class | Effect | Used for |
| --- | --- | --- |
| `q-rise` | 6 px rise and fade, 320 ms | A page's main content on first paint (hero, step changes) |
| `q-pop` | Scale from 97%, 160 ms | Dialogs, menus, tooltips |
| `q-fade` | Fade, 200 ms | Backdrops, toasts |
| `q-bar` | Bars grow from the left, 600 ms | Tally and participation bars after data loads |
| `q-check` | Check mark draws, 350 ms | Vote submitted |
| `q-skeleton`, `q-spin` | Shimmer, spinner | Loading only |

`prefers-reduced-motion: reduce` collapses all durations to near zero and shows the final state. No animation depends
on scroll position.

## Accessibility

- A visible focus ring (2 px accent, offset) on every interactive element; headings focused by script after a step
  change take focus without a ring because they are not controls.
- A "Skip to content" link, a labelled navigation landmark for the election tabs, `aria-current` on the active tab and
  step, and focus moved to the new step's heading in the voter flow (but not on first load).
- Form fields have visible labels, and inline error text is tied to its field with `aria-describedby` and `aria-invalid`.
- Radio and checkbox choices are real inputs, styled through `:has(:checked)`; whole rows are the hit target.
- Text contrast was computed for the token pairs that carry text. Body, secondary and status text on their surfaces are
  at least 4.5:1 in both themes (secondary text 5.1:1 light and 7.2:1 dark on the card; the primary button 17:1 or
  better). `--accent` itself is about 4.2:1 on the page ground in light mode, so it is used for marks, rings and
  selection, and `--accent-text` is used where it must be read as small text. Status is never conveyed by color alone.
  This was a token-level calculation, not a full audit of every screen; run an automated checker (axe, Lighthouse)
  before relying on AA.
- Dialogs use the native `<dialog>` element for focus trapping and Escape handling.
- Theme is stored in a `theme` cookie (default light). There is no system-preference detection; that is a deliberate,
  easily reversible choice, and `theme.tsx` is the one place to change it.

## Adding "neon" later

The brief mentions adding neon later. If that means Neon the database, see [deployment.md](deployment.md). If it also
means a neon accent, the token structure is ready: change `--accent`, `--chart-1`, `--chart-track` and `--stage-*` in
both themes, then re-check contrast against `#ffffff` and `#141414` with any palette validator (a very bright neon often fails the
light-theme contrast check and will need a darker light-mode variant than its dark-mode one).
