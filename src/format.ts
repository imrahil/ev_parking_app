// ActivePower from ecarup is already in kW
export function formatPower(kw: number): string {
  return `${kw.toLocaleString('en', { maximumFractionDigits: 1 })} kW`
}

// Display text for whatever a catch block was handed
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
