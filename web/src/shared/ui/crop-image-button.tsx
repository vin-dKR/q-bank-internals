import { type JSX, useState } from 'react';
import { Button } from './button.js';
import { IconScissors } from './icons.js';
import { Spinner } from './spinner.js';

/**
 * A field-agnostic "crop image from the page" affordance for fields that carry a figure cropped off a
 * source page — the explanation (from the solution PDF) and match-the-column entries (from the question
 * PDF). Clicking it asks the workspace to arm a rubber-band crop (via `onRequestCrop`, which resolves
 * with the uploaded image URL once the operator draws a box, or `null` if they cancel or it's
 * superseded); a returned URL is handed to `onCropped`. Shared (§ feature-slicing: shared/ui) because
 * both the verify card and the match-table editor use it.
 */
export function CropImageButton({
  label = 'Crop image',
  disabled = false,
  onRequestCrop,
  onCropped,
}: {
  label?: string;
  disabled?: boolean;
  /** Arm a crop and resolve with the uploaded image URL, or `null` when cancelled/superseded. */
  onRequestCrop: () => Promise<string | null>;
  onCropped: (url: string) => void;
}): JSX.Element {
  const [pending, setPending] = useState(false);

  const run = async (): Promise<void> => {
    setPending(true);
    try {
      const url = await onRequestCrop();
      if (url) onCropped(url);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button size="xs" variant="ghost" disabled={disabled || pending} onClick={() => { void run(); }}>
      {pending ? <><Spinner /> Draw on the page…</> : <><IconScissors /> {label}</>}
    </Button>
  );
}
