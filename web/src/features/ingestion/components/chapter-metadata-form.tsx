import { type JSX, useMemo } from 'react';
import { KNOWN_EXAMS, KNOWN_MODULES, KNOWN_QUESTION_TYPES } from '@ingest/contracts';
import { Combobox } from '../../../shared/ui/index.js';
import { useDocuments } from '../../documents/index.js';
import { useDriveVocabulary } from '../../drive-folders/index.js';
import { useSessions } from '../../sessions/index.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

type ChapterMetadataFormProps = {
  value: ChapterMetadataDraft;
  onChange: (patch: Partial<ChapterMetadataDraft>) => void;
};

function distinct(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * The metadata that files a chapter into Drive: exam → subject → module → chapter (the folder path
 * the backend auto-creates), plus section name and question type. Every field is a searchable,
 * creatable Combobox seeded with the known defaults, the values already used across existing
 * documents/sessions, and everything created in the All Masters Drive tree (empty when Drive is
 * not configured — the document-derived suggestions still work).
 */
export function ChapterMetadataForm({ value, onChange }: ChapterMetadataFormProps): JSX.Element {
  const documents = useDocuments();
  const sessions = useSessions();
  const driveVocabulary = useDriveVocabulary();

  const suggestions = useMemo(() => {
    const docs = documents.data?.items ?? [];
    const sess = sessions.data?.items ?? [];
    const drive = driveVocabulary.data;
    return {
      exams: distinct([...KNOWN_EXAMS, ...sess.map((s) => s.exam), ...(drive?.exams ?? [])]),
      subjects: distinct([...sess.map((s) => s.subject), ...(drive?.subjects ?? [])]),
      modules: distinct([
        ...KNOWN_MODULES,
        ...sess.map((s) => s.module),
        ...docs.map((d) => d.path.module),
        ...(drive?.modules ?? []),
      ]),
      chapters: distinct([...docs.map((d) => d.path.chapter), ...(drive?.chapters ?? [])]),
      sections: distinct([...docs.map((d) => d.path.section), ...docs.map((d) => d.sectionName)]),
      questionTypes: distinct([...KNOWN_QUESTION_TYPES, ...docs.map((d) => d.questionType)]),
    };
  }, [documents.data, sessions.data, driveVocabulary.data]);

  return (
    <div className="metadata-form">
      <label className="field">
        <span>Exam</span>
        <Combobox
          value={value.exam}
          options={suggestions.exams}
          placeholder="e.g. JEE"
          onChange={(next) => { onChange({ exam: next }); }}
        />
      </label>

      <label className="field">
        <span>Subject</span>
        <Combobox
          value={value.subject}
          options={suggestions.subjects}
          placeholder="e.g. Physics"
          onChange={(next) => { onChange({ subject: next }); }}
        />
      </label>

      <label className="field">
        <span>Module</span>
        <Combobox
          value={value.module}
          options={suggestions.modules}
          placeholder="e.g. Allen"
          onChange={(next) => { onChange({ module: next }); }}
        />
      </label>

      <label className="field">
        <span>Chapter</span>
        <Combobox
          value={value.chapter}
          options={suggestions.chapters}
          placeholder="e.g. Kinematics"
          onChange={(next) => { onChange({ chapter: next }); }}
        />
      </label>

      <label className="field">
        <span>Section</span>
        <Combobox
          value={value.sectionName}
          options={suggestions.sections}
          placeholder="e.g. Exercise-1"
          onChange={(next) => { onChange({ sectionName: next }); }}
        />
      </label>

      <label className="field">
        <span>Question type</span>
        <Combobox
          value={value.questionType}
          options={suggestions.questionTypes}
          placeholder="e.g. single_correct"
          onChange={(next) => { onChange({ questionType: next }); }}
        />
      </label>
    </div>
  );
}
