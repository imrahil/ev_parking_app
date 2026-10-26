import { StationCard } from 'parking-app'

const MIN = 60_000

// State codes from the ecarup API: 1 = available, 2 = occupied, anything else = unknown
const connector = (Id: number, Name: string, State: number) => ({
  Id,
  Name,
  State,
  ActivePower: State === 2 ? 7.4 : 0,
  MaxPower: 11,
})

const station = (name: string, State: number, Description: string, connectors = [connector(1, '1', State)]) => ({
  ID: name,
  Name: name,
  Description,
  State,
  ActivePower: 0,
  IsDisabled: false,
  Connectors: connectors,
})

const frame = { width: 340 }

export const Free = () => (
  <div style={frame}>
    <StationCard
      view={{
        ref: { id: 'p1', name: 'Besucherparkplatz 1', group: 'Besucherplatz' },
        loading: false,
        error: null,
        data: station('Besucherparkplatz 1', 1, 'Visitor parking, row A'),
        fetchedAt: Date.now() - 2 * MIN,
      }}
    />
  </div>
)

export const OccupiedWithNotify = () => (
  <div style={frame}>
    <StationCard
      view={{
        ref: { id: 'p2', name: 'Parkhaus 1.OG 01', group: 'Parkhaus 1.OG' },
        loading: false,
        error: null,
        data: station('Parkhaus 1.OG 01', 2, 'Parking garage, level 1', [
          connector(1, 'A', 2),
          connector(2, 'B', 1),
        ]),
        fetchedAt: Date.now() - 4 * MIN,
      }}
      watch={{ armed: false, busy: false, onToggle: () => {} }}
    />
  </div>
)

export const Watching = () => (
  <div style={frame}>
    <StationCard
      view={{
        ref: { id: 'p3', name: 'Weisshorn 2', group: 'Weisshorn' },
        loading: false,
        error: null,
        data: station('Weisshorn 2', 2, 'Weisshorn building, north side'),
        fetchedAt: Date.now() - 7 * MIN,
      }}
      watch={{ armed: true, busy: false, onToggle: () => {} }}
    />
  </div>
)

export const UnknownWithError = () => (
  <div style={frame}>
    <StationCard
      view={{
        ref: { id: 'p4', name: 'Aletschhorn 1', group: 'Aletschhorn' },
        loading: false,
        error: 'HTTP 503',
        data: null,
        fetchedAt: Date.now() - 38 * MIN,
      }}
    />
  </div>
)

export const Loading = () => (
  <div style={frame}>
    <StationCard
      view={{
        ref: { id: 'p5', name: 'Parkhaus EG 03', group: 'Parkhaus EG' },
        loading: true,
        error: null,
        data: null,
        fetchedAt: null,
      }}
    />
  </div>
)

// Dark mode is class-based: any ancestor with .dark switches the dark: variants
export const DarkMode = () => (
  <div className="dark bg-ink p-4 rounded-xl" style={{ width: 372 }}>
    <StationCard
      view={{
        ref: { id: 'p6', name: 'Parkhaus EG 01', group: 'Parkhaus EG' },
        loading: false,
        error: null,
        data: station('Parkhaus EG 01', 2, 'Parking garage, ground floor', [
          connector(1, 'A', 2),
          connector(2, 'B', 2),
          connector(3, 'C', 1),
        ]),
        fetchedAt: Date.now() - 1 * MIN,
      }}
      watch={{ armed: false, busy: false, onToggle: () => {} }}
    />
  </div>
)
