import { type JSX, useState } from 'react';
import type { Exam, Module } from '@ingest/contracts';
import { ExamSchema, ModuleSchema } from '@ingest/contracts';
import { useCreateSession, useSessions } from '../hooks/use-sessions.js';

type SessionPickerProps = {
  value: string | null;
  onChange: (sessionId: string) => void;
};

/**
 * The Phase-1 gate: pick the session an upload belongs to, or open a new one inline. Selecting a
 * session is required before any chapter can be uploaded, so every file lands under a durable run.
 */
export function SessionPicker({ value, onChange }: SessionPickerProps): JSX.Element {
  const { data, isPending, isError } = useSessions();
  const create = useCreateSession();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [exam, setExam] = useState<Exam | ''>('');
  const [subject, setSubject] = useState('');
  const [module, setModule] = useState<Module | ''>('');

  const canCreate = label.trim() !== '' && exam !== '' && subject.trim() !== '' && module !== '';

  const submit = async (): Promise<void> => {
    if (!canCreate) return; // narrows exam → Exam and module → Module (aliased-condition analysis)
    const session = await create.mutateAsync({
      label: label.trim(),
      exam,
      subject: subject.trim(),
      module,
      autoRun: false,
    });
    onChange(session.id);
    setCreating(false);
    setLabel('');
    setExam('');
    setSubject('');
    setModule('');
  };

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Session</span>
        {isPending ? (
          <p className="muted">Loading sessions…</p>
        ) : isError ? (
          <p className="error">Could not reach the API. Is it running on :4000?</p>
        ) : (
          <select value={value ?? ''} onChange={(event) => { onChange(event.target.value); }}>
            <option value="" disabled>
              Select a session…
            </option>
            {data.items.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label} — {session.exam} › {session.subject} › {session.module} [
                {session.status}, {session.extractedCount}/{session.documentCount}]
              </option>
            ))}
          </select>
        )}
      </label>

      {creating ? (
        <div className="stack session-create">
          <input
            type="text"
            placeholder="Label (e.g. Allen Kinematics — Aug batch)"
            value={label}
            onChange={(event) => { setLabel(event.target.value); }}
          />
          <div className="row">
            <select value={exam} onChange={(event) => { setExam(event.target.value as Exam); }}>
              <option value="" disabled>
                Exam…
              </option>
              {ExamSchema.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={(event) => { setSubject(event.target.value); }}
            />
            <select value={module} onChange={(event) => { setModule(event.target.value as Module); }}>
              <option value="" disabled>
                Module…
              </option>
              {ModuleSchema.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canCreate || create.isPending}
              onClick={() => { void submit(); }}
            >
              {create.isPending ? 'Creating…' : 'Create session'}
            </button>
            <button type="button" className="btn" onClick={() => { setCreating(false); }}>
              Cancel
            </button>
          </div>
          {create.isError ? <p className="error">{create.error.message}</p> : null}
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => { setCreating(true); }}>
          ＋ New session
        </button>
      )}
    </div>
  );
}
