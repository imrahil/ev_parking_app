# design-sync notes

This repo is an **app**, not a component library: no dist build, no Storybook.
The sync ships two components plus the Tailwind theme.

## How the build is wired
- **Run `node .design-sync/build-css.mjs` before the converter** (`cfg.buildCmd`).
  Tailwind v4 only emits classes it sees, so `.design-sync/tailwind.css` imports
  `src/index.css`, scans all of `src/`, and safelists the colour-token utilities
  that `conventions.md` advertises. Output: `.design-sync/.cache/tailwind.css` = `cfg.cssEntry`.
  The CLI lives in `.ds-sync/node_modules` (`npm i @tailwindcss/cli@<repo tailwindcss version>`).
- The scan must cover `src/consts/` - `CONNECTOR_STYLES` keeps its classes there.
  Scanning only `src/components` silently dropped `ring-mint/30`/`ring-busy/30` (chips lost their rings).
- `@font-face` rules are stripped from the compiled CSS (their fontsource-relative
  `./files/` urls break); fonts ship via `cfg.extraFonts` from `@fontsource-variable/libre-franklin`.
- `.design-sync/entry.ts` is the bundle entry (`cfg.entry`) - npm won't self-install
  `parking-app`, and without an entry the converter looks in `node_modules/parking-app`.
- Props aren't auto-extracted (inline/unexported prop types), so `cfg.dtsPropsFor`
  holds both contracts by hand. **Update them when a component's props change.**
- `import.meta.env` is defined by the converter for IIFE builds, so `src/api.ts` loads fine.
- Playwright must match the cached chromium (build 1194 -> `playwright@1.56.1` in `.ds-sync`).

## Previews
- SettingsDialog is `position: fixed`; previews wrap it in a `transform: translateZ(0)`
  frame so the open state stays in the card. Card mode `single` (primaryStory `Open`);
  `NeedsInstallDark` is still a graded story, just not on the card.
- StationCard uses `cardMode: column` (340px cards overflow grid cells).

## Known render warns
- `[FONT_MISSING] "ITC Franklin Gothic Std", "Libre Franklin"` - fallbacks in the
  `--font-sans` stack. ITC is commercial and only used where installed locally;
  `Libre Franklin Variable` (the real face) ships. Expected.

## Re-sync risks
- `cfg.dtsPropsFor` is hand-copied from `StationCard.tsx`/`SettingsDialog.tsx` and `src/types.ts` - goes stale silently when props change.
- The safelist in `tailwind.css` must stay in sync with the vocabulary table in `conventions.md`, and with the `@theme` colours in `src/index.css` (a new token needs adding to both).
- Previews use `Date.now()` for `fetchedAt`, so "Updated Xm ago" text is relative but stable.
- Tailwind CLI version is pinned by hand to the repo's `tailwindcss` version.
