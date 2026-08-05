import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Question } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { questionsApi } from '../api/questions.api.js';

/** Live progress for the auto-extract run: which page we're on and how many figures are saved so far. */
export type AutoExtractProgress = { page: number; totalPages: number; saved: number };

export type AutoExtractFigures = {
  /** Detect + crop + save every figure across the document. Idempotent — skips questions with an image. */
  run: () => Promise<number>;
  isRunning: boolean;
  progress: AutoExtractProgress | null;
  error: string | null;
  /** Figures saved by the most recent completed run, or null before the first run. */
  lastSaved: number | null;
};

/** True once a question already carries a question image — auto-extract leaves those alone. */
function hasQuestionImage(question: Question): boolean {
  return (question.questionImage ?? '').trim().length > 0;
}

/**
 * The Verify screen's "auto-crop figures" engine. For each page that still has a question missing its
 * figure, it asks the API to detect the diagrams, crops each returned bbox out of that page's image
 * (the same client-side crop the manual workflow uses — cropping lives in exactly one place), uploads
 * it, and saves the URL onto the question. Both the on-arrival auto run and the manual button call it.
 *
 * The AI detector works at question granularity, so this fills `questionImage` only; option-level
 * figures and any AI mistakes are still fixed by hand with the manual crop tools, which stay intact.
 */
export function useAutoExtractFigures(documentId: string): AutoExtractFigures {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AutoExtractProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const run = useCallback(async (): Promise<number> => {
    setIsRunning(true);
    setError(null);
    setProgress(null);
    try {
      const questions = await questionsApi.listByDocument(documentId);
      const byId = new Map(questions.map((question) => [question.id, question]));

      // Only touch pages that still have a question without a figure — cheap, and never re-detects a
      // page whose crops are already done (safe to re-run after a push or a second button click).
      const pages = [
        ...new Set(
          questions.filter((q) => !hasQuestionImage(q)).map((q) => q.sourceRegion.page),
        ),
      ].sort((a, b) => a - b);

      let saved = 0;
      for (const [index, page] of pages.entries()) {
        setProgress({ page: index + 1, totalPages: pages.length, saved });

        const { figures } = await questionsApi.detectFigures(documentId, page);
        const imageSrc = questionsApi.pageImageUrl(documentId, page);
        for (const figure of figures) {
          const question = byId.get(figure.questionId);
          if (!question || hasQuestionImage(question)) continue;

          const [x, y, width, height] = figure.bbox;
          const blob = await getCroppedBlob(imageSrc, { x, y, width, height });
          const { url } = await questionsApi.uploadImage(
            figure.questionId,
            `${figure.questionId}_auto_${String(page)}`,
            blob,
          );
          const updated = await questionsApi.update(figure.questionId, {
            isQuestionImage: true,
            questionImage: url,
          });
          byId.set(updated.id, updated);
          saved += 1;
          setProgress({ page: index + 1, totalPages: pages.length, saved });
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['questions', documentId] });
      setLastSaved(saved);
      return saved;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return 0;
    } finally {
      setIsRunning(false);
    }
  }, [documentId, queryClient]);

  return { run, isRunning, progress, error, lastSaved };
}
