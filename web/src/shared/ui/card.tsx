import type { HTMLAttributes, JSX } from 'react';
import { cn } from '../lib/cn.js';

/** The one surface container: a bordered, soft-shadowed panel. Compose content as children. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm', className)}
      {...rest}
    />
  );
}
