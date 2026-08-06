import type { ButtonHTMLAttributes, JSX } from 'react';
import { cn } from '../lib/cn.js';

type Variant = 'default' | 'primary' | 'ghost' | 'danger';
type Size = 'md' | 'xs' | 'block';

type ButtonProps = {
  variant?: Variant;
  size?: Size;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium no-underline transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 [&>svg]:size-4 [&>svg]:shrink-0';

const VARIANTS: Record<Variant, string> = {
  default: 'border-line-strong bg-surface text-ink hover:bg-surface-2',
  primary: 'border-brand bg-brand text-white hover:bg-brand-hover',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border-red-200 bg-bad-soft text-bad hover:bg-red-100',
};

const SIZES: Record<Size, string> = {
  md: 'px-3.5 py-2 text-sm',
  xs: 'px-2.5 py-1 text-xs',
  block: 'w-full px-3.5 py-2.5 text-[15px]',
};

/** The button class string — for `<Link>`/`<a>` that should look like a button without being one. */
export function buttonClasses(variant: Variant = 'default', size: Size = 'md', className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

/** The one button. Variant sets weight/colour; size sets padding. Compose icons as `<svg>` children. */
export function Button({
  variant = 'default',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps): JSX.Element {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}
