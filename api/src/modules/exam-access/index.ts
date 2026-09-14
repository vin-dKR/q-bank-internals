// Public surface of the exam-access module (§4): the Masters → Exam access feature — read the exam
// catalog, list Eduents orgs/users, and set which exam families each may see in the main bank.
export { ExamAccessService } from './exam-access.service.js';
export { createExamAccessRouter } from './exam-access.routes.js';
export type { ExamAccessStore, ExamAccessUserQuery } from './exam-access.repository.js';
