import { type JSX, useState } from 'react';
import type { DriveFolder } from '@ingest/contracts';
import { ApiError } from '../../../shared/api/http-client.js';
import { IconButton, IconTrash, useConfirm, useToast } from '../../../shared/ui/index.js';
import { useCreateFolder, useDeleteFolder, useDriveFolders } from '../hooks/use-drive-folders.js';

type DriveFolderSelectProps = {
  /** The currently-selected folder id, or null. */
  value: string | null;
  /** Called with the chosen (or newly-created) folder id, or '' when the selection is cleared. */
  onChange: (folderId: string) => void;
  /** Parent folder to browse under; omit for the configured root. */
  parentId?: string | undefined;
  /** Short label for this level (e.g. "Exam", "Chapter"). */
  label: string;
  /** Disable when a required parent above this level has not been chosen yet. */
  disabled?: boolean | undefined;
};

/**
 * One level of the Drive chapter tree: pick an existing sub-folder, create a new one inline, or
 * delete the selected one. Reused at each level (exam → subject → module → chapter). Deletion is
 * irreversible, so it is always gated by a confirm dialog and a second, explicit confirm when the
 * folder still holds contents.
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
  const deleteFolder = useDeleteFolder();
  const [confirm, confirmDialog] = useConfirm();
  const { success } = useToast();
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

  const remove = (id: string, name: string, force: boolean): void => {
    deleteFolder.mutate(
      force ? { id, force: true } : { id },
      {
        onSuccess: () => {
          onChange('');
          success(`Deleted "${name}".`);
        },
        onError: (error) => {
          if (!force && error instanceof ApiError && error.code === 'DRIVE_FOLDER_NOT_EMPTY') {
            void confirmForceDelete(id, name);
          }
        },
      },
    );
  };

  const confirmForceDelete = async (id: string, name: string): Promise<void> => {
    const confirmed = await confirm({
      title: `"${name}" is not empty`,
      body: 'Delete this folder and everything inside it? This cannot be undone.',
      confirmLabel: 'Delete everything',
      cancelLabel: 'Keep folder',
      tone: 'danger',
    });
    if (confirmed) remove(id, name, true);
  };

  const handleDelete = async (): Promise<void> => {
    if (!value) return;
    const id = value;
    const name = (data ?? []).find((folder) => folder.id === id)?.name ?? 'this folder';
    const confirmed = await confirm({
      title: `Delete "${name}"?`,
      body: 'This permanently removes the folder from Google Drive. This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (confirmed) remove(id, name, false);
  };

  // A NOT_EMPTY failure is handled by the force-delete confirm flow, so it must not also surface as
  // a generic error line.
  const showDeleteError =
    deleteFolder.isError &&
    !(deleteFolder.error instanceof ApiError && deleteFolder.error.code === 'DRIVE_FOLDER_NOT_EMPTY');

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
          <IconButton
            icon={<IconTrash />}
            label={`Delete selected ${label.toLowerCase()} folder`}
            variant="danger"
            disabled={!value || deleteFolder.isPending}
            onClick={() => {
              void handleDelete();
            }}
          />
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
      {showDeleteError ? <p className="error">Could not delete the folder.</p> : null}
      {confirmDialog}
    </div>
  );
}
