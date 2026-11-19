import { useRef, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { toDateKey } from '../../lib/dates.js'
import { exportState, parseBackup } from '../../lib/storage.js'
import { useConfirm, useSavings } from '../../state/hooks.js'

export default function DataSettings() {
  const { data, cloudMode, actions } = useSavings()
  const confirm = useConfirm()
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const countIn = (state) => {
    const n = state.accounts.reduce((sum, a) => sum + a.transactions.length, 0)
    const accounts = state.accounts.length
    return `${accounts} account${accounts === 1 ? '' : 's'}, ${n} transaction${n === 1 ? '' : 's'}`
  }

  const backUp = () => {
    const blob = new Blob([exportState(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `yehulu-backup-${toDateKey(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)
    actions.showToast('Backup downloaded')
  }

  const restore = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const next = parseBackup(await file.text())
      setError(null)
      if (await confirm({
        title: 'Restore this backup?',
        message: `It has ${countIn(next)}. Everything on this device now will be replaced.`,
        confirmLabel: 'Replace everything',
        danger: true,
      })) actions.replaceAll(next)
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteAll = async () => {
    if (await confirm({
      title: 'Delete all data?',
      message: 'Every account with its transactions, goal and settings is deleted from this device. This cannot be undone, so back up first if unsure.',
      confirmLabel: 'Delete everything',
      danger: true,
    })) actions.reset()
  }

  return (
    <SettingsPanel
      title="Data"
      description={cloudMode ? `${countIn(data)}, saved online in your profile.` : `${countIn(data)}, stored only on this device.`}
    >
      <Card className="overflow-hidden">
        <div className="divide-y divide-line">
          <SettingsRow icon={Download} label="Back up" description="Download a copy as a file" onClick={backUp} />
          {!cloudMode && (
            <SettingsRow icon={Upload} label="Restore" description="Replace everything with a backup file" onClick={() => fileRef.current?.click()} />
          )}
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={restore} className="hidden" />
      </Card>
      {error && <p role="alert" className="px-1 text-sm text-neg">{error}</p>}
      {cloudMode ? (
        <p className="px-1 text-xs text-muted">Restoring a backup or deleting everything works on device data, after you sign out. Delete online accounts one by one in Accounts.</p>
      ) : (
        <Card className="overflow-hidden">
          <SettingsRow icon={Trash2} tone="danger" label="Delete all data" description="Every account, its transactions, goal and settings" onClick={deleteAll} />
        </Card>
      )}
    </SettingsPanel>
  )
}
