// Public surface of the bank module (§4). Reads + fixes already-published questions in the main bank.
export { BankService } from './bank.service.js';
export { createBankRouter } from './bank.routes.js';
export type { BankQuestionStore, BankImagePatch } from './bank.repository.js';
