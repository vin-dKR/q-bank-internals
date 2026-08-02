# infrastructure/drive

Google Drive adapter. Belongs here (§ CONVENTIONS 3, 11): an adapter to an external system.

**Port** (define next to the service that needs it, e.g. `modules/documents/documents.repository.ts`
style — a `DriveStorage` interface): list PDFs under the root folder, download a file's bytes,
upload extracted figures. The service depends on that interface; this folder implements it with
`googleapis` + a service account (`GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_ROOT_FOLDER_ID`).

Left empty deliberately — no dead code. Add `google-drive.storage.ts` when the Drive dropdown
and figure upload are wired, and construct it in `container.ts`.
