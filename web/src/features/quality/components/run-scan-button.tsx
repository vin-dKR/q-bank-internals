import type { JSX } from 'react';
import { Button, IconScan, Spinner } from '../../../shared/ui/index.js';
import { useRunQualityScan } from '../hooks/use-quality.js';

/** Starts a scan of the whole bank. The request runs until the scan finishes, so the button stays busy. */
export function RunScanButton({ variant = 'primary' }: { variant?: 'primary' | 'default' }): JSX.Element {
  const scan = useRunQualityScan();
  return (
    <Button variant={variant} disabled={scan.isPending} onClick={() => { scan.mutate(); }}>
      {scan.isPending ? <Spinner /> : <IconScan />}
      {scan.isPending ? 'Scanning the bank…' : 'Run scan'}
    </Button>
  );
}
