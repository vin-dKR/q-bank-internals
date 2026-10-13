/** All rectangles use normalized source-page [left, top, right, bottom] coordinates. */
export type SourceBox = [number, number, number, number];
export type SourceOptionAnchor = { label: string; anchorBox: SourceBox; bbox: SourceBox };
export type SourceQuestionAnchor = {
  printedLabel: string;
  sourceSection: string | null;
  anchorBox: SourceBox;
  bbox: SourceBox;
  stemBbox: SourceBox | null;
  options: SourceOptionAnchor[];
};
export type SourcePageLayout = {
  source: 'native_pdf' | 'ocr';
  width: number;
  height: number;
  contentBox: SourceBox;
  questions: SourceQuestionAnchor[];
  /** Column continuations need explicit multi-region ownership; one rectangle cannot prove coverage. */
  limitations: string[];
};
