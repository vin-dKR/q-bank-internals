// Public surface of the documents module (§4). Others import from here, never from internals.
export { DocumentsService } from './documents.service.js';
export { createDocumentsRouter } from './documents.routes.js';
export type { CreateDocumentInput, DocumentRepository } from './documents.repository.js';
