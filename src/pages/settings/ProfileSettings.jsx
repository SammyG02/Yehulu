import { useState } from 'react'
import { CloudUpload, LogOut, Plus } from 'lucide-react'
import { Avatar } from '../../components/accounts/Avatar.jsx'
import { InstallBanner } from '../../components/InstallBanner.jsx'
import { GoogleButton } from '../../components/auth/GoogleButton.jsx'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { useAuth, useConfirm, useSavings } from '../../state/hooks.js'

export default function ProfileSettings() {
  const { enabled, user, signOut, otherAccounts, switchAccount, signInWithGoogle } = useAuth()
  const { localData, localUploaded, actions } = useSavings()
  const confirm = useConfirm()
  const [uploading, setUploading] = useState(false)
  const [switching, setSwitching] = useState(null)

  const openAccount = async (id) => {
    setSwitching(id)
    try { await switchAccount(id) } catch (err) { actions.showToast(err.message) } finally { setSwitching(null) }
  }
  const others = otherAccounts.length > 0 && (
    <Card className="overflow-hidden">
      <h3 className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted">{user ? 'Switch to' : 'Continue as'}</h3>
      <ul className="divide-y divide-line">
        {otherAccounts.map(a => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => openAccount(a.id)}
              disabled={switching !== null}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sunken/70 disabled:opacity-60"
            >
              <Avatar member={{ name: a.name || '?', avatarUrl: a.avatarUrl }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                <span className="block truncate text-xs text-muted">{switching === a.id ? 'Opening…' : a.email}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
  const localCount = localData.accounts.reduce((n, a) => n + a.transactions.length, 0)

  if (!enabled) {
    return (
      <SettingsPanel title="Profile" description="Sign-in isn't set up for this version of the app.">
        <Card className="p-4 text-sm text-muted">Everything is saved on this device.</Card>
      </SettingsPanel>
    )
  }

  if (!user) {
    return (
      <SettingsPanel title="Profile" description="Sign in to keep your accounts online and share them with friends.">
      <InstallBanner always />
        {others}
        <Card className="space-y-4 p-4">
          <ul className="space-y-1.5 text-sm text-muted">
            <li>• Your accounts are saved online, so they're safe if you lose your phone.</li>
            <li>• Open them on any device by signing in.</li>
            <li>• Invite friends to save in the same account. Each person earns their own interest.</li>
          </ul>
          <GoogleButton returnTo="/settings/profile" />
          <p className="text-xs text-muted">
            The first time you sign in, the accounts on this device are copied to your profile. Without signing in,
            everything stays on this device.
          </p>
        </Card>
      </SettingsPanel>
    )
  }

  const askSignOut = async () => {
    if (await confirm({
      title: 'Sign out?',
      message: `Your accounts stay saved online. To see them again, sign in with ${user.email}.`,
      confirmLabel: 'Sign out',
      danger: true,
    })) signOut()
  }

  const upload = async () => {
    if (!(await confirm({
      title: 'Upload from this device?',
      message: `The ${localCount} transaction${localCount === 1 ? '' : 's'} saved on this device are copied into new online accounts.`,
      confirmLabel: 'Upload',
    }))) return
    setUploading(true)
    try { await actions.uploadLocal() } finally { setUploading(false) }
  }

  return (
    <SettingsPanel title="Profile" description="Your accounts are saved online and can be shared.">
      <InstallBanner always />
      <Card className="flex items-center gap-3 p-4">
        <Avatar member={{ name: user.name || '?', avatarUrl: user.avatarUrl }} className="h-12 w-12" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{user.name}</span>
          <span className="block truncate text-sm text-muted">{user.email}</span>
        </span>
        <Button variant="danger" size="sm" onClick={askSignOut} className="flex-shrink-0">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </Button>
      </Card>
      {others}
      <Card className="overflow-hidden">
        <div className="divide-y divide-line">
          {localCount > 0 && !localUploaded && (
            <SettingsRow
              icon={CloudUpload}
              label={uploading ? 'Uploading…' : 'Upload from this device'}
              description={`${localCount} transaction${localCount === 1 ? '' : 's'} saved here before you signed in`}
              onClick={uploading ? undefined : upload}
            />
          )}
          <SettingsRow
            icon={Plus}
            label="Add another Google account"
            description="Switch between them without signing out"
            onClick={() => signInWithGoogle('/settings/profile').catch(err => actions.showToast(err.message))}
          />
        </div>
      </Card>
    </SettingsPanel>
  )
}
