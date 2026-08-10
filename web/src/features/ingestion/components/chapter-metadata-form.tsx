import { type JSX } from 'react';
import { Combobox } from '../../../shared/ui/index.js';
import { useChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import { cascadeMetadata } from '../lib/metadata-cascade.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

type ChapterMetadataFormProps = {
  value: ChapterMetadataDraft;
  onChange: (patch: Partial<ChapterMetadataDraft>) => void;
};

/**
 * The metadata that files a chapter into Drive: exam → subject → module → chapter (the folder path
 * the backend auto-creates), plus section name and question type. Every field is a searchable,
 * creatable Combobox seeded with the shared {@link useChapterVocabulary} suggestions — and the
 * exam→subject→module→chapter→section fields are *dependent*: each offers only the children of the
 * value chosen above it, and changing a parent clears any descendant it no longer allows.
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
          onChange={(next) => { onChange(cascadeMetadata('exam', next, value, suggestions)); }}
        />
      </label>

      <label className="field">
        <span>Subject</span>
        <Combobox
          value={value.subject}
          options={suggestions.subjectsFor(value.exam)}
          placeholder="e.g. Physics"
          onChange={(next) => { onChange(cascadeMetadata('subject', next, value, suggestions)); }}
        />
      </label>

      <label className="field">
        <span>Module</span>
        <Combobox
          value={value.module}
          options={suggestions.modulesFor(value.subject)}
          placeholder="e.g. Allen"
          onChange={(next) => { onChange(cascadeMetadata('module', next, value, suggestions)); }}
        />
      </label>

      <label className="field">
        <span>Chapter</span>
        <Combobox
          value={value.chapter}
          options={suggestions.chaptersFor(value.module)}
          placeholder="e.g. Kinematics"
          onChange={(next) => { onChange(cascadeMetadata('chapter', next, value, suggestions)); }}
        />
      </label>

      <label className="field">
        <span>Section</span>
        <Combobox
          value={value.sectionName}
          options={suggestions.sectionsFor(value.module, value.chapter)}
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
