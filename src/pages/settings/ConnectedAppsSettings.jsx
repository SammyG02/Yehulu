import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, Copy, Link2, Plug, Unplug } from 'lucide-react'
import { GoogleButton } from '../../components/auth/GoogleButton.jsx'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { cloudApi } from '../../lib/cloud.js'
import { formatDate } from '../../lib/format.js'
import { supabase } from '../../lib/supabase.js'
import { useAuth, useConfirm, useSavings } from '../../state/hooks.js'

const api = supabase ? cloudApi(supabase) : null
const APPS = { chinka: 'Chinka' }
const day = (iso) => formatDate(iso.slice(0, 10))

// Exactly what a connected app can read: shown before connecting.
const SHARED = [
  'Your Yehulu accounts, their rates and your goals',
  'Every deposit and withdrawal you can see in Yehulu (your own; everyone\'s in accounts where you may see them)',
  'Your balance, interest by day and month, and fees',
  'Read only: it can never add, change or remove anything',
]

/** Connect Chinka: pick accounts, then show the key once. */
function Connect({ onDone }) {
  const { accounts } = useSavings()
  const cloudAccounts = accounts.filter(a => a.cloud)
  const [all, setAll] = useState(true)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [key, setKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setError(null)
    if (!all && picked.size === 0) return setError('Pick at least one account.')
    setBusy(true)
    try {
      setKey(await api.connectApp('chinka', all ? null : [...picked]))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(key); setCopied(true) } catch { setCopied(false) }
  }

  if (key) {
    return (
      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="font-bold">Chinka's access key</h3>
        <p className="text-sm text-muted">Paste it into Chinka. It's shown only now: Yehulu doesn't keep a copy. It shows as connected once Chinka first reads your data.</p>
        <code className="block select-all break-all rounded-xl bg-sunken px-3 py-2.5 font-mono text-xs">{key}</code>
        <p className="text-xs text-accent">Treat it like a password: anyone with it can read your Yehulu data until you disconnect.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={copy}>
            {copied ? <><Check className="h-4 w-4" aria-hidden="true" /> Copied</> : <><Copy className="h-4 w-4" aria-hidden="true" /> Copy</>}
          </Button>
          <Button onClick={() => { setKey(null); onDone() }}>I've copied it</Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="font-bold">Connect Chinka</h3>
        <p className="text-sm text-muted">Chinka will be able to read:</p>
        <ul className="mt-2 space-y-1 text-sm">
          {SHARED.map(s => <li key={s} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-ink" aria-hidden="true" />{s}</li>)}
        </ul>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Which accounts</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={all} onChange={() => setAll(true)} className="h-4 w-4 accent-brand" /> All my accounts (including new ones)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={!all} onChange={() => setAll(false)} className="h-4 w-4 accent-brand" /> Only these:
        </label>
        {!all && (
          <div className="space-y-1.5 pl-6">
            {cloudAccounts.map(a => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.has(a.id)}
                  onChange={(e) => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n })}
                  className="h-4 w-4 accent-brand"
                />
                {a.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={create} disabled={busy}>{busy ? 'Connecting…' : 'Connect and get key'}</Button>
      </div>
    </Card>
  )
}

export default function ConnectedAppsSettings() {
  const { user } = useAuth()
  const { accounts } = useSavings()
  const confirm = useConfirm()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [connecting, setConnecting] = useState(false)

  const load = useCallback(async () => {
    try { setList(await api.listConnections()); setError(null) } catch (err) { setError(err.message) }
  }, [])
  useEffect(() => { if (user && api) load() }, [user, load])

  if (!user || !api) {
    return (
      <SettingsPanel title="Connected apps" description="Let apps like Chinka read your Yehulu savings.">
        <Card className="space-y-4 p-4">
          <p className="text-sm text-muted">Sign in first: connected apps read your online accounts.</p>
          <GoogleButton returnTo="/settings/connections" />
        </Card>
      </SettingsPanel>
    )
  }

  const disconnect = async (c) => {
    const used = Boolean(c.last_used_at)
    if (!(await confirm({
      title: used ? `Disconnect ${APPS[c.app] ?? c.app}?` : `Cancel key …${c.key_hint}?`,
      message: used
        ? 'Its key stops working straight away. It can no longer read your Yehulu data.'
        : "This key hasn't been used yet. Once cancelled, it can't be used.",
      confirmLabel: used ? 'Disconnect' : 'Cancel key',
      danger: true,
    }))) return
    try { await api.disconnectApp(c.id); await load() } catch (err) { setError(err.message) }
  }
  const scope = (c) => (!c.account_ids ? 'All your accounts'
    : c.account_ids.map(id => accounts.find(a => a.id === id)?.name ?? 'an account you left').join(', '))

  return (
    <SettingsPanel title="Connected apps" description="Apps you let read your Yehulu savings. Read only, and you can disconnect any time.">
      {list && list.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map(c => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${c.last_used_at ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-muted'}`}>
                  {c.last_used_at ? <Link2 className="h-4 w-4" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                    {APPS[c.app] ?? c.app}
                    {c.last_used_at
                      ? <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand-ink">Connected</span>
                      : <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">Waiting for {APPS[c.app] ?? c.app}</span>}
                  </span>
                  <span className="block text-xs text-muted">
                    Key …{c.key_hint} · {scope(c)}
                  </span>
                  <span className="block text-xs text-muted">
                    {c.last_used_at
                      ? `Last read ${day(c.last_used_at)} · key made ${day(c.created_at)}`
                      : `Key made ${day(c.created_at)}. Not used yet: paste it into ${APPS[c.app] ?? c.app} to finish connecting.`}
                  </span>
                </span>
                <Button variant="danger" size="sm" onClick={() => disconnect(c)} className="flex-shrink-0">
                  <Unplug className="h-4 w-4" aria-hidden="true" /> {c.last_used_at ? 'Disconnect' : 'Cancel key'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list && list.length === 0 && !connecting && (
        <p className="text-sm text-muted">No apps connected.</p>
      )}
      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}
      {connecting
        ? <Connect onDone={() => { setConnecting(false); load() }} />
        : (
          <Button onClick={() => setConnecting(true)}>
            <Plug className="h-4 w-4" aria-hidden="true" /> Connect Chinka
          </Button>
        )}
    </SettingsPanel>
  )
}
