import { type JSX } from 'react';
import { KNOWN_QUESTION_TYPES } from '@ingest/contracts';
import { Combobox, IconButton, IconTrash, IconX } from '../../../shared/ui/index.js';
import type { TopicDraft, TopicTypeDraft } from '../types/chapter-group.js';
import type { PageRange } from '../lib/build-chapter-pdfs.js';
import { makeId } from '../lib/make-id.js';

type TopicConfigEditorProps = {
  topics: TopicDraft[];
  /** The chapter's source-page range — topic blocks must stay inside it. */
  range: PageRange;
  onChange: (topics: TopicDraft[]) => void;
};

/**
 * A fresh question-type block: type unpicked, spanning the first pages no existing block covers yet
 * (so consecutive blocks tile the chapter without manual re-typing).
 */
function nextTypeBlock(range: PageRange, existing: TopicTypeDraft[]): TopicTypeDraft {
  const lastTo = existing.reduce((max, block) => Math.max(max, block.to), 0);
  const from = Math.min(Math.max(lastTo + 1, range.from), range.to);
  return { id: makeId(), questionType: '', from, to: range.to };
}

/**
 * Edit a chapter's optional topic structure: topics, each holding question-type blocks that bind a
 * source-page span to one PREDEFINED question type (pick-only — the config can never carry an
 * invented type, which is the whole point: extraction follows this map instead of classifying).
 */
export function TopicConfigEditor({ topics, range, onChange }: TopicConfigEditorProps): JSX.Element {
  const allBlocks = topics.flatMap((topic) => topic.types);

  const updateTopic = (id: string, patch: Partial<TopicDraft>): void => {
    onChange(topics.map((topic) => (topic.id === id ? { ...topic, ...patch } : topic)));
  };

  const updateType = (topicId: string, typeId: string, patch: Partial<TopicTypeDraft>): void => {
    onChange(
      topics.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              types: topic.types.map((block) =>
                block.id === typeId ? { ...block, ...patch } : block,
              ),
            }
          : topic,
      ),
    );
  };

  const addTopic = (): void => {
    onChange([...topics, { id: makeId(), name: '', types: [nextTypeBlock(range, allBlocks)] }]);
  };

  const removeTopic = (id: string): void => {
    onChange(topics.filter((topic) => topic.id !== id));
  };

  const addType = (topic: TopicDraft): void => {
    updateTopic(topic.id, { types: [...topic.types, nextTypeBlock(range, allBlocks)] });
  };

  const removeType = (topic: TopicDraft, typeId: string): void => {
    updateTopic(topic.id, { types: topic.types.filter((block) => block.id !== typeId) });
  };

  return (
    <div className="stack stack--tight">
      <div className="topic-editor__head">
        <span className="muted">Topics</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={addTopic}>
          + Add topic
        </button>
      </div>

      {topics.length === 0 ? (
        <p className="topic-editor__hint">
          Optional — without topics the chapter uploads as one unit. Add topics to bind page ranges
          to predefined question types, so extraction follows your map and never invents a type.
        </p>
      ) : null}

      {topics.map((topic, index) => (
        <div key={topic.id} className="topic-card">
          <div className="topic-card__head">
            <span className="topic-card__label">Topic {index + 1}</span>
            <input
              type="text"
              value={topic.name}
              placeholder="Topic name — e.g. Projectile motion"
              aria-label={`Topic ${String(index + 1)} name`}
              onChange={(event) => { updateTopic(topic.id, { name: event.target.value }); }}
            />
            <IconButton
              icon={<IconTrash />}
              label={`Remove topic ${String(index + 1)}`}
              variant="danger"
              size="sm"
              onClick={() => { removeTopic(topic.id); }}
            />
          </div>

          <div className="stack stack--tight">
            {topic.types.map((block) => (
              <div key={block.id} className="topic-card__type">
                <div className="topic-card__type-select">
                  <Combobox
                    value={block.questionType}
                    options={KNOWN_QUESTION_TYPES}
                    allowCustom={false}
                    placeholder="Question type…"
                    onChange={(next) => { updateType(topic.id, block.id, { questionType: next }); }}
                  />
                </div>
                <label className="field field--inline">
                  <span>Pages</span>
                  <input
                    type="number"
                    min={range.from}
                    max={range.to}
                    value={block.from}
                    onChange={(event) => {
                      updateType(topic.id, block.id, { from: Number(event.target.value) });
                    }}
                  />
                </label>
                <label className="field field--inline">
                  <span>to</span>
                  <input
                    type="number"
                    min={range.from}
                    max={range.to}
                    value={block.to}
                    onChange={(event) => {
                      updateType(topic.id, block.id, { to: Number(event.target.value) });
                    }}
                  />
                </label>
                <IconButton
                  icon={<IconX />}
                  label="Remove question type"
                  size="sm"
                  disabled={topic.types.length === 1}
                  onClick={() => { removeType(topic, block.id); }}
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--xs self-start"
              onClick={() => { addType(topic); }}
            >
              + Add question type
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
