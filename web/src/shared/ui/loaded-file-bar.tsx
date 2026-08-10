import { type JSX, type ReactNode, useRef } from 'react';
import { Button } from './button.js';
import { IconFileText } from './icons.js';

/**
 * The resting state after a file is chosen: its name, a Change (re-pick) affordance, Clear, and any
 * tool-specific actions on the right. Shared by the PDF tools so the loaded header is identical.
 */
export function LoadedFileBar({
  name,
  accept,
  onFile,
  onClear,
  actions,
}: {
  name: string;
  accept: string;
  onFile: (file: File) => void;
  onClear: () => void;
  actions?: ReactNode;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <IconFileText />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
      {actions}
      <Button variant="ghost" size="xs" onClick={() => inputRef.current?.click()}>Change</Button>
      <Button variant="ghost" size="xs" onClick={onClear}>Clear</Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
