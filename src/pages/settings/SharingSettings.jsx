import { useState } from 'react'
import { Link } from 'react-router'
import { Copy, DoorOpen, Link2, Link2Off, RefreshCw, Share2, UserMinus } from 'lucide-react'
import { Avatar } from '../../components/accounts/MembersCard.jsx'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card, CardHeader } from '../../components/ui/Card.jsx'
import { useAuth, useSavings } from '../../state/hooks.js'

const inviteUrl = (code) => `${window.location.origin}/join/${code}`

function InviteCard() {
  const { account, actions } = useSavings()
  const [busy, setBusy] = useState(false)
  const url = account.inviteCode ? inviteUrl(account.inviteCode) : null

  const change = async (enabled) => {
    setBusy(true)
    await actions.setInvite(enabled)
    setBusy(false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      actions.showToast('Invite link copied')
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  const share = () => navigator.share({ title: `Join ${account.name} on Yehulu`, text: `Save with me in ${account.name} on Yehulu:`, url }).catch(() => {})

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Invite link" subtitle="Anyone with the link can join after signing in with Google." />
      {url ? (
        <div className="space-y-3 p-4 sm:px-5">
          <p className="break-all rounded-xl bg-sunken px-3 py-2.5 font-mono text-xs">{url}</p>
          <div className="flex flex-wrap gap-2">
            {typeof navigator.share === 'function' && (
              <Button onClick={share}><Share2 className="h-4 w-4" aria-hidden="true" /> Share</Button>
            )}
            <Button variant="secondary" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /> Copy</Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button type="button" disabled={busy} onClick={() => window.confirm('Make a new link? The old one will stop working.') && change(true)} className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-ink">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> New link
            </button>
            <button type="button" disabled={busy} onClick={() => change(false)} className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-neg">
              <Link2Off className="h-3.5 w-3.5" aria-hidden="true" /> Turn off
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:px-5">
          <Button disabled={busy} onClick={() => change(true)}>
            <Link2 className="h-4 w-4" aria-hidden="true" /> {busy ? 'Creating…' : 'Create invite link'}
          </Button>
        </div>
      )}
    </Card>
  )
}

function PrivacyCard() {
  const { account, isOwner, actions } = useSavings()
  if (!isOwner) {
    return (
      <Card className="p-4 text-sm text-muted">
        {account.membersSeeAll
          ? 'Everyone in this account can see all transactions and balances.'
          : "Members see only their own transactions and the account total. The owner sees everyone's."}
      </Card>
    )
  }
  return (
    <Card className="p-4">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-semibold">Members see everyone's money</span>
          <span className="mt-0.5 block text-xs text-muted">
            {account.membersSeeAll
              ? 'On: every member sees all transactions and each balance.'
              : 'Off: members see only their own, plus the account total. You always see everything.'}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={account.membersSeeAll}
          onChange={(e) => actions.setMembersSeeAll(e.target.checked)}
          className="mt-1 h-5 w-9 flex-shrink-0 cursor-pointer appearance-none rounded-full bg-line transition before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition checked:bg-brand checked:before:translate-x-[1.1rem]"
        />
      </label>
    </Card>
  )
}

function MemberList() {
  const { account, allTransactions, me, isOwner, actions } = useSavings()

  const remove = (m) => {
    const count = allTransactions.filter(t => t.memberId === m.id).length
    const what = count ? ` Their ${count} transaction${count === 1 ? '' : 's'} will be deleted too.` : ''
    if (window.confirm(`Remove ${m.name} from ${account.name}?${what}`)) actions.removeMember(m.id)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Members" subtitle={`${account.members.length} in ${account.name}`} className="pb-2" />
      <ul className="divide-y divide-line">
        {account.members.map(m => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <Avatar member={m} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{m.id === me ? `You (${m.name})` : m.name}</span>
              <span className="block text-xs text-muted">{m.role === 'owner' ? 'Owner' : 'Member'}</span>
            </span>
            {isOwner && m.role !== 'owner' && (
              <button type="button" onClick={() => remove(m)} aria-label={`Remove ${m.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-neg-soft hover:text-neg">
                <UserMinus className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function SharingSettings() {
  const { user } = useAuth()
  const { account, isOwner, actions } = useSavings()

  if (!user || !account.cloud) {
    return (
      <SettingsPanel title="Sharing" description="Save together with friends in one account. Each person earns their own interest.">
        <Card className="p-4 text-sm">
          <p className="text-muted">Sign in first, so your accounts are online where friends can join them.</p>
          <Link to="/settings/profile" className="mt-3 inline-block font-semibold text-brand-ink hover:underline">Go to Profile to sign in →</Link>
        </Card>
      </SettingsPanel>
    )
  }

  const leave = () => {
    if (window.confirm(`Leave ${account.name}? Your transactions in it will be deleted.`)) actions.leaveAccount()
  }

  return (
    <SettingsPanel
      title="Sharing"
      description={`Who saves in ${account.name}. Each person earns interest on their own money.`}
    >
      {isOwner && <InviteCard />}
      <PrivacyCard />
      <MemberList />
      {!isOwner && (
        <Card className="overflow-hidden">
          <SettingsRow icon={DoorOpen} tone="danger" label="Leave this account" description="Your transactions in it are deleted" onClick={leave} />
        </Card>
      )}
    </SettingsPanel>
  )
}
