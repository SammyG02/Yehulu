import { useRef, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { toDateKey } from '../../lib/dates.js'
import { exportState, parseBackup } from '../../lib/storage.js'
import { useSavings } from '../../state/hooks.js'

export default function DataSettings() {
  const { data, actions } = useSavings()
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
      if (window.confirm(`Replace everything with this backup (${countIn(next)})? Your current data will be lost.`)) {
        actions.replaceAll(next)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteAll = () => {
    if (window.confirm('Delete every account with its transactions, goal and settings? This cannot be undone. Back up first if unsure.')) {
      actions.reset()
    }
  }

  return (
    <SettingsPanel title="Data" description={`${countIn(data)}, stored only on this device.`}>
      <Card className="overflow-hidden">
        <div className="divide-y divide-line">
          <SettingsRow icon={Download} label="Back up" description="Download a copy as a file" onClick={backUp} />
          <SettingsRow icon={Upload} label="Restore" description="Replace everything with a backup file" onClick={() => fileRef.current?.click()} />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={restore} className="hidden" />
      </Card>
      {error && <p role="alert" className="px-1 text-sm text-neg">{error}</p>}
      <Card className="overflow-hidden">
        <SettingsRow icon={Trash2} tone="danger" label="Delete all data" description="Every account, its transactions, goal and settings" onClick={deleteAll} />
      </Card>
    </SettingsPanel>
  )
}
