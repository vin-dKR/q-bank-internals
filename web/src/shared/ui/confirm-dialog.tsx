import { type JSX, type ReactNode, useCallback, useEffect, useState } from 'react';

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
};

type PendingConfirm = {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
};

function ConfirmDialog({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onResolve(false);
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [onResolve]);

  const tone = options.tone ?? 'primary';
  return (
    <div className="modal" onMouseDown={() => { onResolve(false); }}>
      <div
        className="modal__panel modal__panel--sm"
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title}
        onMouseDown={(event) => { event.stopPropagation(); }}
      >
        <h2>{options.title}</h2>
        {options.body ? <div className="muted">{options.body}</div> : null}
        <div className="modal__foot">
          <button type="button" className="btn" onClick={() => { onResolve(false); }}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            autoFocus
            onClick={() => { onResolve(true); }}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based confirmation — the one replacement for `window.confirm`. Returns `[confirm, dialog]`:
 * call `await confirm({ title, tone: 'danger', … })` and render `{dialog}` once in the component tree.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, JSX.Element | null] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => { setPending({ options, resolve }); }),
    [],
  );

  const resolve = useCallback(
    (confirmed: boolean): void => {
      setPending((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  const dialog = pending ? (
    <ConfirmDialog options={pending.options} onResolve={resolve} />
  ) : null;

  return [confirm, dialog];
}
