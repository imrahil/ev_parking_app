import { SettingsDialog } from 'parking-app'

const groups = ['Besucherplatz', 'Parkhaus 1.OG', 'Parkhaus EG', 'Weisshorn', 'Aletschhorn']

// The dialog is a fixed full-viewport overlay. A transformed ancestor becomes
// its containing block, so the open state stays inside the preview frame.
const Frame = ({ dark = false, children }: { dark?: boolean; children: React.ReactNode }) => (
  <div
    className={dark ? 'dark bg-ink' : 'bg-paper'}
    style={{ position: 'relative', transform: 'translateZ(0)', width: 440, height: 500 }}
  >
    {children}
  </div>
)

export const Open = () => (
  <Frame>
    <SettingsDialog
      open
      onClose={() => {}}
      groups={groups}
      hidden={['Weisshorn']}
      onToggle={() => {}}
      pushState="ready"
      watchCount={2}
      pushError={null}
    />
  </Frame>
)

export const NeedsInstallDark = () => (
  <Frame dark>
    <SettingsDialog
      open
      onClose={() => {}}
      groups={groups}
      hidden={[]}
      onToggle={() => {}}
      pushState="needs-install"
      watchCount={0}
      pushError={null}
    />
  </Frame>
)
