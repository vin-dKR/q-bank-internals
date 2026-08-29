import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { Button, IconButton, IconSearch, IconX } from '../ui/index.js';
import { CARET, type MathCategory, MATH_CATEGORIES, type MathSymbol, filterMathSymbols } from './math-symbols.js';

/** Render one LaTeX preview, falling back to the raw source when it is incomplete/invalid. */
function Preview({ latex }: { latex: string }): JSX.Element {
  if (!latex.trim()) return <span className="text-ink-3">Your equation preview appears here</span>;
  try {
    return <InlineMath math={latex} />;
  } catch {
    return <span className="font-mono text-xs text-ink-3">\({latex}\)</span>;
  }
}

/**
 * A Word-style "insert equation" dialog: compose LaTeX in a builder box (type or paste it directly),
 * or search a catalogue of symbols/templates (e.g. type "integration" to find the integral) and click
 * one to drop its LaTeX at the cursor. A live KaTeX preview shows the result. "Insert" hands the raw
 * LaTeX back to the caller, which wraps it in `\(...\)` at the field's caret.
 *
 * Deliberately data-driven (see math-symbols) rather than a WYSIWYG math engine, so it stays light and
 * always emits ordinary LaTeX the app already renders.
 */
export function MathEquationEditor({
  initial = '',
  onInsert,
  onClose,
}: {
  initial?: string;
  onInsert: (latex: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [latex, setLatex] = useState(initial);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MathCategory | 'All'>('All');
  const builderRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const results = useMemo(() => {
    const byQuery = filterMathSymbols(query);
    return category === 'All' ? byQuery : byQuery.filter((s) => s.category === category);
  }, [query, category]);

  // Drop a snippet at the builder's caret, stripping the `‸` marker and leaving the caret where it was.
  const insertSnippet = (snippet: string): void => {
    const el = builderRef.current;
    const start = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? latex.length;
    const caretInSnippet = snippet.indexOf(CARET);
    const clean = snippet.replace(CARET, '');
    const next = latex.slice(0, start) + clean + latex.slice(end);
    setLatex(next);
    const caret = start + (caretInSnippet >= 0 ? caretInSnippet : clean.length);
    requestAnimationFrame(() => {
      const box = builderRef.current;
      if (box) { box.focus(); box.setSelectionRange(caret, caret); }
    });
  };

  const commit = (): void => {
    const trimmed = latex.trim();
    if (trimmed) onInsert(trimmed);
    else onClose();
  };

  return (
    <div className="modal" onMouseDown={onClose}>
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Insert equation"
        onMouseDown={(e) => { e.stopPropagation(); }}
      >
        <div className="modal__head">
          <h2>Insert equation</h2>
          <IconButton icon={<IconX />} label="Close" size="sm" onClick={onClose} />
        </div>

        {/* Builder — type/paste LaTeX directly, or fill it from the palette below. */}
        <textarea
          ref={builderRef}
          autoFocus
          rows={2}
          value={latex}
          onChange={(e) => { setLatex(e.target.value); }}
          placeholder="Type LaTeX, or pick symbols below — e.g. \\frac{1}{2} or \\int_{0}^{1}"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm"
        />
        <div className="min-h-[44px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base leading-relaxed">
          <Preview latex={latex} />
        </div>

        {/* Search + category filter over the symbol catalogue. */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <IconSearch />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search symbols — e.g. integration, fraction, theta, matrix…"
            className="w-full border-0 bg-transparent p-0 text-sm outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['All', ...MATH_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => { setCategory(cat); }}
              className={[
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                category === cat ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2 hover:bg-surface-2',
              ].join(' ')}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid max-h-[38vh] gap-1.5 overflow-auto [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))]">
          {results.map((symbol: MathSymbol) => (
            <button
              key={`${symbol.category}:${symbol.name}`}
              type="button"
              title={`${symbol.name} — ${symbol.insert.replace(CARET, '')}`}
              onClick={() => { insertSnippet(symbol.insert); }}
              className="flex flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface px-2 py-2 text-center transition-colors hover:border-brand hover:bg-surface-2"
            >
              <span className="text-base leading-none"><Preview latex={symbol.preview} /></span>
              <span className="truncate text-[11px] text-ink-3">{symbol.name}</span>
            </button>
          ))}
          {results.length === 0 ? (
            <span className="col-span-full py-4 text-center text-sm text-ink-3">No symbols match “{query}”.</span>
          ) : null}
        </div>

        <div className="modal__foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={commit}>Insert equation</Button>
        </div>
      </div>
    </div>
  );
}
