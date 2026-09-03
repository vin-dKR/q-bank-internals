import { type JSX, useEffect, useState } from 'react';
import type { PromptDefinition } from '@ingest/contracts';
import { Button, LoadingState } from '../../../shared/ui/index.js';
import { usePrompts, useResetPrompt, useUpdatePrompt } from '../hooks/use-prompts.js';

/** One editable prompt: its text, the placeholders it must keep, and Save / Reset controls. */
function PromptCard({ prompt }: { prompt: PromptDefinition }): JSX.Element {
  const [value, setValue] = useState(prompt.value);
  // Re-sync the draft whenever the server value changes (after a save or reset lands).
  useEffect(() => { setValue(prompt.value); }, [prompt.value]);

  const update = useUpdatePrompt();
  const reset = useResetPrompt();
  const busy = update.isPending || reset.isPending;
  const dirty = value !== prompt.value;

  return (
    <section className="card stack">
      <div className="row justify-between">
        <h2 className="m-0 text-base font-semibold text-ink">{prompt.label}</h2>
        {prompt.overridden ? <span className="badge badge--progress">Modified</span> : null}
      </div>
      <p className="muted">{prompt.description}</p>
      {prompt.tokens.length > 0 ? (
        <p className="text-[13px] text-ink-2">
          Keep these placeholders:{' '}
          {prompt.tokens.map((token, i) => (
            <span key={token}>
              {i > 0 ? ', ' : ''}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-ink">{`{${token}}`}</code>
            </span>
          ))}
        </p>
      ) : null}
      <textarea
        value={value}
        spellCheck={false}
        rows={14}
        className="w-full rounded-lg border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink"
        onChange={(event) => { setValue(event.target.value); }}
      />
      <div className="row items-center">
        <Button
          disabled={!dirty || busy || value.trim().length === 0}
          onClick={() => { update.mutate({ key: prompt.key, value }); }}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={!prompt.overridden || busy}
          onClick={() => { reset.mutate(prompt.key); }}
        >
          Reset to default
        </Button>
        {dirty ? <span className="muted text-sm">Unsaved changes</span> : null}
      </div>
    </section>
  );
}

/** The prompt-settings list: every editable AI prompt with its own editor. */
export function PromptSettings(): JSX.Element {
  const prompts = usePrompts();

  if (prompts.isPending) return <LoadingState label="Loading prompts…" />;
  if (prompts.isError) return <p className="error">Could not load the prompts.</p>;

  return (
    <div className="stack">
      {prompts.data.map((prompt) => (
        <PromptCard key={prompt.key} prompt={prompt} />
      ))}
    </div>
  );
}
