import { SyllabusFileSchema, type SyllabusFile, type SyllabusUpload } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { nameKey } from './syllabus-names.js';

/** Several aliases in one CSV cell are separated by this, because a comma already separates columns. */
const ALIAS_SEPARATOR = '|';

/** The CSV columns, in the order the sample writes them. `required` ones must appear in the header. */
export const CSV_COLUMNS = [
  { column: 'exam', required: true, description: 'The exam this row belongs to, e.g. NEET. Several exams in one file are allowed.' },
  { column: 'subject', required: true, description: 'Subject within the exam, e.g. Biology.' },
  { column: 'chapter', required: true, description: 'Chapter within the subject, e.g. Animal Kingdom.' },
  { column: 'topic', required: true, description: 'One topic. Write one row per topic — exam, subject and chapter repeat.' },
  { column: 'title', required: false, description: 'A name for the whole syllabus, e.g. "NEET 2026 Biology". Read from the first row of each exam.' },
  { column: 'class', required: false, description: 'NCERT class for the chapter (11 or 12). Leave blank when it has none.' },
  { column: 'exam_aliases', required: false, description: `Other names the bank stores for this exam, separated by ${ALIAS_SEPARATOR}.` },
  { column: 'subject_aliases', required: false, description: `Other names for this subject, separated by ${ALIAS_SEPARATOR}.` },
  { column: 'chapter_aliases', required: false, description: `Other names for this chapter — the bank's coaching-style names, separated by ${ALIAS_SEPARATOR}.` },
] as const;

const REQUIRED_COLUMNS = CSV_COLUMNS.filter((column) => column.required).map((column) => column.column);

/**
 * Split CSV text into rows of cells: double quotes protect commas, newlines and doubled quotes inside a
 * cell, which matters because topics carry commas and semicolons. Blank lines are dropped.
 */
function splitCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = (): void => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content.charAt(index);
    if (quoted) {
      if (char !== '"') cell += char;
      else if (content.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') endCell();
    else if (char === '\n') endRow();
    else if (char !== '\r') cell += char;
  }
  endRow();
  return rows;
}

function splitAliases(cell: string | undefined): string[] {
  return (cell ?? '').split(ALIAS_SEPARATOR).map((alias) => alias.trim()).filter((alias) => alias !== '');
}

/** Merge aliases seen on later rows of the same exam/subject/chapter, keeping the first spelling of each. */
function mergeAliases(into: string[], adding: readonly string[]): void {
  for (const alias of adding) {
    if (!into.some((existing) => nameKey(existing) === nameKey(alias))) into.push(alias);
  }
}

/**
 * Read a flat CSV — one row per topic, with exam/subject/chapter repeated — into one authored syllabus per
 * exam. Rows are grouped in the order they appear, so the file's order is the order the screen shows.
 */
function parseCsv(content: string): unknown[] {
  const [header, ...rows] = splitCsv(content);
  if (!header) throw errors.syllabusUploadInvalid('the CSV file is empty.');

  const columns = new Map(header.map((name, position) => [name.toLowerCase().replace(/\s+/g, '_'), position] as const));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw errors.syllabusUploadInvalid(
      `the CSV header is missing ${missing.join(', ')}. It needs at least: ${REQUIRED_COLUMNS.join(', ')}.`,
    );
  }
  if (rows.length === 0) throw errors.syllabusUploadInvalid('the CSV file has a header but no rows.');

  const cell = (row: string[], column: string): string => {
    const position = columns.get(column);
    return position === undefined ? '' : (row[position] ?? '');
  };

  type Chapter = { chapter: string; class: number | null; aliases: string[]; topics: string[] };
  type Subject = { subject: string; aliases: string[]; chapters: Chapter[]; byChapter: Map<string, Chapter> };
  type Exam = { exam: string; title: string; aliases: string[]; subjects: Subject[]; bySubject: Map<string, Subject> };
  const exams = new Map<string, Exam>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const examName = cell(row, 'exam');
    const subjectName = cell(row, 'subject');
    const chapterName = cell(row, 'chapter');
    const topic = cell(row, 'topic');
    for (const [label, value] of [['exam', examName], ['subject', subjectName], ['chapter', chapterName], ['topic', topic]] as const) {
      if (value === '') throw errors.syllabusUploadInvalid(`row ${String(line)} has no ${label}.`);
    }

    let exam = exams.get(nameKey(examName));
    if (!exam) {
      exam = { exam: examName, title: cell(row, 'title') || `${examName} syllabus`, aliases: [], subjects: [], bySubject: new Map() };
      exams.set(nameKey(examName), exam);
    }
    mergeAliases(exam.aliases, splitAliases(cell(row, 'exam_aliases')));

    let subject = exam.bySubject.get(nameKey(subjectName));
    if (!subject) {
      subject = { subject: subjectName, aliases: [], chapters: [], byChapter: new Map() };
      exam.bySubject.set(nameKey(subjectName), subject);
      exam.subjects.push(subject);
    }
    mergeAliases(subject.aliases, splitAliases(cell(row, 'subject_aliases')));

    let chapter = subject.byChapter.get(nameKey(chapterName));
    if (!chapter) {
      const classCell = cell(row, 'class');
      chapter = { chapter: chapterName, class: classCell === '' ? null : Number(classCell), aliases: [], topics: [] };
      if (chapter.class !== null && !Number.isInteger(chapter.class)) {
        throw errors.syllabusUploadInvalid(`row ${String(line)} has class "${classCell}", which is not a whole number.`);
      }
      subject.byChapter.set(nameKey(chapterName), chapter);
      subject.chapters.push(chapter);
    }
    mergeAliases(chapter.aliases, splitAliases(cell(row, 'chapter_aliases')));
    if (!chapter.topics.some((existing) => nameKey(existing) === nameKey(topic))) chapter.topics.push(topic);
  });

  return [...exams.values()].map((exam) => ({
    exam: exam.exam,
    title: exam.title,
    aliases: exam.aliases,
    subjects: exam.subjects.map((subject) => ({
      subject: subject.subject,
      aliases: subject.aliases,
      chapters: subject.chapters.map((chapter) => ({
        chapter: chapter.chapter,
        class: chapter.class,
        aliases: chapter.aliases,
        topics: chapter.topics,
      })),
    })),
  }));
}

function parseJson(content: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw errors.syllabusUploadInvalid(`the file is not valid JSON — ${message}`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Read an upload into one authored syllabus per exam it names. Every problem is reported as one clear
 * message the operator can act on — which row, which field — rather than a zod dump.
 */
export function parseSyllabusUpload(upload: SyllabusUpload): SyllabusFile[] {
  const candidates = upload.format === 'csv' ? parseCsv(upload.content) : parseJson(upload.content);
  if (candidates.length === 0) throw errors.syllabusUploadInvalid('the file describes no exam.');

  const files = candidates.map((candidate, index) => {
    const parsed = SyllabusFileSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const at = issue?.path.join('.') ?? '';
      const which = candidates.length > 1 ? `exam ${String(index + 1)}: ` : '';
      throw errors.syllabusUploadInvalid(`${which}${at === '' ? '' : `${at} — `}${issue?.message ?? 'the file does not match the format.'}`);
    }
    return parsed.data;
  });

  const seen = new Set<string>();
  for (const file of files) {
    const key = nameKey(file.exam);
    if (seen.has(key)) throw errors.syllabusUploadInvalid(`the file describes "${file.exam}" twice.`);
    seen.add(key);
  }
  return files;
}
