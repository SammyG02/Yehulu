import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { dismiss, installMethod, onInstallChange, promptInstall, wasDismissed } from '../lib/install.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'

/**
 * "Install Yehulu" for people using it in the browser: one tap on Android,
 * the Share > Add to Home Screen steps on iPhone. Hidden once installed, in
 * the downloadable app, or for 30 days after closing it (unless `always`).
 */
export function InstallBanner({ always = false }) {
  const [method, setMethod] = useState(installMethod)
  const [hidden, setHidden] = useState(() => !always && wasDismissed())
  useEffect(() => onInstallChange(() => setMethod(installMethod())), [])
  if (!method || hidden) return null

  const close = () => { dismiss(); setHidden(true) }

  return (
    <Card className="relative p-4 pr-10 sm:p-5 sm:pr-12">
      {!always && (
        <button type="button" onClick={close} aria-label="Not now" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <Download className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-bold">Install Yehulu</p>
          {method === 'prompt' ? (
            <>
              <p className="text-muted">Add it to your home screen: opens like an app, full screen, always up to date.</p>
              <Button size="sm" className="mt-3" onClick={() => promptInstall()}>Install</Button>
            </>
          ) : (
            <>
              <p className="text-muted">Add it to your home screen to open it like an app:</p>
              <ol className="mt-2 space-y-1.5">
                <li className="flex items-center gap-2">
                  <span className="font-semibold">1.</span> Tap <Share className="h-4 w-4 text-brand-ink" aria-label="Share" /> <span className="font-semibold">Share</span> in Safari's toolbar
                </li>
                <li className="flex items-center gap-2">
                  <span className="font-semibold">2.</span> Tap <SquarePlus className="h-4 w-4 text-brand-ink" aria-hidden="true" /> <span className="font-semibold">Add to Home Screen</span>
                </li>
              </ol>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
