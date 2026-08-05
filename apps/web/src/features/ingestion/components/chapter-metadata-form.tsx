import { type JSX, useMemo } from 'react';
import { ExamSchema, KNOWN_QUESTION_TYPES, ModuleSchema } from '@ingest/contracts';
import { Combobox } from '../../../shared/ui/index.js';
import { useDocuments } from '../../documents/index.js';
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
 * the backend auto-creates), plus section name and question type. Every field is a searchable
 * Combobox — the fixed vocabularies (exam/module) pick-only, the open ones (subject/chapter/section/
 * question type) creatable, seeded with the values already used across existing documents/sessions.
 */
export function ChapterMetadataForm({ value, onChange }: ChapterMetadataFormProps): JSX.Element {
  const documents = useDocuments();
  const sessions = useSessions();

  const suggestions = useMemo(() => {
    const docs = documents.data?.items ?? [];
    const sess = sessions.data?.items ?? [];
    return {
      subjects: distinct(sess.map((s) => s.subject)),
      chapters: distinct(docs.map((d) => d.path.chapter)),
      sections: distinct([...docs.map((d) => d.path.section), ...docs.map((d) => d.sectionName)]),
      questionTypes: distinct([...KNOWN_QUESTION_TYPES, ...docs.map((d) => d.questionType)]),
    };
  }, [documents.data, sessions.data]);

  return (
    <div className="metadata-form">
      <label className="field">
        <span>Exam</span>
        <Combobox
          value={value.exam}
          options={ExamSchema.options}
          allowCustom={false}
          placeholder="Select exam…"
          onChange={(next) => { onChange({ exam: next as ChapterMetadataDraft['exam'] }); }}
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
          options={ModuleSchema.options}
          allowCustom={false}
          placeholder="Select module…"
          onChange={(next) => { onChange({ module: next as ChapterMetadataDraft['module'] }); }}
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
