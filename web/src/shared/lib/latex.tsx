import { type JSX, useState } from 'react';
import { InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';

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
  if (editing) {
    const common = {
      autoFocus: true,
      value,
      onChange: (e: { target: { value: string } }) => { onChange(e.target.value); },
      onBlur: () => { setEditing(false); },
    };
    return multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />;
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
