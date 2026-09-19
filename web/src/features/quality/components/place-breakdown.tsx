import type { JSX } from 'react';
import type { QualitySummary } from '@ingest/contracts';

type Place = { name: string; open: number; questions: number };

/** One row: the place, a bar scaled against the worst place, and its counts. */
function PlaceRow({ place, worst }: { place: Place; worst: number }): JSX.Element {
  const width = worst === 0 ? 0 : Math.round((place.open / worst) * 100);
  return (
    <li className="flex items-center gap-3">
      <span className="w-40 flex-none truncate text-xs text-ink-2" title={place.name}>{place.name}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${String(width)}%` }} />
      </span>
      <span className="w-32 flex-none text-right text-xs tabular-nums text-ink-3">
        <span className="font-medium text-ink">{place.open.toLocaleString()}</span> in {place.questions.toLocaleString()} q
      </span>
    </li>
  );
}

/** Where the open problems are concentrated: by subject, and the worst chapters. Read-only. */
export function PlaceBreakdown({ summary }: { summary: QualitySummary }): JSX.Element {
  const columns: { title: string; places: Place[]; empty: string }[] = [
    { title: 'By subject', places: summary.bySubject, empty: 'No open problems.' },
    { title: 'Worst chapters', places: summary.byChapter, empty: 'No open problems.' },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      {columns.map((column) => {
        const worst = column.places[0]?.open ?? 0;
        return (
          <div key={column.title} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-sm font-semibold text-ink">{column.title}</div>
            {column.places.length === 0 ? (
              <p className="muted">{column.empty}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {column.places.map((place) => <PlaceRow key={place.name} place={place} worst={worst} />)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
