import { type JSX, useRef, useState } from 'react';
import { InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { IconSigma } from '../ui/index.js';
import { MathEquationEditor } from './math-equation-editor.js';

type Part = { type: 'text' | 'latex'; value: string };

/** Split text into plain runs and inline-LaTeX runs delimited by `\( ... \)`. */
function toParts(text: string): Part[] {
  const parts: Part[] = [];
  let current = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('\\(', i)) {
      const end = text.indexOf('\\)', i + 2);
      if (end !== -1) {
        if (current) {
          parts.push({ type: 'text', value: current });
          current = '';
        }
        parts.push({ type: 'latex', value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    current += text[i] ?? '';
    i += 1;
  }
  if (current) parts.push({ type: 'text', value: current });
  return parts;
}

/**
 * Render text that mixes prose and inline `\( ... \)` LaTeX into real math via KaTeX — so the verify
 * screen shows the rendered view, not the raw source. Ported from question-editor's latex-render.
 * Malformed LaTeX falls back to showing the raw run rather than crashing.
 */
export function RenderLatex({ text }: { text: string }): JSX.Element {
  const parts = toParts(text);
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'latex' ? (
          <SafeMath key={index} value={part.value} />
        ) : (
          <span key={index}>
            {part.value.split('\n').map((line, lineIndex, lines) => (
              <span key={lineIndex}>
                {line}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </span>
        ),
      )}
    </>
  );
}

function SafeMath({ value }: { value: string }): JSX.Element {
  try {
    return <InlineMath math={value} />;
  } catch {
    return <span>\({value}\)</span>;
  }
}

/**
 * The one editable LaTeX field: shows the value RENDERED by default (never raw source), switches
 * to a raw input on click, and renders again on blur. Every LaTeX-bearing field in the app edits
 * through this so no screen ever shows raw `\(...\)` in its resting view.
 */
export function EditableLatexValue({
  value,
  onChange,
  multiline = false,
  placeholder = 'Click to edit',
}: {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  // The equation dialog steals focus from the field (firing its blur), so guard the blur-to-collapse
  // with a ref set synchronously when the dialog opens — otherwise the field would unmount mid-insert.
  const mathOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const setInputRef = (el: HTMLInputElement | HTMLTextAreaElement | null): void => { inputRef.current = el; };
  // Where an inserted equation should land: the field's caret, captured before the dialog takes focus.
  const caretRef = useRef(value.length);

  const captureCaret = (): void => {
    const el = inputRef.current;
    caretRef.current = el?.selectionStart ?? value.length;
  };

  const openMath = (): void => { mathOpenRef.current = true; setMathOpen(true); };
  const closeMath = (): void => {
    mathOpenRef.current = false;
    setMathOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(caretRef.current, caretRef.current); }
    });
  };

  // Splice `\( latex \)` into the field at the captured caret, then keep editing with the caret after it.
  const insertEquation = (latex: string): void => {
    const pos = Math.min(caretRef.current, value.length);
    const snippet = `\\(${latex}\\)`;
    onChange(value.slice(0, pos) + snippet + value.slice(pos));
    const caret = pos + snippet.length;
    caretRef.current = caret;
    mathOpenRef.current = false;
    setMathOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    });
  };

  if (editing) {
    const common = {
      autoFocus: true,
      value,
      onChange: (e: { target: { value: string } }) => { onChange(e.target.value); },
      onBlur: () => { if (!mathOpenRef.current) setEditing(false); },
      onSelect: captureCaret,
      onKeyUp: captureCaret,
    };
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          <button
            type="button"
            title="Insert an equation"
            aria-label="Insert an equation"
            className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink [&>svg]:size-3.5"
            // preventDefault keeps the field focused (so its caret survives) when the button is pressed.
            onMouseDown={(e) => { e.preventDefault(); captureCaret(); }}
            onClick={openMath}
          >
            <IconSigma /> Equation
          </button>
        </div>
        {multiline ? (
          <textarea ref={setInputRef} rows={3} {...common} />
        ) : (
          <input ref={setInputRef} type="text" {...common} />
        )}
        {mathOpen ? (
          <MathEquationEditor initial="" onInsert={insertEquation} onClose={closeMath} />
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="min-h-[38px] cursor-text rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed transition-colors hover:border-line-strong hover:bg-surface-2"
      title="Click to edit raw"
      onClick={() => { setEditing(true); }}
    >
      {value.trim() ? <RenderLatex text={value} /> : <span className="text-ink-3">{placeholder}</span>}
    </div>
  );
}
