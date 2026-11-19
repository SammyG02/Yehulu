import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useSavings } from '../../state/hooks.js'
import { TransactionComposer } from '../transactions/TransactionComposer.jsx'
import { BottomNav } from './BottomNav.jsx'
import { CloudGate } from './CloudGate.jsx'
import { PullToRefresh } from './PullToRefresh.jsx'
import { TopBar } from './TopBar.jsx'

function Toast() {
  const { toast, actions } = useSavings()
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-8">
      <div
        key={toast.id}
        role="status"
        className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-center justify-between gap-4 rounded-2xl bg-[#0b0f0d] px-4 py-3 text-sm text-white shadow-float ring-1 ring-white/10"
      >
        <span className="font-medium">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => { toast.action.onClick(); actions.dismissToast() }}
            className="font-bold text-brand hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

export function AppShell() {
  const { cloudStatus, cloudMode, actions } = useSavings()
  // Signed in: fetch the latest from everyone. Signed out there's nothing
  // online to fetch, so reload the page (which also picks up app updates).
  const refresh = async () => {
    if (!cloudMode) return window.location.reload()
    const ok = await actions.reload()
    actions.showToast(ok ? 'Up to date' : "Couldn't refresh. Check your connection.")
  }
  const { pathname, hash } = useLocation()
  // New page: start at the top, or at #section if the link asks for one.
  useEffect(() => {
    const target = hash && document.getElementById(hash.slice(1))
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  if (['loading', 'error', 'empty'].includes(cloudStatus)) {
    return (
      <>
        <CloudGate />
        <Toast />
      </>
    )
  }

  return (
    <div className="min-h-[100dvh]">
      <TopBar />
      <PullToRefresh onRefresh={refresh} />
      <main className="mx-auto max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 md:pb-12 md:pt-8">
        <Outlet />
      </main>
      <BottomNav />
      <TransactionComposer />
      <Toast />
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 md:mb-6">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold text-muted">{eyebrow}</p>}
        <h1 className="truncate text-xl font-extrabold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
