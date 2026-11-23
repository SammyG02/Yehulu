import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { GoogleButton } from '../../components/auth/GoogleButton.jsx'
import { InstallBanner } from '../../components/InstallBanner.jsx'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { disablePush, enablePush, isOnForMe, pushSupport } from '../../lib/push.js'
import { supabase } from '../../lib/supabase.js'
import { useAuth, useSavings } from '../../state/hooks.js'

const SWITCH = 'mt-1 h-5 w-9 flex-shrink-0 cursor-pointer appearance-none rounded-full bg-line transition before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition checked:bg-brand checked:before:translate-x-[1.1rem]'
const DEFAULTS = { weekly: true, goal: true, reminder: true, reminder_day: 1, shared: true }
const KINDS = [
  ['weekly', 'Weekly interest summary', 'Sunday morning: what you earned this week and your balance.'],
  ['goal', 'Goal reached', 'The morning after your balance passes your savings goal.'],
  ['reminder', 'Monthly deposit reminder', "On a day you choose, if you've set a monthly amount in your goal."],
  ['shared', 'Money added to shared accounts', 'When someone adds money to an account you share and can see.'],
]

/** Notifications: turn them on for this phone, and choose which ones. */
export default function NotificationsSettings() {
  const { user } = useAuth()
  const { actions } = useSavings()
  const support = pushSupport()
  const [on, setOn] = useState(null) // this phone subscribed?
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [prefs, setPrefs] = useState(DEFAULTS)

  const load = useCallback(async () => {
    setOn(await isOnForMe(supabase).catch(() => false))
    const { data } = await supabase.from('push_settings').select('weekly, goal, reminder, reminder_day, shared').maybeSingle()
    if (data) setPrefs({ ...DEFAULTS, ...data })
  }, [])
  useEffect(() => { if (user && supabase && support === 'ok') load() }, [user, support, load])

  if (!user || !supabase) {
    return (
      <SettingsPanel title="Notifications" description="Weekly summaries, goals and reminders on your phone.">
        <Card className="space-y-4 p-4">
          <p className="text-sm text-muted">Sign in first: notifications are about your online accounts.</p>
          <GoogleButton returnTo="/settings/notifications" />
        </Card>
      </SettingsPanel>
    )
  }

  const toggleThisPhone = async () => {
    setBusy(true)
    setError(null)
    try {
      if (on) { await disablePush(supabase); setOn(false); actions.showToast('Notifications off on this phone') }
      else { await enablePush(supabase); setOn(true); actions.showToast('Notifications on') }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (change) => {
    const before = prefs
    const next = { ...prefs, ...change }
    setPrefs(next)
    const { error: err } = await supabase.from('push_settings').upsert({ user_id: user.id, ...next })
    // Not saved: put the switch back, so it never shows a choice that isn't kept.
    if (err) { setPrefs(before); setError(`Couldn't save that: ${err.message}`) }
  }

  return (
    <SettingsPanel title="Notifications" description="Weekly summaries, goals and reminders on your phone, at 9:00 in the morning.">
      {support === 'install-first' && (
        <>
          <p className="text-sm text-muted">On iPhone, notifications work in the Yehulu app on your Home Screen. Add it first, then turn them on there.</p>
          <InstallBanner always />
        </>
      )}
      {support === 'unsupported' && <Card className="p-4 text-sm text-muted">This browser can't show notifications. Try Chrome on Android, or the home-screen app on iPhone.</Card>}
      {support === 'not-set-up' && <Card className="p-4 text-sm text-muted">Notifications aren't set up on this version of Yehulu yet.</Card>}

      {support === 'ok' && (
        <>
          <Card className="flex items-center gap-3 p-4">
            <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${on ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-muted'}`}>
              {on ? <Bell className="h-5 w-5" aria-hidden="true" /> : <BellOff className="h-5 w-5" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{on ? 'On for this phone' : 'Off for this phone'}</span>
              <span className="block text-xs text-muted">{on ? 'You can turn them off any time.' : 'Your phone will ask for permission.'}</span>
            </span>
            <Button variant={on ? 'secondary' : 'primary'} size="sm" onClick={toggleThisPhone} disabled={busy || on === null}>
              {busy ? '…' : on ? 'Turn off' : 'Turn on'}
            </Button>
          </Card>
          {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}

          {/* Which kinds: only once this phone gets notifications at all. */}
          {on && <Card className="divide-y divide-line">
            {KINDS.map(([key, label, hint]) => (
              <div key={key} className="p-4">
                <label className="flex cursor-pointer items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{hint}</span>
                  </span>
                  <input type="checkbox" role="switch" checked={prefs[key]} onChange={(e) => save({ [key]: e.target.checked })} className={SWITCH} />
                </label>
                {key === 'reminder' && prefs.reminder && (
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted">Remind me on day</span>
                    <select value={prefs.reminder_day} onChange={(e) => save({ reminder_day: Number(e.target.value) })} className="w-16 rounded-lg border border-line bg-sunken px-2 py-1.5 text-sm tabular-nums" aria-label="Day of the month">
                      {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                    <span className="text-muted">of each month</span>
                  </label>
                )}
              </div>
            ))}
          </Card>}
          {on && <p className="text-xs text-muted">These choices apply to all your phones. "Turn on" is for each phone.</p>}
          {on === false && (
            <p className="text-xs text-muted">
              Once on, you choose which ones you get: weekly interest summary, goal reached, monthly deposit reminder,
              and money added to shared accounts.
            </p>
          )}
        </>
      )}
    </SettingsPanel>
  )
}
