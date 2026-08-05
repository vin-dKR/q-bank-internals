import type { DetectedFigure, Question } from '@ingest/contracts';
import type { DiagramDetection } from './diagram-detector.js';

/** Least overlap between a detection snippet and a stem we'll accept as "the same question". */
const MIN_TEXT_OVERLAP = 0.5;

/**
 * Strip a stem or snippet down to comparable word tokens: drop LaTeX commands and delimiters
 * (`\vec`, `\hat`, `\(`, `{`, `}` …), lowercase, and split on anything non-alphanumeric. This lets a
 * plain-text detector snippet ("If |P| = 20, then P in cartesian form is") match a LaTeX-bearing stem
 * ("If \\( |\\vec{P}| = 20 \\), then \\( \\vec{P} \\) in cartesian form is").
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ') // LaTeX commands: \vec, \hat, \frac, …
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 0);
}

/** Fraction of the snippet's tokens that also appear in the stem (0…1). Empty snippet → 0. */
function overlap(snippet: string, stem: string): number {
  const snippetTokens = tokenize(snippet);
  if (snippetTokens.length === 0) return 0;
  const stemTokens = new Set(tokenize(stem));
  const hits = snippetTokens.filter((token) => stemTokens.has(token)).length;
  return hits / snippetTokens.length;
}

/**
 * Attach each detected figure to the extracted question it belongs to, returning one
 * {@link DetectedFigure} per successful match. Every question is claimed at most once.
 *
 * Two strategies, tried in order per detection, because the extractor and the detector are separate
 * passes whose only shared anchor is the question itself:
 *   1. Printed number — exact `questionNumber === q_no`. Correct whenever extraction persisted the
 *      number, regardless of the order questions were read in.
 *   2. Text snippet — best token overlap between the detector's `questionText` and a stem. This is the
 *      fallback for legacy questions extracted before numbers were persisted (`questionNumber` null),
 *      whose extraction order does not track the printed order either.
 * A detection that matches nothing (e.g. a figure whose question was never extracted) is dropped.
 */
export function matchFiguresToQuestions(
  detections: DiagramDetection[],
  questions: Question[],
): DetectedFigure[] {
  const claimed = new Set<string>();
  const figures: DetectedFigure[] = [];

  for (const detection of detections) {
    const available = questions.filter((question) => !claimed.has(question.id));

    let match = available.find((question) => question.questionNumber === detection.qNo) ?? null;

    if (!match && detection.questionText.trim().length > 0) {
      let best = MIN_TEXT_OVERLAP;
      for (const question of available) {
        const score = overlap(detection.questionText, question.stem);
        if (score >= best) {
          best = score;
          match = question;
        }
      }
    }

    if (match) {
      claimed.add(match.id);
      figures.push({ questionId: match.id, bbox: detection.bbox });
    }
  }

  return figures;
}
