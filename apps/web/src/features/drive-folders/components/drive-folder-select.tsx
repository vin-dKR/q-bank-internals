import { type JSX, useState } from 'react';
import type { DriveFolder } from '@ingest/contracts';
import { useCreateFolder, useDriveFolders } from '../hooks/use-drive-folders.js';

type DriveFolderSelectProps = {
  /** The currently-selected folder id, or null. */
  value: string | null;
  /** Called with the chosen (or newly-created) folder id. */
  onChange: (folderId: string) => void;
  /** Parent folder to browse under; omit for the configured root. */
  parentId?: string | undefined;
  /** Short label for this level (e.g. "Exam", "Chapter"). */
  label: string;
  /** Disable when a required parent above this level has not been chosen yet. */
  disabled?: boolean | undefined;
};

/**
 * One level of the Drive chapter tree: pick an existing sub-folder or create a new one inline.
 * Reused at each level (exam → subject → module → chapter); creating a folder selects it.
 */
export function DriveFolderSelect({
  value,
  onChange,
  parentId,
  label,
  disabled = false,
}: DriveFolderSelectProps): JSX.Element {
  const { data, isPending, isError } = useDriveFolders(disabled ? undefined : parentId);
  const createFolder = useCreateFolder();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = (): void => {
    const name = newName.trim();
    if (!name) return;
    createFolder.mutate(
      { name, ...(parentId ? { parentId } : {}) },
      {
        onSuccess: (folder: DriveFolder) => {
          onChange(folder.id);
          setCreating(false);
          setNewName('');
        },
      },
    );
  };

  return (
    <div className="folder-select">
      <label className="folder-select__label">{label}</label>

      {disabled ? (
        <p className="muted">Choose the level above first.</p>
      ) : isError ? (
        <p className="error">Could not load folders. Is Drive configured?</p>
      ) : (
        <div className="folder-select__row">
          <select
            value={value ?? ''}
            disabled={isPending}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          >
            <option value="" disabled>
              {isPending ? 'Loading…' : 'Select a folder…'}
            </option>
            {(data ?? []).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setCreating((prev) => !prev);
            }}
          >
            {creating ? 'Cancel' : '+ New'}
          </button>
        </div>
      )}

      {creating && !disabled ? (
        <div className="folder-select__row">
          <input
            type="text"
            value={newName}
            placeholder={`New ${label.toLowerCase()} folder name`}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCreate();
              }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={createFolder.isPending || !newName.trim()}
            onClick={handleCreate}
          >
            {createFolder.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      ) : null}

      {createFolder.isError ? <p className="error">Could not create the folder.</p> : null}
    </div>
  );
}
