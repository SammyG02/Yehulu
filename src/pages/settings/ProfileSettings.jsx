import { useState } from 'react'
import { CloudUpload, LogOut } from 'lucide-react'
import { Avatar } from '../../components/accounts/MembersCard.jsx'
import { GoogleButton } from '../../components/auth/GoogleButton.jsx'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { useAuth, useSavings } from '../../state/hooks.js'

export default function ProfileSettings() {
  const { enabled, user, signOut } = useAuth()
  const { localData, localUploaded, actions } = useSavings()
  const [uploading, setUploading] = useState(false)
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

  const upload = async () => {
    if (!window.confirm(`Copy the ${localCount} transaction${localCount === 1 ? '' : 's'} saved on this device into new online accounts?`)) return
    setUploading(true)
    try { await actions.uploadLocal() } finally { setUploading(false) }
  }

  return (
    <SettingsPanel title="Profile" description="Your accounts are saved online and can be shared.">
      <Card className="flex items-center gap-3 p-4">
        <Avatar member={{ name: user.name || '?', avatarUrl: user.avatarUrl }} className="h-12 w-12" />
        <span className="min-w-0">
          <span className="block truncate font-bold">{user.name}</span>
          <span className="block truncate text-sm text-muted">{user.email}</span>
        </span>
      </Card>
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
          <SettingsRow icon={LogOut} label="Sign out" description="Your online accounts stay safe" onClick={signOut} />
        </div>
      </Card>
    </SettingsPanel>
  )
}
