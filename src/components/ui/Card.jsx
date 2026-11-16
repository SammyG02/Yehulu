export function Card({ as: Tag = 'section', className = '', children, ...props }) {
  return (
    <Tag className={`rounded-2xl border border-line bg-surface shadow-card ${className}`} {...props}>
      {children}
    </Tag>
  )
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
