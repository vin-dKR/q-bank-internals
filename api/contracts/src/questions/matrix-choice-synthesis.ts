import { parseMatchKey, type MatchData, type QuestionOption } from './question.schema.js';

/** Why a match table cannot safely become generated A/B/C/D-style choices. */
export type MatrixChoiceSynthesisBlockReason =
  | 'missing_columns'
  | 'missing_entries'
  | 'ambiguous_labels'
  | 'incomplete_key'
  | 'invalid_key';

/** A successful deterministic matrix-choice generation. */
export type GeneratedMatrixChoiceOptions = {
  status: 'generated';
  /** Four choices when the table affords three distinct distractors; fewer only when that is impossible. */
  options: QuestionOption[];
  /** The generated label containing the exact mapping from `match.key`. */
  answer: string;
  correctLabel: string;
  /** All labels in `options`; retained so consumers can distinguish the replaceable generated set. */
  generatedLabels: string[];
  /** Canonical visible text for the correct map, in first-column order. */
  correctMapping: string;
};

/** A deliberate safe no-op: incomplete/ambiguous data must not gain an invented "correct" choice. */
export type BlockedMatrixChoiceOptions = {
  status: 'blocked';
  reason: MatrixChoiceSynthesisBlockReason;
  options: QuestionOption[];
  answer: '';
  correctLabel: null;
  generatedLabels: string[];
  correctMapping: '';
};

/** Result of {@link synthesizeMatrixChoiceOptions}. Check `status` before replacing any existing choices. */
export type MatrixChoiceSynthesis = GeneratedMatrixChoiceOptions | BlockedMatrixChoiceOptions;

type TargetLocation = { label: string; columnIndex: number };
type MatrixChoicePlan = {
  sourceLabels: string[];
  /** Correct target labels, indexed by first-column row then target position. */
  correctRows: string[][];
  /** The later-column identity of each target position in `correctRows`. */
  targetColumnBySlot: number[][];
  /** Labels printed in each later column, in table order. */
  labelsByTargetColumn: string[][];
};

const SAFE_MATRIX_LABEL = /^[A-Za-z0-9]+$/;
const MAX_GENERATED_CHOICES = 4;

/** Case-insensitive identity is intentional: a key's `P` must resolve the printed target `p`. */
function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function cleanedSafeLabel(value: string): string | null {
  const label = value.trim();
  return SAFE_MATRIX_LABEL.test(label) ? label : null;
}

/** Later-column labels give compact answer strings enough context to preserve `T31` / `II` as one target. */
function targetLabelsForMatch(match: MatchData): string[] {
  return match.columns.slice(1).flatMap((column) => column.entries.map((entry) => entry.label));
}

function blocked(reason: MatrixChoiceSynthesisBlockReason): BlockedMatrixChoiceOptions {
  return {
    status: 'blocked',
    reason,
    options: [],
    answer: '',
    correctLabel: null,
    generatedLabels: [],
    correctMapping: '',
  };
}

/**
 * Format an option's full matching in a stable, editor-round-trippable form. `sourceLabels` is
 * normally Column I order; when omitted, the record's insertion order is used for a standalone key.
 */
export function matrixChoiceMappingText(
  key: Record<string, readonly string[]>,
  sourceLabels: readonly string[] = Object.keys(key),
): string {
  return sourceLabels
    .map((source) => {
      const targets = key[source]?.map((target) => target.trim()).filter(Boolean) ?? [];
      return targets.length > 0 ? `${source.trim()} → ${targets.join(', ')}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Fill only missing/empty table-key rows from a raw answer-map string. This lets a separate answer
 * key complete a question-PDF table without replacing a non-empty mapping the operator/model already
 * read. Source labels are matched case-insensitively but kept in the table's original spelling.
 */
export function mergeMatrixKeyWithAnswer(match: MatchData, answer: string | null | undefined): MatchData {
  const answerKey = parseMatchKey(answer ?? '', targetLabelsForMatch(match));
  if (Object.keys(answerKey).length === 0) return match;
  const key: Record<string, string[]> = Object.fromEntries(
    Object.entries(match.key).map(([source, targets]) => [source, [...targets]]),
  );
  for (const [source, targets] of Object.entries(answerKey)) {
    const existing = Object.keys(key).find((candidate) => labelKey(candidate) === labelKey(source));
    const targetKey = existing ?? source;
    if ((key[targetKey] ?? []).length === 0 && targets.length > 0) key[targetKey] = [...targets];
  }
  return { columns: match.columns, key };
}

/** True only when every existing choice is safe for a table edit to replace. */
export function hasOnlyGeneratedMatrixChoices(options: readonly QuestionOption[]): boolean {
  return options.length > 0 && options.every((option) => option.generated === true);
}

/** Build a fully validated table/key plan. Bare target labels must identify exactly one later column. */
function makePlan(match: MatchData): MatrixChoicePlan | MatrixChoiceSynthesisBlockReason {
  const firstColumn = match.columns[0];
  const laterColumns = match.columns.slice(1);
  if (!firstColumn || laterColumns.length === 0) return 'missing_columns';
  if (firstColumn.entries.length === 0 || laterColumns.some((column) => column.entries.length === 0)) {
    return 'missing_entries';
  }

  const sources = new Map<string, string>();
  for (const entry of firstColumn.entries) {
    const label = cleanedSafeLabel(entry.label);
    if (!label) return 'invalid_key';
    const key = labelKey(label);
    if (sources.has(key)) return 'ambiguous_labels';
    sources.set(key, label);
  }

  // A MatchData key stores only a bare target label, so accepting `p` in two later columns would
  // make a generated alternative semantically unknowable. Reject rather than guessing a column.
  const targets = new Map<string, TargetLocation>();
  const labelsByTargetColumn: string[][] = [];
  for (const [offset, column] of laterColumns.entries()) {
    const labels: string[] = [];
    for (const entry of column.entries) {
      const label = cleanedSafeLabel(entry.label);
      if (!label) return 'invalid_key';
      const key = labelKey(label);
      if (targets.has(key)) return 'ambiguous_labels';
      targets.set(key, { label, columnIndex: offset });
      labels.push(label);
    }
    labelsByTargetColumn.push(labels);
  }

  const keyRows = new Map<string, string[]>();
  for (const [rawSource, rawTargets] of Object.entries(match.key)) {
    const source = cleanedSafeLabel(rawSource);
    if (!source) return 'invalid_key';
    const sourceKey = labelKey(source);
    if (!sources.has(sourceKey) || keyRows.has(sourceKey)) return 'incomplete_key';
    if (rawTargets.length === 0) return 'incomplete_key';
    const rowTargets: string[] = [];
    const seenTargets = new Set<string>();
    for (const rawTarget of rawTargets) {
      const target = cleanedSafeLabel(rawTarget);
      if (!target) return 'invalid_key';
      const targetKey = labelKey(target);
      if (seenTargets.has(targetKey)) return 'invalid_key';
      const location = targets.get(targetKey);
      if (!location) return 'invalid_key';
      seenTargets.add(targetKey);
      rowTargets.push(location.label);
    }
    keyRows.set(sourceKey, rowTargets);
  }

  // Every printed Column-I row needs at least one exact key entry; extra/dangling rows were rejected
  // above. This is the completeness gate that makes the selected generated answer genuinely correct.
  if (keyRows.size !== sources.size) return 'incomplete_key';

  const sourceLabels = [...sources.values()];
  const correctRows: string[][] = [];
  const targetColumnBySlot: number[][] = [];
  for (const source of sourceLabels) {
    const row = keyRows.get(labelKey(source));
    if (!row || row.length === 0) return 'incomplete_key';
    correctRows.push(row);
    const columns: number[] = [];
    for (const target of row) {
      const location = targets.get(labelKey(target));
      if (!location) return 'invalid_key';
      columns.push(location.columnIndex);
    }
    targetColumnBySlot.push(columns);
  }
  return { sourceLabels, correctRows, targetColumnBySlot, labelsByTargetColumn };
}

/**
 * Find the existing printed/generated option that encodes this table's exact complete key. This is a
 * best-effort bridge for an answer-key re-read that returns `A→p; …` while the question sheet already
 * has a printed choice panel; `null` means the option text used another visual notation.
 */
export function findMatrixChoiceForMatch(
  options: readonly QuestionOption[],
  match: MatchData,
): string | null {
  const correctPlan = makePlan(match);
  if (typeof correctPlan === 'string') return null;
  const correct = mappingText(correctPlan, correctPlan.correctRows);
  for (const option of options) {
    const candidateKey = parseMatchKey(option.body, targetLabelsForMatch(match));
    if (Object.keys(candidateKey).length === 0) continue;
    const candidatePlan = makePlan({ columns: match.columns, key: candidateKey });
    if (typeof candidatePlan !== 'string' && mappingText(candidatePlan, candidatePlan.correctRows) === correct) {
      return option.label;
    }
  }
  return null;
}

function cloneRows(rows: readonly (readonly string[])[]): string[][] {
  return rows.map((row) => [...row]);
}

/**
 * A match is a set of targets inside each source-row/later-column pair: `A → p, q` means exactly
 * the same thing as `A → q, p`. Keep the source's column-group order, but print targets within each
 * group in the table's printed order so an order-only shuffle cannot become a false distractor.
 */
function canonicalRow(plan: MatrixChoicePlan, rowIndex: number, row: readonly string[]): string[] {
  const targetsByColumn = new Map<number, string[]>();
  const columnOrder: number[] = [];
  row.forEach((target, slot) => {
    const column = plan.targetColumnBySlot[rowIndex]?.[slot];
    if (column === undefined) return;
    if (!targetsByColumn.has(column)) columnOrder.push(column);
    const targets = targetsByColumn.get(column) ?? [];
    targets.push(target);
    targetsByColumn.set(column, targets);
  });
  return columnOrder.flatMap((column) => {
    const printed = plan.labelsByTargetColumn[column] ?? [];
    const position = (target: string): number => {
      const index = printed.findIndex((label) => labelKey(label) === labelKey(target));
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...(targetsByColumn.get(column) ?? [])].sort((left, right) => {
      const difference = position(left) - position(right);
      return difference !== 0 ? difference : labelKey(left).localeCompare(labelKey(right));
    });
  });
}

function canonicalRows(plan: MatrixChoicePlan, rows: readonly (readonly string[])[]): string[][] {
  return rows.map((row, index) => canonicalRow(plan, index, row));
}

function mappingText(plan: MatrixChoicePlan, rows: readonly (readonly string[])[]): string {
  const canonical = canonicalRows(plan, rows);
  const key: Record<string, readonly string[]> = {};
  plan.sourceLabels.forEach((source, index) => { key[source] = canonical[index] ?? []; });
  return matrixChoiceMappingText(key, plan.sourceLabels);
}

function slotsForColumn(plan: MatrixChoicePlan, columnIndex: number): Array<{ row: number; slot: number }> {
  const slots: Array<{ row: number; slot: number }> = [];
  plan.targetColumnBySlot.forEach((columns, row) => {
    columns.forEach((column, slot) => {
      if (column === columnIndex) slots.push({ row, slot });
    });
  });
  return slots;
}

/** True when this target column is a complete one-to-one permutation in the supplied correct key. */
function isPermutationColumn(plan: MatrixChoicePlan, columnIndex: number, slots: readonly { row: number; slot: number }[]): boolean {
  const available = plan.labelsByTargetColumn[columnIndex] ?? [];
  if (slots.length !== available.length || available.length === 0) return false;
  const values = slots.map(({ row, slot }) => plan.correctRows[row]?.[slot] ?? '');
  return new Set(values.map(labelKey)).size === available.length
    && values.every((value) => available.some((candidate) => labelKey(candidate) === labelKey(value)));
}

/**
 * A target column that is unique in the original key remains one-to-one in every distractor, even
 * when the table lists an extra unused decoy target. A repeated baseline is deliberately treated as
 * many-to-one instead, so its valid relation is not accidentally tightened.
 */
function isInjectiveBaselineColumn(
  plan: MatrixChoicePlan,
  columnIndex: number,
  slots: readonly { row: number; slot: number }[],
): boolean {
  if (slots.length === 0) return false;
  const values = slots.map(({ row, slot }) => plan.correctRows[row]?.[slot] ?? '');
  return new Set(values.map(labelKey)).size === values.length;
}

/**
 * A candidate cannot duplicate a target in a source row / target column. It must also retain a
 * column's one-to-one shape whenever the complete baseline key was injective for that column.
 */
function locallyValid(plan: MatrixChoicePlan, rows: readonly (readonly string[])[]): boolean {
  const injectiveColumns = new Set(
    plan.labelsByTargetColumn.flatMap((_, column) => {
      const slots = slotsForColumn(plan, column);
      return isInjectiveBaselineColumn(plan, column, slots) ? [column] : [];
    }),
  );
  const seenAcrossInjectiveColumns = new Map<number, Set<string>>();
  for (const [rowIndex, row] of rows.entries()) {
    const seen = new Set<string>();
    for (const [slot, target] of row.entries()) {
      const column = plan.targetColumnBySlot[rowIndex]?.[slot];
      if (column === undefined) return false;
      const identity = `${String(column)}:${labelKey(target)}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      if (injectiveColumns.has(column)) {
        const targets = seenAcrossInjectiveColumns.get(column) ?? new Set<string>();
        if (targets.has(labelKey(target))) return false;
        targets.add(labelKey(target));
        seenAcrossInjectiveColumns.set(column, targets);
      }
    }
  }
  return true;
}

/** One alternate assignment for a later column, represented only at that column's slots. */
type ColumnVariant = { columnIndex: number; values: string[] };

function uniqueVariants(plan: MatrixChoicePlan, columnIndex: number): ColumnVariant[] {
  const slots = slotsForColumn(plan, columnIndex);
  const baseline = slots.map(({ row, slot }) => plan.correctRows[row]?.[slot] ?? '');
  if (slots.length === 0) return [];

  const result: ColumnVariant[] = [];
  const seen = new Set<string>();
  const add = (values: string[]): void => {
    const signature = values.map(labelKey).join('|');
    if (signature === baseline.map(labelKey).join('|') || seen.has(signature)) return;
    const rows = cloneRows(plan.correctRows);
    slots.forEach(({ row, slot }, index) => {
      const targetRow = rows[row];
      if (targetRow) targetRow[slot] = values[index] ?? '';
    });
    if (!locallyValid(plan, rows)) return;
    seen.add(signature);
    result.push({ columnIndex, values });
  };

  if (isPermutationColumn(plan, columnIndex, slots)) {
    // Pair swaps cover the common 3–4-row matrix with readable, one-to-one distractors. Rotations
    // add distinct candidates for wider tables without enumerating factorially many permutations.
    for (let left = 0; left < baseline.length; left += 1) {
      for (let right = left + 1; right < baseline.length; right += 1) {
        const values = [...baseline];
        const leftValue = values[left] ?? '';
        values[left] = values[right] ?? '';
        values[right] = leftValue;
        add(values);
      }
    }
    for (let shift = 1; shift < baseline.length; shift += 1) {
      add(baseline.map((_, index) => baseline[(index + shift) % baseline.length] ?? ''));
    }
    return result;
  }

  const alternatives = plan.labelsByTargetColumn[columnIndex] ?? [];
  // A many-to-one / partially populated column is not a permutation. Replace exactly one slot at a
  // time with another label printed in the SAME later column, retaining every source row's number of
  // targets and avoiding duplicated same-column targets inside that row.
  slots.forEach((_, index) => {
    for (const alternative of alternatives) {
      if (labelKey(alternative) === labelKey(baseline[index] ?? '')) continue;
      const values = [...baseline];
      values[index] = alternative;
      add(values);
    }
  });
  // Swaps remain useful for partially populated columns and often give more recognisable distractors.
  for (let left = 0; left < baseline.length; left += 1) {
    for (let right = left + 1; right < baseline.length; right += 1) {
      const values = [...baseline];
      const leftValue = values[left] ?? '';
      values[left] = values[right] ?? '';
      values[right] = leftValue;
      add(values);
    }
  }
  return result;
}

function applyVariants(plan: MatrixChoicePlan, variants: readonly ColumnVariant[]): string[][] {
  const rows = cloneRows(plan.correctRows);
  for (const variant of variants) {
    const slots = slotsForColumn(plan, variant.columnIndex);
    slots.forEach(({ row, slot }, index) => {
      const targetRow = rows[row];
      if (targetRow) targetRow[slot] = variant.values[index] ?? '';
    });
  }
  return rows;
}

/** Stable non-cryptographic position hash: deterministic across browser/server without Math.random(). */
function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Turn a complete, unambiguous match-the-column key into selectable answer choices.
 *
 * The exact key is one correct option. Distractors only exchange/rewrite targets within their own
 * later column, preserve every source row's target cardinality, and are deduplicated. The helper is
 * intentionally pure and shared by API/Web contracts so a manual table edit can regenerate only rows
 * whose `generated` provenance is true. It never inspects or replaces printed choices; callers must
 * invoke it only when `options.length === 0` (or every existing choice is generated).
 */
export function synthesizeMatrixChoiceOptions(match: MatchData): MatrixChoiceSynthesis {
  const planOrReason = makePlan(match);
  if (typeof planOrReason === 'string') return blocked(planOrReason);
  const plan = planOrReason;
  const correctMapping = mappingText(plan, plan.correctRows);
  if (!correctMapping) return blocked('incomplete_key');

  const candidates: string[][][] = [];
  const seen = new Set<string>([correctMapping]);
  const variantsByColumn = plan.labelsByTargetColumn.map((_, column) => uniqueVariants(plan, column));
  const addCandidate = (rows: string[][]): void => {
    if (candidates.length >= MAX_GENERATED_CHOICES - 1 || !locallyValid(plan, rows)) return;
    const text = mappingText(plan, rows);
    if (!text || seen.has(text)) return;
    seen.add(text);
    candidates.push(rows);
  };

  // Prefer simple, inspectable one-column alternatives before combining changes across multiple later
  // columns. This covers conventional 4×2 tables and makes output stable in table reading order.
  variantsByColumn.forEach((variants) => {
    variants.forEach((variant) => { addCandidate(applyVariants(plan, [variant])); });
  });

  // With 3+ later columns, a two-row one-to-one map may have only one valid mutation per column.
  // Cartesian combinations produce the remaining distinct choices without violating any column's
  // permutation rule. Stop once the standard four total choices are available.
  const combine = (column: number, chosen: ColumnVariant[]): void => {
    if (candidates.length >= MAX_GENERATED_CHOICES - 1) return;
    if (column === variantsByColumn.length) {
      if (chosen.length >= 2) addCandidate(applyVariants(plan, chosen));
      return;
    }
    combine(column + 1, chosen);
    for (const variant of variantsByColumn[column] ?? []) {
      combine(column + 1, [...chosen, variant]);
      if (candidates.length >= MAX_GENERATED_CHOICES - 1) return;
    }
  };
  combine(0, []);

  const distractors = candidates.map((rows) => mappingText(plan, rows));
  const correctIndex = stableHash(correctMapping) % (distractors.length + 1);
  const mappings = [...distractors];
  mappings.splice(correctIndex, 0, correctMapping);
  const options = mappings.map((body, index) => ({
    label: optionLabel(index),
    body,
    isCorrect: index === correctIndex,
    generated: true,
  }));

  return {
    status: 'generated',
    options,
    answer: optionLabel(correctIndex),
    correctLabel: optionLabel(correctIndex),
    generatedLabels: options.map((option) => option.label),
    correctMapping,
  };
}
