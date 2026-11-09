// ActivePower from ecarup is already in kW
export function formatPower(kw: number): string {
  return `${kw.toLocaleString('en', { maximumFractionDigits: 1 })} kW`
}
