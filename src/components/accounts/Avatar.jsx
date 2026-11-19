/** A member's Google photo, or their first letter. */
export function Avatar({ member, className = 'h-8 w-8' }) {
  if (member.avatarUrl) {
    return <img src={member.avatarUrl} alt="" referrerPolicy="no-referrer" className={`${className} flex-shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${className} flex flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink`} aria-hidden="true">
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  )
}
