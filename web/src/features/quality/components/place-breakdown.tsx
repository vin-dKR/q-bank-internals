import type { JSX } from 'react';
import type { QualitySummary } from '@ingest/contracts';

type Place = { name: string; open: number; questions: number };

function PlaceList({ title, places }: { title: string; places: Place[] }): JSX.Element {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <h3 className="m-0 mb-2 text-sm font-semibold text-ink">{title}</h3>
      {places.length === 0 ? (
        <p className="m-0 text-sm text-ink-3">No open issues.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {places.map((place) => (
            <li key={place.name} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-[120px] flex-1 truncate text-ink-2" title={place.name}>{place.name}</span>
              <span className="flex-none text-right text-xs tabular-nums text-ink-3">
                <span className="font-semibold text-ink">{place.open.toLocaleString()}</span> issues in {place.questions.toLocaleString()} questions
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Open issues by subject and chapter, with counts kept readable at small widths. */
export function PlaceBreakdown({ summary }: { summary: QualitySummary }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
      <PlaceList title="By subject" places={summary.bySubject} />
      <PlaceList title="Chapters with most issues" places={summary.byChapter} />
    </div>
  );
}
