import type { JSX, ReactNode } from 'react';
import { IconInfo } from './icons.js';
import { ToolbarHelp } from './toolbar.js';

/** Reuse the help popover so explanations stay available without occupying the workbench. */
export function InfoButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <ToolbarHelp label={label} icon={<IconInfo />} width={360}>
      {children}
    </ToolbarHelp>
  );
}
