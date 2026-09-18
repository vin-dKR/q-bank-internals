import { z } from 'zod';
import { AiFilledSchema } from '../common/ai-filled.js';
import { MatchDataSchema } from '../questions/question.schema.js';

/**
 * Data-quality tracking for the LIVE shared bank: the main `Question` rows Eduents serves to every
 * organisation (`organizationId` present and null). Ingest staging (sessions, extracted-but-unpublished
 * questions) and organisation-private questions are out of scope. A scan runs a fixed set of rules over
 * every live row and records each problem it finds as an {@link AnomalySchema} row. Rows persist across
 * scans so the team can track them: a problem that disappears is auto-resolved, one that comes back is
 * reopened, and one an operator marked `ignored` stays ignored.
 */

/** The broad area an anomaly belongs to — the headline grouping on the dashboard. */
export const ANOMALY_GROUPS = [
  'answer',
  'topic',
  'metadata',
  'content',
  'images',
  'latex',
  'structure',
  'duplicates',
] as const;
export const AnomalyGroupSchema = z.enum(ANOMALY_GROUPS);
export type AnomalyGroup = z.infer<typeof AnomalyGroupSchema>;

/** Display label for each group, shared so the dashboard never re-types them. */
export const ANOMALY_GROUP_LABELS: Record<AnomalyGroup, string> = {
  answer: 'Answer',
  topic: 'Topic',
  metadata: 'Metadata',
  content: 'Content',
  images: 'Images',
  latex: 'LaTeX rendering',
  structure: 'Structure',
  duplicates: 'Duplicates',
};

/** How much an anomaly hurts: `high` breaks what a student sees, `low` is cosmetic or informational. */
export const ANOMALY_SEVERITIES = ['high', 'medium', 'low'] as const;
export const AnomalySeveritySchema = z.enum(ANOMALY_SEVERITIES);
export type AnomalySeverity = z.infer<typeof AnomalySeveritySchema>;

/**
 * Every rule a scan applies, keyed by its stable code. The code is persisted on each anomaly row, so
 * renaming one orphans its history — add new codes instead. `group` and `severity` live here (not on the
 * row alone) so a rule's classification is defined once for both the scanner and the dashboard.
 */
export const ANOMALY_KINDS = {
  answer_missing: { group: 'answer', severity: 'high', label: 'Answer missing' },
  answer_missing_subjective: { group: 'answer', severity: 'low', label: 'Answer missing (subjective)' },
  answer_placeholder: { group: 'answer', severity: 'high', label: 'Answer is placeholder text' },
  answer_not_in_options: { group: 'answer', severity: 'high', label: 'Answer label not among options' },
  single_correct_multiple_answers: { group: 'answer', severity: 'medium', label: 'Single-correct type with several answers' },
  integer_answer_not_numeric: { group: 'answer', severity: 'medium', label: 'Integer type with non-numeric answer' },
  topic_missing: { group: 'topic', severity: 'medium', label: 'Topic missing' },
  topic_equals_chapter: { group: 'topic', severity: 'low', label: 'Topic is just the chapter name' },
  topic_looks_like_section: { group: 'topic', severity: 'medium', label: 'Topic looks like an exercise/section label' },
  type_missing: { group: 'metadata', severity: 'medium', label: 'Question type missing' },
  type_not_a_type: { group: 'metadata', severity: 'medium', label: 'Question type holds a non-type value' },
  type_nonstandard: { group: 'metadata', severity: 'low', label: 'Question type uses a non-standard spelling' },
  subject_missing: { group: 'metadata', severity: 'high', label: 'Subject missing' },
  chapter_missing: { group: 'metadata', severity: 'high', label: 'Chapter missing' },
  exam_missing: { group: 'metadata', severity: 'high', label: 'Exam missing' },
  level_missing: { group: 'metadata', severity: 'low', label: 'Difficulty level not set' },
  question_text_empty: { group: 'content', severity: 'high', label: 'Question text and image both empty' },
  mcq_options_missing: { group: 'content', severity: 'high', label: 'MCQ with fewer than 2 options' },
  empty_option_text: { group: 'content', severity: 'medium', label: 'An option has no text' },
  duplicate_options: { group: 'content', severity: 'medium', label: 'Options with identical text' },
  mcq_option_count_unusual: { group: 'content', severity: 'low', label: 'MCQ with fewer than 4 options' },
  option_labels_repeat: { group: 'content', severity: 'high', label: 'Option labels repeat (two questions merged)' },
  option_labels_not_letters: { group: 'content', severity: 'medium', label: 'Choice options labelled with numbers, not A–D' },
  question_image_flag_without_url: { group: 'images', severity: 'high', label: 'Question image flagged but no URL' },
  question_image_url_without_flag: { group: 'images', severity: 'medium', label: 'Question image URL but flag off' },
  option_image_flag_without_url: { group: 'images', severity: 'high', label: 'Option images flagged but none stored' },
  figure_mentioned_without_image: { group: 'images', severity: 'medium', label: 'Text mentions a figure but no image' },
  latex_parse_error: { group: 'latex', severity: 'high', label: 'LaTeX fails to render' },
  latex_corrupted_escape: { group: 'latex', severity: 'high', label: 'Corrupted LaTeX escape (\\frac → rac)' },
  latex_unclosed_delimiter: { group: 'latex', severity: 'high', label: 'Unclosed math delimiter' },
  latex_outside_delimiters: { group: 'latex', severity: 'medium', label: 'LaTeX outside \\( \\) (shown raw)' },
  matrix_missing_columns: { group: 'structure', severity: 'low', label: 'Matrix type without match columns' },
  group_missing_passage: { group: 'structure', severity: 'high', label: 'Comprehension member without passage' },
  duplicate_question: { group: 'duplicates', severity: 'medium', label: 'Duplicate question (same subject)' },
  duplicate_across_subjects: { group: 'duplicates', severity: 'medium', label: 'Duplicate across subjects' },
} as const satisfies Record<string, { group: AnomalyGroup; severity: AnomalySeverity; label: string }>;

export type AnomalyKind = keyof typeof ANOMALY_KINDS;
const ANOMALY_KIND_CODES = Object.keys(ANOMALY_KINDS) as [AnomalyKind, ...AnomalyKind[]];
export const AnomalyKindSchema = z.enum(ANOMALY_KIND_CODES);

/**
 * `open` needs attention; `ignored` was reviewed and accepted as-is (a scan never reopens it);
 * `resolved` was set by a scan that no longer found the problem on a question still in the live bank
 * (a later scan reopens it if it returns).
 */
export const ANOMALY_STATUSES = ['open', 'ignored', 'resolved'] as const;
export const AnomalyStatusSchema = z.enum(ANOMALY_STATUSES);
export type AnomalyStatus = z.infer<typeof AnomalyStatusSchema>;

/** One tracked problem on one bank question (and, for field-level rules, one field of it). */
export const AnomalySchema = z.object({
  id: z.string(),
  // The bank `Question` row's Mongo `_id`.
  questionId: z.string(),
  // The ingest provenance (`ingest_ref`), null on legacy rows published before the ingest app.
  ingestQuestionId: z.string().nullable(),
  documentId: z.string().nullable(),
  kind: AnomalyKindSchema,
  group: AnomalyGroupSchema,
  severity: AnomalySeveritySchema,
  // The offending field for field-level rules ("options[2]", "answer"); null for whole-question rules.
  field: z.string().nullable(),
  detail: z.string(),
  status: AnomalyStatusSchema,
  // A snapshot of the question as of the last scan that saw the anomaly, for display and filtering.
  exam: z.string().nullable(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  questionType: z.string().nullable(),
  questionNumber: z.number().int().nullable(),
  fileName: z.string().nullable(),
  preview: z.string(),
  // When the question was added to the bank, read off its Mongo `_id` (created on first publish and kept
  // by every re-publish). Null only if the id is not an ObjectId.
  questionAddedAt: z.string().datetime().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

/** Filters + cursor for the anomaly list. Every filter is optional; `status` defaults to `open`. */
export const AnomalyListQuerySchema = z.object({
  status: AnomalyStatusSchema.default('open'),
  group: AnomalyGroupSchema.optional(),
  kind: AnomalyKindSchema.optional(),
  severity: AnomalySeveritySchema.optional(),
  exam: z.string().optional(),
  subject: z.string().optional(),
  chapter: z.string().optional(),
  // Substring match against the question preview, file name, or bank question id.
  q: z.string().optional(),
  // The id of the last anomaly on the previous page (a Mongo ObjectId).
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type AnomalyListQuery = z.infer<typeof AnomalyListQuerySchema>;

/** One page of anomalies, the cursor for the next page (null at the end), and the filtered total. */
export const AnomalyPageSchema = z.object({
  anomalies: z.array(AnomalySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type AnomalyPage = z.infer<typeof AnomalyPageSchema>;

/**
 * The values each taxonomy dropdown should offer for the CURRENT selection. Cascading, like the Questions
 * browse: every set is narrowed by the other choices but never by itself, so picking JEE shrinks the
 * subject list while leaving every exam still selectable.
 */
export const QualityFilterOptionsSchema = z.object({
  exams: z.array(z.string()),
  subjects: z.array(z.string()),
  chapters: z.array(z.string()),
  /**
   * How many anomalies each rule has UNDER THE CURRENT FILTERS — the numbers beside the problem tree, so
   * choosing JEE shows how much of each rule is JEE's. The group and rule already picked are deliberately
   * ignored here: a tree whose other rows collapsed to zero as soon as you picked one would be useless.
   */
  byKind: z.array(z.object({ kind: AnomalyKindSchema, count: z.number().int().nonnegative() })),
});
export type QualityFilterOptions = z.infer<typeof QualityFilterOptionsSchema>;

/** Change an anomaly's review state: ignore an accepted one, or reopen an ignored/resolved one. */
export const UpdateAnomalySchema = z.object({ status: z.enum(['open', 'ignored']) });
export type UpdateAnomaly = z.infer<typeof UpdateAnomalySchema>;

/** One scan run: when it ran, how far it got, and how the tracked set changed. */
export const QualityScanSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  questionsScanned: z.number().int().nonnegative(),
  anomaliesFound: z.number().int().nonnegative(),
  // How the tracked set moved: brand-new rows, resolved rows that came back, open rows whose problem is
  // gone, and rows dropped because their question left the live bank (deleted or no longer shared).
  opened: z.number().int().nonnegative(),
  reopened: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type QualityScan = z.infer<typeof QualityScanSchema>;

export const QualityScanListSchema = z.object({ scans: z.array(QualityScanSchema) });
export type QualityScanList = z.infer<typeof QualityScanListSchema>;

/**
 * How hard a question is. Three bands, judged from the worked solution (steps, concepts, how easy it is to
 * fall into a trap), because finer scales blur at their boundaries.
 */
export const QUESTION_LEVELS = ['easy', 'medium', 'hard'] as const;
export const QuestionLevelSchema = z.enum(QUESTION_LEVELS);
export type QuestionLevel = z.infer<typeof QuestionLevelSchema>;

/**
 * The editable fields of a live bank question, as the fix workspace sends them. Every field is optional so
 * one correction never resends the rest, and at least one must be present. Applying a fix writes the bank
 * row AND its ingest staging copy, so a later re-publish cannot undo the correction.
 */
export const QuestionFixSchema = z
  .object({
    questionText: z.string().optional(),
    // Whole option strings as the bank stores them ("(A) body"), in order.
    options: z.array(z.string()).optional(),
    answer: z.string().nullable().optional(),
    explanation: z.string().nullable().optional(),
    topic: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    chapter: z.string().nullable().optional(),
    exam: z.string().nullable().optional(),
    questionType: z.string().nullable().optional(),
    sectionName: z.string().nullable().optional(),
    level: QuestionLevelSchema.nullable().optional(),
    // Structure, not metadata: the match table a matrix question should carry (mirrored into `answer` by the
    // service), and the shared passage of a comprehension group (written to every row of the group).
    match: MatchDataSchema.nullable().optional(),
    passage: z.string().nullable().optional(),
  })
  .refine((fix) => Object.keys(fix).length > 0, { message: 'At least one field to fix is required.' });
export type QuestionFix = z.infer<typeof QuestionFixSchema>;

/** One question in the fix queue: every open anomaly on it rolled into a single row. */
export const FixQueueItemSchema = z.object({
  questionId: z.string(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  questionNumber: z.number().int().nullable(),
  fileName: z.string().nullable(),
  preview: z.string(),
  /** The worst severity among this question's open anomalies — how the row is ranked and badged. */
  severity: AnomalySeveritySchema,
  anomalyCount: z.number().int().positive(),
  kinds: z.array(AnomalyKindSchema),
  questionAddedAt: z.string().datetime().nullable(),
});
export type FixQueueItem = z.infer<typeof FixQueueItemSchema>;

export const FixQueuePageSchema = z.object({
  items: z.array(FixQueueItemSchema),
  nextCursor: z.string().nullable(),
  /** Distinct questions matching the filters, not anomalies. */
  total: z.number().int().nonnegative(),
});
export type FixQueuePage = z.infer<typeof FixQueuePageSchema>;

/** One question as the fix panel edits it: its current bank values plus the anomalies open on it. */
export const FixTargetSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  options: z.array(z.string()),
  answer: z.string().nullable(),
  explanation: z.string().nullable(),
  topic: z.string().nullable(),
  exam: z.string().nullable(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  sectionName: z.string().nullable(),
  questionType: z.string().nullable(),
  level: QuestionLevelSchema.nullable(),
  /** The structured matching of a matrix question; null on every other type and on rows that lost it. */
  match: MatchDataSchema.nullable(),
  questionNumber: z.number().int().nullable(),
  fileName: z.string().nullable(),
  questionImage: z.string().nullable(),
  optionImages: z.array(z.string()),
  passage: z.string().nullable(),
  documentId: z.string().nullable(),
  // Null when the question predates the ingest pipeline: it has no staging copy to keep in step.
  ingestQuestionId: z.string().nullable(),
  questionAddedAt: z.string().datetime().nullable(),
  /** Which of topic/answer/solution/level currently hold an AI-written value. Empty when none do. */
  aiFilled: AiFilledSchema,
  anomalies: z.array(AnomalySchema),
});
export type FixTarget = z.infer<typeof FixTargetSchema>;

/**
 * The outcome of applying a fix: the question as it now stands (with its remaining anomalies re-checked
 * immediately) and how many of its anomalies the fix cleared. Duplicate anomalies are left alone — they
 * depend on the whole bank, so only a full scan can settle them.
 */
export const FixResultSchema = z.object({
  target: FixTargetSchema,
  resolved: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type FixResult = z.infer<typeof FixResultSchema>;

export const AI_FIX_FIELDS = ['topic', 'answer', 'solution', 'level', 'structure'] as const;
export const AiFixFieldSchema = z.enum(AI_FIX_FIELDS);
export type AiFixField = z.infer<typeof AiFixFieldSchema>;

/**
 * Saving from the fix panel. `ai` is set when the form holds values an AI suggestion filled in: it names the
 * fields whose saved value is exactly what the AI returned, so the server tags them as AI-filled. A field
 * the operator changed after the suggestion is not listed — it is the operator's value, not the AI's.
 */
export const AiFillClaimSchema = z.object({
  fields: z.array(AiFixFieldSchema).min(1),
  model: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type AiFillClaim = z.infer<typeof AiFillClaimSchema>;

export const ApplyFixRequestSchema = z.object({
  fix: QuestionFixSchema,
  ai: AiFillClaimSchema.optional(),
});
export type ApplyFixRequest = z.infer<typeof ApplyFixRequestSchema>;

/**
 * Corrections a rule can make with no human judgement, applied to every affected question at once. Each is
 * a pure rewrite of one field: the standard spelling of a question type, the repair of a control character
 * that was once a backslash command, or an answer label rewritten to the labels its options actually use.
 */
export const BULK_FIX_PLANS = [
  'question_type_spelling',
  'latex_corrupted_escape',
  'latex_wrap_math',
  'option_labels_to_letters',
  'answer_option_label',
] as const;
export const BulkFixPlanIdSchema = z.enum(BULK_FIX_PLANS);
export type BulkFixPlanId = z.infer<typeof BulkFixPlanIdSchema>;

/** One proposed change, shown in the preview before anything is written. */
export const BulkFixSampleSchema = z.object({
  questionId: z.string(),
  field: z.string(),
  // The question's stored type, so the preview says what kind of question is being rewritten.
  questionType: z.string().nullable(),
  subject: z.string().nullable(),
  before: z.string(),
  after: z.string(),
});
export type BulkFixSample = z.infer<typeof BulkFixSampleSchema>;

/** One distinct rewrite the plan makes, and how many questions it applies to. */
export const BulkFixGroupSchema = z.object({
  field: z.string(),
  before: z.string(),
  after: z.string(),
  questions: z.number().int().positive(),
});
export type BulkFixGroup = z.infer<typeof BulkFixGroupSchema>;

export const BulkFixPlanSchema = z.object({
  plan: BulkFixPlanIdSchema,
  label: z.string(),
  description: z.string(),
  /** Questions the plan would change. */
  affected: z.number().int().nonnegative(),
  /**
   * Every distinct rewrite, commonest first — the full mapping for a plan that rewrites values from a small
   * vocabulary ("Subjective" → subjective, ×1,238). Empty when the rewrites are all one-off (free text like
   * LaTeX), where a list of thousands of unique rows would say nothing and `samples` is shown instead.
   */
  groups: z.array(BulkFixGroupSchema),
  samples: z.array(BulkFixSampleSchema),
});
export type BulkFixPlan = z.infer<typeof BulkFixPlanSchema>;

export const BulkFixPreviewSchema = z.object({ plans: z.array(BulkFixPlanSchema) });
export type BulkFixPreview = z.infer<typeof BulkFixPreviewSchema>;

/** The result of running a plan: how many questions were rewritten. A scan then refreshes the counts. */
export const BulkFixResultSchema = z.object({
  plan: BulkFixPlanIdSchema,
  applied: z.number().int().nonnegative(),
});
export type BulkFixResult = z.infer<typeof BulkFixResultSchema>;

/**
 * What the AI may fill in on one question. Each maps to a field and to its own editable prompt block, so
 * an operator can ask for just the topic, or for everything the question is missing.
 */

/** Ask the AI to work out one question's missing metadata. Nothing is written by this call. */
export const AiFixRequestSchema = z.object({
  fields: z.array(AiFixFieldSchema).min(1),
  /**
   * True when a reviewer has confirmed the stored question type: the AI is told its answer must fit it
   * (one label for single-correct, a number for integer). Used to re-ask after an answer that did not fit.
   */
  respectType: z.boolean().default(false),
});
export type AiFixRequest = z.infer<typeof AiFixRequestSchema>;

/**
 * What the AI rebuilt of a question's structure: the match table of a matrix question whose matching survived
 * only as answer text, or the shared passage of a comprehension group that lost it. Exactly one is filled —
 * the other is null, because a question is one or the other.
 */
export const AiStructureSchema = z.object({
  match: MatchDataSchema.nullable(),
  passage: z.string().nullable(),
});
export type AiStructure = z.infer<typeof AiStructureSchema>;

/**
 * A reason the AI's answer does not fit the question as stored — it names several options on a single-correct
 * question, a label the options do not have, or text on an integer question. Checked with the same rules a
 * scan uses. Such an answer is never applied in bulk: someone decides whether the answer or the type is wrong.
 */
export const AnswerWarningSchema = z.object({
  kind: AnomalyKindSchema,
  detail: z.string(),
});
export type AnswerWarning = z.infer<typeof AnswerWarningSchema>;

/**
 * The AI's proposal for one question. Every field is null unless it was asked for AND the model could
 * decide it — an unsolvable question comes back with nulls and a note, never a guess. `topic` is always
 * one of the topics the server offered; anything else is rejected server-side.
 */
export const AiFixSuggestionSchema = z.object({
  topic: z.string().nullable(),
  answer: z.string().nullable(),
  solution: z.string().nullable(),
  level: QuestionLevelSchema.nullable(),
  /** 0–1, the model's own confidence in what it returned. */
  confidence: z.number().min(0).max(1),
  /** Why it could not decide something, or what it assumed — shown next to the suggestion. */
  notes: z.string(),
  /** True when the question's figure was sent with it, so a diagram-dependent answer is trustworthy. */
  usedImage: z.boolean(),
  /** How many topics were offered — from the question's exam, subject and chapter only. */
  topicChoices: z.number().int().nonnegative(),
  /**
   * Those topics themselves, so the panel can offer them for picking by hand when the model's choice was
   * rejected (or when you disagree with it). Empty unless a topic was asked for.
   */
  topicOptions: z.array(z.string()),
  /**
   * Where those topics came from in Question taxonomy, e.g. "Physics › Thermodynamics". Null when no topic
   * was matched (not asked for, or blocked — the reason is in `notes`).
   */
  topicScope: z.string().nullable(),
  /** The model that answered — recorded on the question if this suggestion is saved. */
  model: z.string(),
  /** Where the suggested answer conflicts with the stored question type or options. Empty when it fits. */
  answerWarnings: z.array(AnswerWarningSchema),
  /** The rebuilt structure, or null when none was asked for (or the AI could not rebuild it). */
  structure: AiStructureSchema.nullable(),
  /**
   * Doubts about that structure, in plain words — the rebuilt matching disagrees with the answer already
   * stored, or a column entry is not in the question. Non-empty means a person must check it before applying.
   */
  structureWarnings: z.array(z.string()),
});
export type AiFixSuggestion = z.infer<typeof AiFixSuggestionSchema>;

/**
 * One question's AI proposal, parked for review. The bank is NOT written when a proposal is made: a batch
 * run produces these, an operator approves what is right, and only then is it applied. `current*` is what
 * the bank holds today, so the review reads as before → after.
 */
export const AiProposalSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  questionNumber: z.number().int().nullable(),
  preview: z.string(),
  fields: z.array(AiFixFieldSchema),
  topic: z.string().nullable(),
  answer: z.string().nullable(),
  solution: z.string().nullable(),
  level: QuestionLevelSchema.nullable(),
  currentTopic: z.string().nullable(),
  currentAnswer: z.string().nullable(),
  currentLevel: QuestionLevelSchema.nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  usedImage: z.boolean(),
  /** The model that produced it; null on proposals made before this was recorded. */
  model: z.string().nullable().default(null),
  /** The question's type as stored NOW (read live when proposals are listed). */
  questionType: z.string().nullable().default(null),
  /** The rebuilt match table or passage, when the run was asked for structure. */
  structure: AiStructureSchema.nullable().default(null),
  /** Doubts about that structure; non-empty keeps the proposal out of every bulk apply. */
  structureWarnings: z.array(z.string()).default([]),
  /** Where the proposed answer conflicts with the question as stored now. Non-empty = needs a human decision. */
  answerWarnings: z.array(AnswerWarningSchema).default([]),
  /** `pending` awaits a decision; `applied` was written to the bank; `rejected` was declined. */
  status: z.enum(['pending', 'applied', 'rejected']),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type AiProposal = z.infer<typeof AiProposalSchema>;

/** Questions one batch may cover. Small enough to watch, big enough to make progress. */
export const AI_BATCH_SIZE = 25;

/**
 * Run the AI over the next slice of the CURRENT selection. The same filters as the anomaly list choose
 * which questions; `cursor` walks the selection so a long run is a series of short requests the operator
 * can watch and stop.
 */
export const AiBatchRequestSchema = z.object({
  fields: z.array(AiFixFieldSchema).min(1),
  filters: AnomalyListQuerySchema.omit({ cursor: true, limit: true }),
  /**
   * False (the default) means FILL ONLY WHAT IS EMPTY: a field a question already has is left alone and not
   * even sent to the model, so a run to fill missing topics can never rewrite an answer that was already
   * there. True is for the rules where the stored value is the defect — an answer naming a label the options
   * do not have, a topic that just repeats the chapter.
   */
  overwrite: z.boolean().default(false),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().positive().max(AI_BATCH_SIZE).default(AI_BATCH_SIZE),
});
export type AiBatchRequest = z.infer<typeof AiBatchRequestSchema>;

/** What one batch did, and where the next one starts (null when the selection is exhausted). */
export const AiBatchResultSchema = z.object({
  processed: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Questions the AI could not decide anything for — counted, not parked. */
  undecided: z.number().int().nonnegative(),
  /** Questions skipped because every requested field already had a value (and overwrite was off). */
  skipped: z.number().int().nonnegative(),
  /**
   * Topic-only questions not sent to the AI because their topic cannot be matched yet: no subject set, or
   * their subject has no chapters with topics in Question taxonomy. Fix one of those and run again.
   */
  blocked: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  /** Questions still matching the selection, so the UI can show "75 of 200". */
  remaining: z.number().int().nonnegative(),
});
export type AiBatchResult = z.infer<typeof AiBatchResultSchema>;

export const AiProposalPageSchema = z.object({
  proposals: z.array(AiProposalSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  /** Pending proposals (across ALL pages) whose answer does not fit their question — the ones to resolve by hand. */
  needsDecision: z.number().int().nonnegative().default(0),
});
export type AiProposalPage = z.infer<typeof AiProposalPageSchema>;

/**
 * Approve or decline proposals. Either name them by id, or take every pending one at or above a confidence
 * — the "approve everything above 80%" pass.
 */
export const DecideProposalsSchema = z
  .object({
    action: z.enum(['apply', 'reject']),
    ids: z.array(z.string()).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    /**
     * How a reviewer settled a proposal whose answer did not fit the question (one proposal at a time): the
     * answer they picked instead, and/or the question type they corrected. Without it, such a proposal is
     * skipped rather than applied.
     */
    resolve: z
      .object({
        answer: z.string().trim().min(1).optional(),
        questionType: z.string().trim().min(1).optional(),
      })
      .refine((r) => r.answer !== undefined || r.questionType !== undefined, { message: 'Give an answer or a question type.' })
      .optional(),
  })
  .refine((body) => body.ids !== undefined || body.minConfidence !== undefined, {
    message: 'Name the proposals by id, or give a minimum confidence.',
  })
  .refine((body) => body.resolve === undefined || (body.action === 'apply' && body.ids?.length === 1), {
    message: 'A resolution applies to exactly one proposal.',
  });
export type DecideProposals = z.infer<typeof DecideProposalsSchema>;

export const DecideProposalsResultSchema = z.object({
  applied: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Skipped because the answer does not fit the question type or options — each needs resolving on its card. */
  conflicts: z.number().int().nonnegative(),
});
export type DecideProposalsResult = z.infer<typeof DecideProposalsResultSchema>;

/** Per-rule counts across the three statuses. */
export const AnomalyKindCountSchema = z.object({
  kind: AnomalyKindSchema,
  open: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
});
export type AnomalyKindCount = z.infer<typeof AnomalyKindCountSchema>;

/**
 * The dashboard header: status totals, how many distinct questions have an open anomaly, per-rule
 * counts, the subject/chapter values present for the filter dropdowns, and the most recent scan.
 */
export const QualitySummarySchema = z.object({
  open: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  questionsWithOpen: z.number().int().nonnegative(),
  byKind: z.array(AnomalyKindCountSchema),
  // Where the open problems sit, for the dashboard's at-a-glance breakdown: every subject, and the worst
  // chapters. `questions` counts distinct questions, so a question with five problems is counted once.
  bySubject: z.array(z.object({ name: z.string(), open: z.number().int().nonnegative(), questions: z.number().int().nonnegative() })),
  byChapter: z.array(z.object({ name: z.string(), open: z.number().int().nonnegative(), questions: z.number().int().nonnegative() })),
  subjects: z.array(z.string()),
  chapters: z.array(z.string()),
  lastScan: QualityScanSchema.nullable(),
});
export type QualitySummary = z.infer<typeof QualitySummarySchema>;

/**
 * How much of the live bank holds AI-written data: questions with at least one AI-filled field, and the
 * count per field. Read straight off the bank rows' `ai_filled` tags, so it reflects what is live now.
 */
export const AiFilledSummarySchema = z.object({
  questions: z.number().int().nonnegative(),
  byField: z.object({
    topic: z.number().int().nonnegative(),
    answer: z.number().int().nonnegative(),
    solution: z.number().int().nonnegative(),
    level: z.number().int().nonnegative(),
    structure: z.number().int().nonnegative(),
  }),
});
export type AiFilledSummary = z.infer<typeof AiFilledSummarySchema>;
