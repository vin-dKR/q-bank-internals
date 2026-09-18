// Public surface of the syllabi module (§4): the exam → subject → chapter → topic vocabulary and its uploads.
export { SyllabiService } from './syllabi.service.js';
export { createSyllabiRouter } from './syllabi.routes.js';
export { isCalled, nameKey } from './syllabus-names.js';
export type { StoredSyllabus, SyllabusStore } from './syllabi.repository.js';
