import { z } from 'zod';

export const PublishIssueSchema = z.object({
  questionId: z.string().nullable(),
  questionNumber: z.number().nullable(),
  message: z.string(),
});
export type PublishIssue = z.infer<typeof PublishIssueSchema>;

export const PublishIssuesSchema = z.object({
  documentId: z.string(),
  issues: z.array(PublishIssueSchema),
});
export type PublishIssues = z.infer<typeof PublishIssuesSchema>;
