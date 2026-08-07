import type { DetectedFigure, Question, QuestionOption } from '@ingest/contracts';
import type { DiagramDetection, QuestionTop } from './diagram-detector.js';

/** Least overlap between a detection snippet and a stem we'll accept as "the same question". */
const MIN_TEXT_OVERLAP = 0.5;
/** A near-complete stem snippet is safer than a model's inferred question number. */
const STRONG_TEXT_OVERLAP = 0.75;

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
 * From the detector's per-question layout anchors, find the printed number of the question a figure
 * belongs to: the question whose first line is the lowest one still above the figure, *in the figure's
 * own column*. Column is decided by the page midline — a figure whose horizontal centre is on one side
 * only considers questions anchored on that side, which is what stops a left-column figure from
 * binding to a right-column question that happens to share its vertical band (the common two-column
 * failure). If no same-column question sits above the figure, we relax to the nearest question above
 * it regardless of column; a figure above every anchor returns null.
 *
 * We probe with the figure's vertical centre rather than its top edge, so a figure drawn inline (its
 * top pixel a hair above the question's first text line) still binds to that question, not the one
 * before it.
 */
function questionNumberAboveFigure(
  sortedTops: QuestionTop[],
  bbox: [number, number, number, number],
  pageWidth: number,
): number | null {
  const probeY = bbox[1] + bbox[3] / 2;
  const figureCentreX = bbox[0] + bbox[2] / 2;
  const midline = pageWidth / 2;
  const sameColumn = (xLeft: number): boolean => xLeft < midline === figureCentreX < midline;

  let sameColumnOwner: number | null = null;
  let anyColumnOwner: number | null = null;
  for (const top of sortedTops) {
    if (top.yTop > probeY) break; // sorted top→bottom: nothing below the figure can own it
    anyColumnOwner = top.qNo;
    if (sameColumn(top.xLeft)) sameColumnOwner = top.qNo;
  }
  return sameColumnOwner ?? anyColumnOwner;
}

/**
 * Strip an option label down to its printed token: "(A)" / "a." / "[B]" / " C )" → "A"/"B"/"C",
 * "(2)" → "2". Detector output and extracted labels come from two different model passes, so both
 * sides are normalized with this one function before comparing.
 */
function normalizeOptionLabel(label: string): string {
  return label
    .trim()
    .replace(/^[\s([{]+/, '')
    .replace(/[\s)\]}.:]+$/, '')
    .toUpperCase();
}

/**
 * Resolve a detected option label to the option's zero-based position. Exact (normalized) label match
 * first; failing that, cross-scheme by position — extraction normalizes printed `(1)…(4)` labels to
 * `A…D`, so a detector that read the printed digits (or vice versa) still lands on the right option.
 * Returns -1 when the label is missing or resolves outside the question's options.
 */
function resolveOptionIndex(rawLabel: string | null, options: QuestionOption[]): number {
  if (rawLabel === null) return -1;
  const label = normalizeOptionLabel(rawLabel);
  if (!label) return -1;
  const exact = options.findIndex((option) => normalizeOptionLabel(option.label) === label);
  if (exact >= 0) return exact;
  if (/^[A-Z]$/.test(label)) {
    const index = label.charCodeAt(0) - 65;
    return index < options.length ? index : -1;
  }
  if (/^\d+$/.test(label)) {
    const index = Number(label) - 1;
    return index >= 0 && index < options.length ? index : -1;
  }
  return -1;
}

/**
 * Reading order for option figures on a page: top→bottom, with boxes in the same horizontal band
 * (vertical centres closer than half the shorter box) ordered left→right — handles both a row of
 * picture options and a 2×2 grid.
 */
function byReadingOrder(a: DiagramDetection, b: DiagramDetection): number {
  const aCentreY = a.bbox[1] + a.bbox[3] / 2;
  const bCentreY = b.bbox[1] + b.bbox[3] / 2;
  const sameBand = Math.abs(aCentreY - bCentreY) < Math.min(a.bbox[3], b.bbox[3]) / 2;
  return sameBand ? a.bbox[0] - b.bbox[0] : aCentreY - bCentreY;
}

/**
 * Attach each detected figure to the extracted question it belongs to, returning one
 * {@link DetectedFigure} per successful match. Each question destination (stem or individual option)
 * is claimed at most once, while allowing a question to have both a stem figure and option figures.
 *
 * Four strategies, tried in order per detection, because the extractor and the detector are separate
 * passes whose only shared anchor is the question itself:
 *   1. Strong text — a near-complete verbatim first-line snippet. This is direct evidence and beats
 *      position when a page layout is irregular.
 *   2. Printed number — exact `questionNumber === q_no` the model tagged onto the figure itself.
 *      This is constrained to a number already extracted from the current page, so it is a stronger
 *      owner signal than proximity on a dense two-column page.
 *   3. Geometric — the printed number of the question whose first line sits directly above the figure
 *      in the same column ({@link questionNumberAboveFigure}), resolved to an extracted question by
 *      `questionNumber`. This is the strongest signal: it derives the owner from raw page positions
 *      instead of trusting the model to infer the figure's question number in one combined reasoning
 *      step (which it routinely gets wrong on two-column papers). Needs the detector's `questionTops`;
 *      absent (older model output, or a model that ignored the `questions` request) it contributes
 *      nothing and matching degrades to strategies 2–3.
 *   4. Text snippet — best token overlap between the detector's `questionText` and a stem. This is the
 *      fallback for legacy questions extracted before numbers were persisted (`questionNumber` null),
 *      whose extraction order does not track the printed order either.
 * A detection that matches nothing (e.g. a figure whose question was never extracted) is dropped.
 *
 * Option figures resolve their option position from the detector's printed label
 * ({@link resolveOptionIndex}); when the label is missing or unreadable, the question's remaining
 * unlabelled option figures are assigned to its unclaimed options in reading order — picture options
 * are printed in option order, so position is the next-best owner signal after the label. Only an
 * option figure that still cannot be placed (more figures than free options) is dropped.
 */
export function matchFiguresToQuestions(
  detections: DiagramDetection[],
  questionTops: QuestionTop[],
  questions: Question[],
  pageWidth: number,
): DetectedFigure[] {
  const claimed = new Set<string>();
  const figures: DetectedFigure[] = [];
  const sortedTops = [...questionTops].sort((a, b) => a.yTop - b.yTop);
  /** Option figures whose printed label did not resolve, grouped for the positional fallback. */
  const unresolvedOptions = new Map<string, { question: Question; detections: DiagramDetection[] }>();

  const claim = (question: Question, target: 'question' | 'option', optionIndex: number, detection: DiagramDetection): void => {
    const targetKey = `${question.id}:${target}:${String(optionIndex)}`;
    if (claimed.has(targetKey)) return;
    claimed.add(targetKey);
    figures.push({
      questionId: question.id,
      target,
      optionIndex,
      bbox: detection.bbox,
      snippet: detection.questionText,
    });
  };

  for (const detection of detections) {
    let textMatch: Question | null = null;
    let textScore = 0;
    if (detection.questionText.trim().length > 0) {
      for (const question of questions) {
        const score = overlap(detection.questionText, question.stem);
        if (score > textScore) {
          textScore = score;
          textMatch = question;
        }
      }
    }

    const ownerQNo = questionNumberAboveFigure(sortedTops, detection.bbox, pageWidth);
    // A long verbatim OCR snippet is the most direct proof of ownership. For less certain snippets,
    // retain the page-layout anchor: it is what separates two questions in adjacent columns.
    let match = textScore >= STRONG_TEXT_OVERLAP ? textMatch : null;
    match ??= questions.find((question) => question.questionNumber === detection.qNo) ?? null;

    match ??= ownerQNo === null
      ? null
      : (questions.find((question) => question.questionNumber === ownerQNo) ?? null);

    if (!match && textScore >= MIN_TEXT_OVERLAP) {
      match = textMatch;
    }

    if (!match) continue;

    if (detection.target === 'question') {
      claim(match, 'question', 0, detection);
      continue;
    }
    if (match.options.length === 0) continue; // an option figure needs an option to land on
    const optionIndex = resolveOptionIndex(detection.optionLabel, match.options);
    if (optionIndex >= 0) {
      claim(match, 'option', optionIndex, detection);
    } else {
      const group = unresolvedOptions.get(match.id) ?? { question: match, detections: [] };
      group.detections.push(detection);
      unresolvedOptions.set(match.id, group);
    }
  }

  for (const { question, detections: pending } of unresolvedOptions.values()) {
    const free = question.options
      .map((_, index) => index)
      .filter((index) => !claimed.has(`${question.id}:option:${String(index)}`));
    const ordered = [...pending].sort(byReadingOrder);
    for (const [position, detection] of ordered.entries()) {
      const optionIndex = free[position];
      if (optionIndex === undefined) break; // more figures than free options — drop the excess
      claim(question, 'option', optionIndex, detection);
    }
  }

  return figures;
}
