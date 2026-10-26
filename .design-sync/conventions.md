## Building with ParkingApp

An EV-charger status board (Swiss office parking). Components are real app code;
everything else is styled with **Tailwind v4 utility classes** compiled into
`styles.css`. There is no provider - components render styled as long as
`styles.css` is linked.

### Page setup
- Page background: `bg-paper` (light) / `bg-ink` (dark). Body text `text-navy`.
- Font is Libre Franklin Variable (a Franklin Gothic stand-in) via `--font-sans`;
  `styles.css` sets it on `body`, so text inherits it - no class needed.
- **Dark mode is class-based**: put `dark` on `<html>` (or any ancestor) and every
  `dark:` utility switches. Always pair surfaces: `bg-white text-navy dark:bg-navy dark:text-white`.

### Vocabulary (only these resolve - there is no Tailwind compiler at design time)
| Role | Classes |
|---|---|
| Brand accent / "Occupied" status text | `text-brand`, `bg-brand`, `accent-brand` |
| Available / success | `text-mint`, `bg-mint`, `bg-mint/15 ring-1 ring-mint/30` (chip) |
| Error / busy | `text-busy`, `bg-busy/10`, `bg-busy/15 ring-1 ring-busy/30` (chip) |
| Muted text | `text-navy/60 dark:text-white/60`, captions `text-navy/50 dark:text-white/50` |
| Dividers | `border-b border-navy/80 dark:border-white/80`, soft `border-navy/10 dark:border-white/10` |
| Active filter chip | `bg-selected text-white` |
| Hover wash | `hover:bg-navy/5 dark:hover:bg-white/5` |

Colour utilities exist for `ink navy brand mint busy paper selected white` with
`bg-/text-/border-/ring-` prefixes, `dark:`/`hover:` variants and opacity steps
`/5 /10 /15 /25 /30 /40 /50 /60 /80 /90`. Layout/spacing utilities are limited to
those the app itself uses (`flex`, `grid`, `gap-*`, `p-*`, `rounded-xl`,
`rounded-full`, `max-w-6xl`, `sm:`/`lg:` grid columns...) - check `_ds_bundle.css`
before relying on one; fall back to inline `style` for anything missing.

### Shapes
Cards: `rounded-xl p-5`. Status pills and buttons: `rounded-full px-2.5 py-1 text-xs font-semibold`.
Section labels: `text-xs font-semibold uppercase tracking-wide text-navy/50`.

### Components
- `StationCard` - `view` = `{ ref, loading, error, data, fetchedAt }`; `data.State`
  1 = Free (mint), 2 = Occupied (brand), anything else = Unknown. Pass `watch`
  to show the "Notify me" bell (occupied only).
- `SettingsDialog` - fixed full-screen overlay; render with `open`.
Read `components/general/<Name>/<Name>.prompt.md` and `.d.ts` before using one.
Also exported: `STATUS`, `STATE_CODE`, `STATUS_LABEL`, `CONNECTOR_STYLES`, `CONNECTOR_DOT`.

### Example
```jsx
const { StationCard } = window.ParkingApp
<div className="min-h-full bg-paper dark:bg-ink">
  <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <StationCard view={{ ref: { id: 'p1', name: 'Besucherparkplatz 1' }, loading: false, error: null,
        fetchedAt: Date.now(), data: { ID: 'p1', Name: 'Besucherparkplatz 1', Description: 'Visitor parking',
        State: 1, ActivePower: 0, IsDisabled: false, Connectors: [] } }} />
    </div>
  </main>
</div>
```
