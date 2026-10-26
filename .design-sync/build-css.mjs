// Compiles .design-sync/tailwind.css into .design-sync/.cache/tailwind.css
// (the converter's cfg.cssEntry). @font-face rules are stripped: their
// fontsource-relative urls don't survive the move, and cfg.extraFonts ships
// the same faces with working paths. Run from the repo root.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const out = '.design-sync/.cache/tailwind.css'
execFileSync('../.ds-sync/node_modules/.bin/tailwindcss', ['-i', 'tailwind.css', '-o', '.cache/tailwind.css', '--minify'], {
  cwd: '.design-sync',
  stdio: ['ignore', 'ignore', 'inherit'],
})
writeFileSync(out, readFileSync(out, 'utf8').replace(/@font-face\s*\{[^}]*\}/g, ''))
