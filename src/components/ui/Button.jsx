import { Link } from 'react-router'

const VARIANTS = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'border border-line bg-surface text-ink hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-neg-soft text-neg hover:brightness-95',
  link: 'text-brand-ink hover:underline px-0 py-0',
}

const SIZES = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
}

export const buttonClass = ({ variant = 'primary', size = 'md', block = false, className = '' } = {}) =>
  [
    'inline-flex items-center justify-center font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    variant === 'link' ? 'text-sm' : SIZES[size],
    block ? 'w-full' : '',
    className,
  ].join(' ')

export function Button({ variant, size, block, className, type = 'button', ...props }) {
  return <button type={type} className={buttonClass({ variant, size, block, className })} {...props} />
}

export function ButtonLink({ variant, size, block, className, ...props }) {
  return <Link className={buttonClass({ variant, size, block, className })} {...props} />
}
