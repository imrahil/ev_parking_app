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

export type StationView = {
  ref: StationRef
  loading: boolean
  error: string | null
  data: StationApiResponse | null
  fetchedAt: number | null
}
