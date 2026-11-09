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
// one aligned series per station id; null = no reading (the fetch failed)
export type PowerHistory = {
  t: number[]
  p: Record<string, (number | null)[]>
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
