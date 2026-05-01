#!/usr/bin/env node
// Merge station IDs from a history.json file into public/stations.json.
// Usage: node scripts/update-stations.mjs <path-to-history.json>

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATIONS_PATH = resolve(__dirname, '..', 'public', 'stations.json')

const historyArg = process.argv[2]
if (!historyArg) {
  console.error('Usage: node scripts/update-stations.mjs <path-to-history.json>')
  process.exit(1)
}

const historyPath = resolve(process.cwd(), historyArg)

let history
try {
  history = JSON.parse(readFileSync(historyPath, 'utf8'))
} catch (e) {
  console.error(`Failed to read ${historyPath}: ${e.message}`)
  process.exit(1)
}

const entries = Array.isArray(history) ? history : history.histories
if (!Array.isArray(entries)) {
  console.error('Expected history.json to be an array or have a "histories" array.')
  process.exit(1)
}

const existing = JSON.parse(readFileSync(STATIONS_PATH, 'utf8'))
const map = new Map(existing.map((s) => [s.id, s.name]))
const before = map.size

const added = []
for (const h of entries) {
  const id = h?.station?.id
  const name = h?.station?.name
  if (!id) continue
  if (!map.has(id)) {
    map.set(id, name ?? id)
    added.push({ id, name: name ?? id })
  }
}

const merged = [...map].map(([id, name]) => ({ id, name }))
merged.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(STATIONS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8')

console.log(`stations.json: ${before} → ${merged.length} (${added.length} new)`)
for (const s of added) console.log(`  + ${s.name}  ${s.id}`)
