import { type JSX } from 'react';
import { Combobox } from '../../../shared/ui/index.js';
import { useChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

type ChapterMetadataFormProps = {
  value: ChapterMetadataDraft;
  onChange: (patch: Partial<ChapterMetadataDraft>) => void;
};

/**
 * The metadata that files a chapter into Drive: exam → subject → module → chapter (the folder path
 * the backend auto-creates), plus section name and question type. Every field is a searchable,
 * creatable Combobox seeded with the shared {@link useChapterVocabulary} suggestions.
 */
export function ChapterMetadataForm({ value, onChange }: ChapterMetadataFormProps): JSX.Element {
  const suggestions = useChapterVocabulary();

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
