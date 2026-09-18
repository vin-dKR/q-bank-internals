import { SyllabusFileSchema, type SyllabusFile } from '@ingest/contracts';
import jee from './bundled/jee.syllabus.json' with { type: 'json' };

/**
 * The syllabi that ship with the app. Adding one is a JSON file in `bundled/` plus an entry here — see that
 * folder's README. An exam uploaded from the Exam syllabus screen overrides its bundled file; these are the
 * fallback, so a fresh deployment already knows JEE without anyone uploading anything.
 *
 * Validated at startup, so a malformed file fails the boot rather than silently offering no topics.
 */
export const BUNDLED_SYLLABI: readonly SyllabusFile[] = [jee].map((file) => SyllabusFileSchema.parse(file));
