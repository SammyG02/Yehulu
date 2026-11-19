import { Link } from 'react-router'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Yehulu home">
      <svg viewBox="0 0 32 32" className="h-9 w-9 flex-shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="9" className="fill-brand" />
        <path d="M8 20.5c3.2 0 4.3-6 8-6s4.8 3.5 8-3" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="24" cy="11.5" r="2.2" fill="#fff" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight md:max-lg:hidden">Yehulu</span>
    </Link>
  )
}
