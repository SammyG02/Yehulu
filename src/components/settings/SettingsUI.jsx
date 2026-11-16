import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { usePageTitle } from '../../hooks/usePageTitle.js'

/** One settings section. On phones it gets a back link to the Settings list. */
export function SettingsPanel({ title, description, children }) {
  usePageTitle(`${title} · Settings`)
  return (
    <section>
      <Link to="/settings" className="-ml-1 mb-2 inline-flex items-center gap-0.5 text-sm font-semibold text-muted hover:text-ink md:hidden">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Settings
      </Link>
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

/** A compact tappable row: icon, label, short description, optional trailing element. */
export function SettingsRow({ icon: Icon, label, description, onClick, tone = 'default', trailing, ...props }) {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sunken/70"
      {...props}
    >
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${danger ? 'bg-neg-soft text-neg' : 'bg-sunken text-ink'}`}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${danger ? 'text-neg' : ''}`}>{label}</span>
        {description && <span className="block truncate text-xs text-muted">{description}</span>}
      </span>
      {trailing}
    </button>
  )
}
