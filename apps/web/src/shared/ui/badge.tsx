import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'info' | 'progress' | 'success' | 'review' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  info: 'bg-brand-soft text-brand',
  progress: 'bg-warn-soft text-warn',
  success: 'bg-ok-soft text-ok',
  review: 'bg-[#f3effd] text-[#6941c6]',
  danger: 'bg-bad-soft text-bad',
};

/** A small status pill with a leading dot. One colour language for the whole pipeline. */
export function Badge({
  tone = 'neutral',
  dot = true,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-2 pr-2.5 text-xs font-medium capitalize',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}
