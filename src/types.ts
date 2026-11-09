export type StationRef = {
  id: string
  name: string
  group?: string
}

export type Connector = {
  Id: number
  Name: string
  State: number
  ActivePower: number
  MaxPower: number
}

export type StationApiResponse = {
  ID: string
  Name: string
  Description: string
  State: number
  ActivePower: number
  IsDisabled: boolean
  Connectors: Connector[]
}

// Shape served by the Cloudflare Worker's GET /stations (see worker/README.md)
export type AllStationsResponse = {
  updatedAt: number
  stations: {
    ref: StationRef
    data: StationApiResponse | null
    error?: string
  }[]
}

// Shape served by the Cloudflare Worker's GET /history: charging power in kW,
// one aligned series per station id; null = no reading (the fetch failed).
// `s` is "a car is plugged in" (1/0) and is absent in history written before
// it existed.
export type PowerHistory = {
  t: number[]
  p: Record<string, (number | null)[]>
  s?: Record<string, (number | null)[]>
}

// One station's slice of PowerHistory, as the chart takes it; every series is
// aligned to `times`.
export type PowerSeries = {
  times: number[]
  // kW; null = no reading (the fetch failed)
  values: (number | null)[]
  // 1 = a car was plugged in at that sample
  occupied?: (number | null)[]
}

export type StationView = {
  ref: StationRef
  loading: boolean
  error: string | null
  data: StationApiResponse | null
  fetchedAt: number | null
}

// PushSubscription.toJSON(), narrowed to what the worker stores and needs
export type PushSubscriptionPayload = {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}
