import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

type IconButtonProps = {
  icon: ReactNode;
  label: string;
  variant?: 'ghost' | 'default' | 'danger';
  size?: 'sm' | 'md';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>;

const BASE =
  'inline-grid place-items-center flex-none rounded-lg border leading-none transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 [&>svg]:size-[1.15em]';

const VARIANTS = {
  default: 'border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border-transparent bg-transparent text-bad hover:bg-bad-soft',
};

const SIZES = {
  sm: 'size-7 text-[13px]',
  md: 'size-9 text-[15px]',
};

/**
 * A square icon-only button — one shape for every icon action so they are pixel-identical and always
 * labelled. `label` is both the tooltip and the accessible name.
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
