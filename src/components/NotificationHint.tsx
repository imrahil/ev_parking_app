import type { PushState } from '../types'

// 'unconfigured' shows nothing — direct mode has no worker to send from, so
// there is nothing the user could do about it.
const PUSH_HINT: Record<Exclude<PushState, 'unconfigured'>, string> = {
  ready:
    'Tap the bell on a busy charger to be notified once when it frees up. Watches fire a single time and expire after 8 hours.',
  blocked:
    'Notifications are blocked for this site. Re-enable them in your browser settings, then reload.',
  'needs-install':
    'On iPhone and iPad, notifications only work once the app is installed: tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser does not support web notifications.',
}

// How notifications work on this device, at the top of the footer.
export function NotificationHint({ state }: { state: PushState }) {
  if (state === 'unconfigured') return null
  return (
    <p className="mb-4 mx-auto max-w-md leading-relaxed text-navy/60 dark:text-white/60">
      <span aria-hidden>🔔 </span>
      {PUSH_HINT[state]}
    </p>
  )
}
