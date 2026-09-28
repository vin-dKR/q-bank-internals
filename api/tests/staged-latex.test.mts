import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Passage, Question, UpdateQuestion } from '@ingest/contracts';
import { QuestionsService } from '../src/modules/questions/questions.service.js';
import { detectLatexInField } from '../src/modules/quality/latex-rules.js';
import {
  automaticLatexRepair,
  fullyAutomaticLatexRepair,
  questionLatexPatch,
  stagedLatexFields,
  stagedLatexIssues,
} from '../src/modules/questions/staged-latex.js';

const rawFormula = String.raw`T_n \propto \frac{1}{n^2}`;
const proseFormula = String.raw`Find \frac{1}{2} of the total.`;
const legacyEquation = String.raw`2KI(aq) + Cl$_2$ \rightarrow 2KCl(aq) + I$_2$`;

function question(id: string, patch: Partial<Question> = {}): Question {
  return {
    id, documentId: 'doc', questionNumber: 1, stem: rawFormula,
    answer: proseFormula, explanation: null,
    options: [{ label: 'A', body: rawFormula }], match: null, questionType: null,
    ...patch,
  } as Question;
}

function fixture(refine: (text: string, issues?: readonly { kind: string; detail: string }[]) => Promise<string> = async (text) => `\\(${text}\\)`) {
  const rows = new Map<string, Question>([['q1', question('q1')]]);
  const passages = new Map<string, Passage>();
  const writes: { id: string; patch: UpdateQuestion }[] = [];
  const repository = {
    findByDocument: async () => [...rows.values()],
    findById: async (id: string) => rows.get(id) ?? null,
    findPassagesByDocument: async () => [...passages.values()],
    update: async (id: string, patch: UpdateQuestion) => {
      writes.push({ id, patch });
      const saved = { ...rows.get(id)!, ...patch } as Question;
      rows.set(id, saved);
      return saved;
    },
    updatePassage: async (id: string, patch: { text?: string }) => {
      const saved = { ...passages.get(id)!, ...patch } as Passage;
      passages.set(id, saved);
      return saved;
    },
  };
  const documents = { findById: async () => ({ id: 'doc', kind: 'question' }) };
  const refiner = { refine: async (text: string, issues?: readonly { kind: string; detail: string }[]) => ({
    text: await refine(text, issues),
    usage: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 1 },
  }) };
  const usage = { recordUsage: async () => undefined };
  type Deps = ConstructorParameters<typeof QuestionsService>;
  const service = new QuestionsService(
    repository as unknown as Deps[0], documents as unknown as Deps[1],
    {} as Deps[2], {} as Deps[3], refiner as Deps[4], usage as unknown as Deps[5],
    {} as Deps[6], {} as Deps[7], {} as Deps[8], {} as Deps[9],
  );
  return { service, rows, passages, writes };
}

test('session scan covers every rendered text field and stores a shared passage once', () => {
  const q = question('q1', {
    match: { columns: [{ label: 'List I', entries: [{ label: 'P', body: rawFormula }] }] } as Question['match'],
  });
  const passage = { id: 'p1', documentId: 'doc', text: rawFormula } as Passage;
  const fields = stagedLatexFields([q, question('q2')], [passage]);
  assert.deepEqual(fields.filter((field) => field.questionId === 'q1').map((field) => field.field),
    ['stem', 'answer', 'options.0', 'match.0.0']);
  assert.equal(fields.filter((field) => field.field === 'passage').length, 1);
  assert.ok(stagedLatexIssues(fields).some((issue) => issue.field === 'match.0.0'));
  assert.equal(stagedLatexIssues(stagedLatexFields([question('clean', { stem: 'Plain text', answer: '', options: [] })], [])).length, 0);
});

test('automatic rule wraps a whole formula and leaves prose for AI', () => {
  assert.equal(automaticLatexRepair(rawFormula), `\\(${rawFormula}\\)`);
  assert.equal(automaticLatexRepair(proseFormula), proseFormula);
  const patch = questionLatexPatch(question('q1'), 'options.0', 'fixed');
  assert.equal(patch?.options?.[0]?.label, 'A');
  assert.equal(patch?.options?.[0]?.body, 'fixed');
});

test('automatic repair merges legacy dollar fragments before wrapping a formula', async () => {
  const expected = String.raw`\(2KI(aq) + Cl_2 \rightarrow 2KCl(aq) + I_2\)`;
  assert.equal(automaticLatexRepair(legacyEquation), expected);
  const { service, rows } = fixture();
  rows.set('q1', question('q1', { stem: 'Plain question', answer: legacyEquation, options: [] }));
  assert.equal((await service.scanLatex('doc')).automaticFields, 1);
  const result = await service.fixLatexAutomatically('doc');
  assert.equal(result.updatedFields, 1);
  assert.deepEqual(result.failed, []);
  assert.equal(rows.get('q1')?.answer, expected);
  assert.equal((await service.scanLatex('doc')).issues.length, 0);
});

test('mixed prose and legacy dollar math is not offered as an automatic fix', () => {
  const mixed = String.raw`Find the value of $x^2$ using \frac{1}{2}.`;
  assert.equal(automaticLatexRepair(mixed), mixed);
  const issues = stagedLatexIssues(stagedLatexFields([question('q1', { stem: mixed, answer: '', options: [] })], []));
  assert.ok(issues.length > 0);
  assert.ok(issues.every((issue) => !issue.automatic));
});

test('scanner flags legacy single-dollar math in chemistry and answers without flagging currency', async () => {
  const examples = [
    'The electrode potential of F$_2$ is higher than Cl$_2$.',
    'Br: $-1, 0, +3, +5, +7$',
    'IBr$_2^-$: linear',
    'Find $x$ from the relation.',
  ];
  for (const answer of examples) {
    const findings = detectLatexInField('answer', answer);
    assert.ok(findings.some((finding) => finding.kind === 'latex_outside_delimiters'), answer);
  }
  assert.deepEqual(detectLatexInField('answer', 'The prices are $5 and $10.'), []);
  assert.deepEqual(detectLatexInField('answer', 'The price range is $5-$10.'), []);
  assert.deepEqual(detectLatexInField('answer', String.raw`The price is \$5.`), []);

  const { service, rows } = fixture();
  rows.set('q1', question('q1', { stem: 'Plain question', answer: examples[0]!, options: [] }));
  const scan = await service.scanLatex('doc');
  assert.equal(scan.aiFields, 1);
  assert.equal(scan.automaticFields, 0);
});

test('a partial code repair stays out of automatic fixes and leaves staged text unchanged', async () => {
  const partial = String.raw`\(` + '\t' + 'ext{m}';
  assert.notEqual(automaticLatexRepair(partial), partial);
  assert.equal(fullyAutomaticLatexRepair('stem', partial), null);
  let aiCalls = 0;
  const { service, rows, writes } = fixture(async () => {
    aiCalls += 1;
    throw new Error('AI must not run');
  });
  rows.set('q1', question('q1', { stem: partial, answer: '', options: [] }));
  const scan = await service.scanLatex('doc');
  assert.ok(scan.issues.length > 0);
  assert.ok(scan.issues.every((issue) => !issue.automatic));
  assert.equal(scan.automaticFields, 0);
  assert.deepEqual(await service.fixLatexAutomatically('doc'), { updatedFields: 0, failed: [] });
  assert.equal(writes.length, 0);
  assert.equal(aiCalls, 0);
  assert.equal(rows.get('q1')?.stem, partial);
});

test('automatic bulk repair fixes safe fields across questions without changing prose', async () => {
  const { service, rows } = fixture();
  rows.set('q2', question('q2', { questionNumber: 2 }));
  const scan = await service.scanLatex('doc');
  assert.equal(scan.questionCount, 2);
  assert.equal(scan.automaticFields, 4);
  const result = await service.fixLatexAutomatically('doc');
  assert.equal(result.updatedFields, 4);
  assert.deepEqual(result.failed, []);
  assert.equal(rows.get('q1')?.answer, proseFormula);
  assert.equal(rows.get('q2')?.stem, `\\(${rawFormula}\\)`);
  assert.equal((await service.scanLatex('doc')).aiFields, 2);
});

test('one AI batch repairs every selected field, preserving option metadata', async () => {
  const { service, rows, writes } = fixture(async (text) => text.replace(String.raw`\frac{1}{2}`, String.raw`\(\frac{1}{2}\)`));
  await service.fixLatexAutomatically('doc');
  const keys = [...new Set((await service.scanLatex('doc')).issues.map((issue) => issue.key))];
  const result = await service.fixLatexWithAi('doc', keys);
  assert.equal(result.updatedFields, 1);
  assert.deepEqual(result.failed, []);
  assert.equal((await service.scanLatex('doc')).issues.length, 0);
  assert.equal(rows.get('q1')?.options[0]?.label, 'A');
  assert.ok(writes.every((write) => write.id === 'q1'));
});

test('one AI batch fixes flagged fields in multiple questions', async () => {
  const { service, rows } = fixture(async (text) =>
    text.replace(String.raw`\frac{1}{2}`, String.raw`\(\frac{1}{2}\)`));
  rows.set('q2', question('q2', { questionNumber: 2 }));
  await service.fixLatexAutomatically('doc');
  const keys = [...new Set((await service.scanLatex('doc')).issues.map((issue) => issue.key))];
  const result = await service.fixLatexWithAi('doc', keys);
  assert.equal(result.updatedFields, 2);
  assert.equal(rows.get('q1')?.answer, rows.get('q2')?.answer);
  assert.equal((await service.scanLatex('doc')).issues.length, 0);
});

test('AI receives remaining scanner findings and cannot save a partial repair', async () => {
  const partial = String.raw`\(` + '\t' + 'ext{m}';
  const seen: { kind: string; detail: string }[][] = [];
  const { service, rows, writes } = fixture(async (text, issues) => {
    seen.push([...(issues ?? [])]);
    return text;
  });
  rows.set('q1', question('q1', { stem: partial, answer: '', options: [] }));
  const result = await service.fixLatexWithAi('doc', ['q:q1:stem']);
  assert.equal(seen.length, 1);
  assert.ok(seen[0]?.some((issue) => issue.kind === 'latex_unclosed_delimiter'));
  assert.ok(seen[0]?.some((issue) => issue.kind === 'latex_outside_delimiters'));
  assert.ok(seen[0]?.every((issue) => issue.kind !== 'latex_corrupted_escape'));
  assert.equal(result.updatedFields, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(writes.length, 0);
  assert.equal(rows.get('q1')?.stem, partial);
});

test('AI failure and a concurrent edit never overwrite staged text', async () => {
  const unchanged = fixture(async (text) => text);
  const key = 'q:q1:answer';
  const failed = await unchanged.service.fixLatexWithAi('doc', [key]);
  assert.equal(failed.updatedFields, 0);
  assert.equal(failed.failed.length, 1);
  assert.equal(unchanged.rows.get('q1')?.answer, proseFormula);

  const blank = fixture(async () => '');
  const blankResult = await blank.service.fixLatexWithAi('doc', [key]);
  assert.equal(blankResult.updatedFields, 0);
  assert.equal(blank.rows.get('q1')?.answer, proseFormula);

  let concurrent!: ReturnType<typeof fixture>;
  concurrent = fixture(async (text) => {
    concurrent.rows.set('q1', { ...concurrent.rows.get('q1')!, answer: 'Editor changed this' });
    return text.replace(String.raw`\frac{1}{2}`, String.raw`\(\frac{1}{2}\)`);
  });
  const result = await concurrent.service.fixLatexWithAi('doc', [key]);
  assert.equal(result.updatedFields, 0);
  assert.match(result.failed[0]?.message ?? '', /changed during the LaTeX fix/);
  assert.equal(concurrent.rows.get('q1')?.answer, 'Editor changed this');
  assert.equal(concurrent.writes.length, 0);
});
