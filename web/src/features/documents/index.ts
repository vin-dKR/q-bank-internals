// Public surface of the documents feature (§4). Other features import from here only.
export { DocumentPicker } from './components/document-picker.js';
export { DocumentUnitList } from './components/document-unit-list.js';
export { groupByUnit, type DocumentUnit } from './lib/group-by-unit.js';
export { useDocuments } from './hooks/use-documents.js';
export { useDocument } from './hooks/use-document.js';
export { useDeleteDocument } from './hooks/use-delete-document.js';
