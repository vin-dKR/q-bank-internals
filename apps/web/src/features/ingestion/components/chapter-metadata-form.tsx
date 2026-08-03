import { type JSX, useState } from 'react';
import { ExamSchema, KNOWN_QUESTION_TYPES, ModuleSchema } from '@ingest/contracts';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

const CUSTOM = '__custom__';

type ChapterMetadataFormProps = {
  value: ChapterMetadataDraft;
  onChange: (patch: Partial<ChapterMetadataDraft>) => void;
};

/**
 * The metadata that files a chapter into Drive: exam → subject → module → chapter (the folder path
 * the backend auto-creates), plus section name and a dynamic question type (known options or custom).
 */
export function ChapterMetadataForm({ value, onChange }: ChapterMetadataFormProps): JSX.Element {
  const knownTypes: readonly string[] = KNOWN_QUESTION_TYPES;
  const valueIsCustom = value.questionType !== '' && !knownTypes.includes(value.questionType);
  const [customMode, setCustomMode] = useState(valueIsCustom);
  const showCustom = customMode || valueIsCustom;

  return (
    <div className="metadata-form">
      <label className="field">
        <span>Exam</span>
        <select
          value={value.exam}
          onChange={(event) => { onChange({ exam: event.target.value as ChapterMetadataDraft['exam'] }); }}
        >
          <option value="" disabled>
            Select…
          </option>
          {ExamSchema.options.map((exam) => (
            <option key={exam} value={exam}>
              {exam}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Subject</span>
        <input
          type="text"
          value={value.subject}
          placeholder="e.g. Physics"
          onChange={(event) => { onChange({ subject: event.target.value }); }}
        />
      </label>

      <label className="field">
        <span>Module</span>
        <select
          value={value.module}
          onChange={(event) =>
            { onChange({ module: event.target.value as ChapterMetadataDraft['module'] }); }
          }
        >
          <option value="" disabled>
            Select…
          </option>
          {ModuleSchema.options.map((module) => (
            <option key={module} value={module}>
              {module}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Chapter</span>
        <input
          type="text"
          value={value.chapter}
          placeholder="e.g. Kinematics"
          onChange={(event) => { onChange({ chapter: event.target.value }); }}
        />
      </label>

      <label className="field">
        <span>Section</span>
        <input
          type="text"
          value={value.sectionName}
          placeholder="e.g. Exercise-1"
          onChange={(event) => { onChange({ sectionName: event.target.value }); }}
        />
      </label>

      <label className="field">
        <span>Question type</span>
        <select
          value={showCustom ? CUSTOM : value.questionType}
          onChange={(event) => {
            const next = event.target.value;
            if (next === CUSTOM) {
              setCustomMode(true);
              onChange({ questionType: '' });
            } else {
              setCustomMode(false);
              onChange({ questionType: next });
            }
          }}
        >
          <option value="" disabled>
            Select…
          </option>
          {KNOWN_QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>

      {showCustom ? (
        <label className="field">
          <span>Custom type</span>
          <input
            type="text"
            value={value.questionType}
            placeholder="e.g. assertion_reason"
            onChange={(event) => { onChange({ questionType: event.target.value }); }}
          />
        </label>
      ) : null}
    </div>
  );
}
