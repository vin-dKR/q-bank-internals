import type { JSX } from 'react';
import { Button, IconScan, Spinner } from '../../../shared/ui/index.js';
import { useQualitySummary, useRunQualityScan } from '../hooks/use-quality.js';

/** Starts a scan of the whole bank. The request runs until the scan finishes, so the button stays busy. */
export function RunScanButton({ variant = 'primary', disabled = false }: { variant?: 'primary' | 'default'; disabled?: boolean }): JSX.Element {
  const scan = useRunQualityScan();
  const summary = useQualitySummary();
  const busy = scan.isPending || summary.data?.lastScan?.status === 'running';
  return (
    <Button className="whitespace-nowrap" variant={variant} disabled={busy || disabled} title={disabled ? 'Stop the AI run before scanning' : undefined} onClick={() => { scan.mutate(); }}>
      {busy ? <Spinner /> : <IconScan />}
      {busy ? 'Scan in progress' : 'Run scan'}
    </Button>
  );
}
