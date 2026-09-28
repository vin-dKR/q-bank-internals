import { z } from 'zod';

/**
 * Paper-level provenance for a previous-year-questions (PYQ) upload. Unlike the per-question
 * `pyqExam`/`pyqYear` the model reads beside each question, these fields describe the WHOLE paper the
 * questions came from (e.g. "JEE Main 2026, 02 April, Morning Shift") — entered once by the operator
 * (optionally AI-filled from the paper's header) and denormalized onto every question published from
 * it. Every field is optional: the AI fills what the header prints, the operator corrects the rest.
 *
 * Every field name is `pyq`-prefixed on purpose: this metadata only ever belongs to a PYQ question, so
 * the prefix keeps it visibly separate from an ordinary question's fields everywhere it is stored
 * (contract, database, published bank row) — a normal question never carries a `pyq…` paper field.
 */
export const PaperMetadataSchema = z.object({
  /** Name of the examination — NEET, UPSC CSE, SSC CGL. */
  pyqExamName: z.string(),
  /** Year the question appeared — "2024". */
  pyqExamYear: z.string(),
  /** Particular examination session — "2024 Session 1". */
  pyqExamSession: z.string(),
  /** Time/shift of the paper — "Morning", "Shift 2". */
  pyqShift: z.string(),
  /** Name/label of the specific paper — "General Studies Paper I". */
  pyqPaperName: z.string(),
  /** Official code identifying the paper — "GS1-2024". */
  pyqPaperCode: z.string(),
  /** Organization that conducted the exam — NTA, UPSC, SSC. */
  pyqConductingBody: z.string(),
  /** Stage of the examination — Prelims, Mains, Tier 1. */
  pyqExamStage: z.string(),
  /** Actual date of examination — "2024-05-26". */
  pyqExamDate: z.string(),
  /** Question-paper set/version — "Set A", "Set B". */
  pyqPaperSet: z.string(),
  /** Language/version of paper — English, Hindi. */
  pyqLanguage: z.string(),
  /** Number of questions in the paper — "100". */
  pyqTotalQuestions: z.string(),
  /** Exam duration — "120 minutes". */
  pyqDuration: z.string(),
  /** Maximum marks — "200". */
  pyqTotalMarks: z.string(),
});
export type PaperMetadata = z.infer<typeof PaperMetadataSchema>;
export type PaperMetadataKey = keyof PaperMetadata;

/**
 * The paper fields in display order, each with its label, placeholder, and a one-line meaning. A
 * single source of truth shared by the cut-upload form (renders the grid) and the AI-fill prompt
 * (lists exactly these keys), so the two can never drift apart.
 */
export const PAPER_METADATA_FIELDS: readonly {
  key: PaperMetadataKey;
  label: string;
  placeholder: string;
  hint: string;
}[] = [
  {
    key: 'pyqExamName',
    label: 'Exam name',
    placeholder: 'NEET, UPSC CSE, SSC CGL',
    hint: 'Name of the examination',
  },
  {
    key: 'pyqExamYear',
    label: 'Exam year',
    placeholder: '2024',
    hint: 'Year the question appeared',
  },
  {
    key: 'pyqExamSession',
    label: 'Exam session',
    placeholder: '2024 Session 1',
    hint: 'Particular examination session',
  },
  {
    key: 'pyqShift',
    label: 'Shift',
    placeholder: 'Morning, Shift 2',
    hint: 'Time/shift of the paper',
  },
  {
    key: 'pyqPaperName',
    label: 'Paper name',
    placeholder: 'General Studies Paper I',
    hint: 'Name/label of the specific paper',
  },
  {
    key: 'pyqPaperCode',
    label: 'Paper code',
    placeholder: 'GS1-2024',
    hint: 'Official code identifying the paper',
  },
  {
    key: 'pyqConductingBody',
    label: 'Conducting body',
    placeholder: 'NTA, UPSC, SSC',
    hint: 'Organization that conducted the exam',
  },
  {
    key: 'pyqExamStage',
    label: 'Exam stage',
    placeholder: 'Prelims, Mains, Tier 1',
    hint: 'Stage of the examination',
  },
  {
    key: 'pyqExamDate',
    label: 'Exam date',
    placeholder: '2024-05-26',
    hint: 'Actual date of examination',
  },
  {
    key: 'pyqPaperSet',
    label: 'Paper set',
    placeholder: 'Set A, Set B',
    hint: 'Question-paper set/version',
  },
  {
    key: 'pyqLanguage',
    label: 'Language',
    placeholder: 'English, Hindi',
    hint: 'Language/version of paper',
  },
  {
    key: 'pyqTotalQuestions',
    label: 'Total questions',
    placeholder: '100',
    hint: 'Number of questions in the paper',
  },
  { key: 'pyqDuration', label: 'Duration', placeholder: '120 minutes', hint: 'Exam duration' },
  { key: 'pyqTotalMarks', label: 'Total marks', placeholder: '200', hint: 'Maximum marks' },
];

/** A blank paper-metadata draft — every field an empty string. The cut-upload form's starting value. */
export const EMPTY_PAPER_METADATA: PaperMetadata = {
  pyqExamName: '',
  pyqExamYear: '',
  pyqExamSession: '',
  pyqShift: '',
  pyqPaperName: '',
  pyqPaperCode: '',
  pyqConductingBody: '',
  pyqExamStage: '',
  pyqExamDate: '',
  pyqPaperSet: '',
  pyqLanguage: '',
  pyqTotalQuestions: '',
  pyqDuration: '',
  pyqTotalMarks: '',
};

/** True when at least one paper field carries a non-blank value (worth sending / persisting). */
export function hasPaperMetadata(paper: PaperMetadata | null | undefined): boolean {
  if (!paper) return false;
  return PAPER_METADATA_FIELDS.some(({ key }) => (paper[key] ?? '').trim().length > 0);
}

/** Drop blank fields so only the values the operator/AI actually filled are sent and stored. */
export function trimPaperMetadata(paper: PaperMetadata): PaperMetadata {
  const out = { ...EMPTY_PAPER_METADATA };
  for (const { key } of PAPER_METADATA_FIELDS) out[key] = (paper[key] ?? '').trim();
  return out;
}

/**
 * How a paper's answers are laid out in the uploaded PDF(s):
 * - `separate` — questions are one part; the answer key sits grouped elsewhere (a last page or a
 *   sibling answer/solution PDF), bound to the ANSWER/SOLUTION slots. The historical default.
 * - `combined` — questions are one PDF and a single separately uploaded COMPANION PDF contains the
 *   grouped answer key plus worked solutions. The QUESTION and COMPANION parts are bound together;
 *   each topic records its companion page range so extraction does not confuse it with a standalone
 *   answer or solution sibling.
 * - `inline` — each question is immediately followed by its own answer (and any explanation) in ONE
 *   combined PDF (question → answer → question → answer). Only the QUESTION part is bound; extraction
 *   reads the answer + explanation beside each question in a single pass, and Verify shows no separate
 *   answer pane. Applies to ANY source (module / textbook / pyq), not just PYQ.
 */
export const AnswerLayoutSchema = z.enum(['separate', 'combined', 'inline']);
export type AnswerLayout = z.infer<typeof AnswerLayoutSchema>;
