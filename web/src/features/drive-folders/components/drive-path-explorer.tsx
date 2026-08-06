import { type JSX, useState } from 'react';
import { DriveFolderSelect } from './drive-folder-select.js';

/**
 * A cascading browse/create view of the Drive chapter tree (exam → subject → module → chapter).
 * Purely for visibility: it lets you pre-create or confirm the folders that uploads will file into.
 * The actual upload mapping is driven by each chapter's metadata (the backend ensures the path).
 */
export function DrivePathExplorer(): JSX.Element {
  const [exam, setExam] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [module, setModule] = useState<string | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);

  return (
    <div className="explorer__grid">
      <DriveFolderSelect
        label="Exam"
        value={exam}
        onChange={(id) => {
          setExam(id);
          setSubject(null);
          setModule(null);
          setChapter(null);
        }}
      />
      <DriveFolderSelect
        label="Subject"
        value={subject}
        parentId={exam ?? undefined}
        disabled={!exam}
        onChange={(id) => {
          setSubject(id);
          setModule(null);
          setChapter(null);
        }}
      />
      <DriveFolderSelect
        label="Module"
        value={module}
        parentId={subject ?? undefined}
        disabled={!subject}
        onChange={(id) => {
          setModule(id);
          setChapter(null);
        }}
      />
      <DriveFolderSelect
        label="Chapter"
        value={chapter}
        parentId={module ?? undefined}
        disabled={!module}
        onChange={setChapter}
      />
    </div>
  );
}
