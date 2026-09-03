import { type JSX, useRef, useState } from 'react';
import { Button, IconPlus, Spinner, useToast } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';

/**
 * A field-agnostic "attach image" affordance: pick an image file, upload it to the question's image
 * bucket, and hand back its public URL. Used for fields that carry a figure but aren't cropped off the
 * page — the explanation and match-the-column entries — so any field can gain an image without touching
 * the canvas crop pipeline.
 */
export function AttachImageButton({
  questionId,
  label = 'Attach image',
  disabled = false,
  onUploaded,
}: {
  questionId: string;
  label?: string;
  disabled?: boolean;
  onUploaded: (url: string) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { error } = useToast();

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await questionsApi.uploadImage(questionId, `attach_${String(Date.now())}`, file);
      onUploaded(url);
    } catch (caught) {
      error('Could not attach image', caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleFile(file);
        }}
      />
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled || uploading}
        onClick={() => { inputRef.current?.click(); }}
      >
        {uploading ? <><Spinner /> Uploading…</> : <><IconPlus /> {label}</>}
      </Button>
    </>
  );
}
