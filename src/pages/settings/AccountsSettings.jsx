import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { NewAccountForm } from '../../components/accounts/AccountSwitcher.jsx'
import { accountKind, accountKindText } from '../../components/accounts/accountKind.js'
import { AccountTabs } from '../../components/settings/AccountTabs.jsx'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { inputClass } from '../../components/ui/Field.jsx'
import { formatMoney } from '../../lib/format.js'
import { periodOn } from '../../lib/interest.js'
import { useAccountBalances, useAccountTotals, useConfirm, useSavings } from '../../state/hooks.js'

function RenameForm({ account, onDone }) {
  const { accounts, actions } = useSavings()
  const [name, setName] = useState(account.name)
  const trimmed = name.trim().slice(0, 40)
  const taken = accounts.some(a => a.id !== account.id && a.name.toLowerCase() === trimmed.toLowerCase())
  const canSave = trimmed !== '' && trimmed !== account.name && !taken

  return (
    <form
      noValidate
      className="space-y-1.5 px-4 py-3"
      onSubmit={(e) => { e.preventDefault(); if (canSave) { actions.renameAccount(trimmed, account.id); onDone() } }}
    >
      <label htmlFor={`rename-${account.id}`} className="sr-only">Account name</label>
      <div className="flex gap-2">
        <input id={`rename-${account.id}`} type="text" maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!canSave}>Save</Button>
      </div>
      {taken && <p className="text-sm text-neg" role="alert">You already have an account with this name.</p>}
    </form>
  )
}

function AccountRow({ account, isActive, balance, total, onRename, onlyOne }) {
  const { today, actions } = useSavings()
  const confirm = useConfirm()
  const count = account.transactions.length
  const kindText = accountKindText(accountKind(account))
  // In a friend's shared account only the owner renames or deletes it.
  const mayManage = !account.cloud || account.role === 'owner'

  const remove = async () => {
    const others = account.members?.length > 1
      ? ` Its ${account.members.length - 1} other member${account.members.length === 2 ? '' : 's'} lose it too.`
      : ''
    const txns = count ? `Its ${count} transaction${count === 1 ? '' : 's'} will be deleted.` : 'It has no transactions.'
    if (await confirm({
      title: `Delete ${account.name}?`,
      message: `${txns}${others} This cannot be undone.`,
      confirmLabel: 'Delete account',
      danger: true,
    })) actions.deleteAccount(account.id)
  }

  return (
    <div className={`flex items-center gap-2 pr-2 ${isActive ? 'bg-brand-soft' : ''}`}>
      <button
        type="button"
        onClick={() => actions.switchAccount(account.id)}
        aria-current={isActive ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${isActive ? 'text-brand-ink' : ''}`}>
            {account.name}
            {isActive && <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-brand">Open</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {kindText && <span className="font-semibold text-accent">{kindText} · </span>}
            {periodOn(account.rates, today).annualRate}% a year · {count} transaction{count === 1 ? '' : 's'}
          </span>
        </span>
        {total != null ? (
          <span className="text-right">
            <span className="block text-sm font-bold tabular-nums">{formatMoney(total)}</span>
            <span className="block text-[11px] tabular-nums text-muted">You: {formatMoney(balance)}</span>
          </span>
        ) : (
          <span className="text-sm font-bold tabular-nums">{formatMoney(balance)}</span>
        )}
      </button>
      {mayManage && (<>
      <button type="button" onClick={onRename} aria-label={`Rename ${account.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink">
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={onlyOne}
        aria-label={`Delete ${account.name}`}
        title={onlyOne ? 'You need at least one account' : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-neg-soft hover:text-neg disabled:pointer-events-none disabled:opacity-30"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      </>)}
    </div>
  )
}

export default function AccountsSettings() {
  const { accounts, account: active } = useSavings()
  const balances = useAccountBalances()
  const totals = useAccountTotals()
  const [renaming, setRenaming] = useState(null)
  const [adding, setAdding] = useState(false)

  return (
    <SettingsPanel
      title="Accounts"
      description="Each account has its own rate, transactions and goal. Tap one to open it."
    >
      <AccountTabs />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {accounts.map(a => (
            <li key={a.id}>
              {renaming === a.id
                ? <RenameForm account={a} onDone={() => setRenaming(null)} />
                : (
                  <AccountRow
                    account={a}
                    isActive={a.id === active.id}
                    balance={balances.get(a.id) ?? 0}
                    total={totals.get(a.id)}
                    onRename={() => setRenaming(a.id)}
                    onlyOne={accounts.length === 1}
                  />
                )}
            </li>
          ))}
        </ul>
      </Card>

      {adding ? (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-bold">New account</h3>
          <NewAccountForm onCreated={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add account
        </Button>
      )}
    </SettingsPanel>
  )
}
