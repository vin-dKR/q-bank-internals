import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chemistrySourceText, QuestionSchema } from '@ingest/contracts';
import type { QuestionDraft } from '../src/features/questions/hooks/use-question-drafts.js';

// Browser CSS and Vite's build-time environment have no behavior in a server-rendered UI check.
const configUrl = new URL('../src/config/env.ts', import.meta.url).href;
const browserImports = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    if (url === configUrl) return { format: 'module', source: "export const config = { apiBaseUrl: '/api' };", shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { ChemistrySourceReview } = await import('../src/features/questions/components/chemistry-source-review.js');
const { EditableQuestionCard } = await import('../src/features/questions/components/editable-question-card.js');
const { ToastProvider } = await import('../src/shared/ui/toast.js');
const { MatchTableEditor } = await import('../src/shared/ui/match-table-editor.js');
const { ComprehensionGroupPanel } = await import('../src/features/questions/components/comprehension-group.js');
browserImports.deregister();

const cropUrl = 'https://example.test/question.png';
const question = QuestionSchema.parse({
  id: 'fixture', documentId: 'document', questionNumber: 1, printedLabel: 'A-1',
  path: { module: 'Chemistry', chapter: 'Phenol', section: 'Reactions' },
  stem: '', options: [], answer: '', explanation: 'Product <smiles>C1CC1</smiles>',
  chemistry: {
    version: 1, status: 'needs_review', issues: [], candidateStem: 'Write the products <smiles>C1CC1</smiles>', candidateOptions: [],
    visuals: [{ id: 'stem', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CC1'], graphValid: true, cropUrl }],
  },
  images: [], match: null, isQuestionImage: true, questionImage: cropUrl, isOptionImage: false, optionImages: [],
  questionType: 'subjective', sectionName: null, topic: null, subject: 'Chemistry', flagged: false,
  isPyq: false, pyqExam: null, pyqYear: null, paper: null,
  sourceRegion: { page: 1, bbox: [0, 0, 0.2, 0.2] },
  createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
});

void test('source review displays the worked-solution blocker before an acceptance request can be sent', () => {
  const html = renderToStaticMarkup(createElement(ChemistrySourceReview, {
    question, onReview: () => undefined, onRepair: () => undefined,
  }));
  assert.match(html, /The worked solution still renders an unverified molecular candidate/);
  assert.match(html, /Chemistry review cannot be saved yet/);
  assert.match(html, /Restore extracted SMILES/);
  const button = html.match(/<button[^>]*title="The worked solution[^>]*>/)?.[0];
  assert.ok(button);
  assert.match(button, /disabled=""/);
});

void test('a transcription question renders SMILES in the actual question field and keeps full-page crops inside the closed comparison panel', () => {
  const transcription = QuestionSchema.parse({ ...question, stem: 'Write the products <smiles>C1CC1</smiles>', explanation: null, isQuestionImage: false, questionImage: null, chemistry: { ...question.chemistry, representation: 'transcription' } });
  const draft: QuestionDraft = {
    stem: transcription.stem, answer: '', explanation: '', questionType: 'subjective', level: '',
    sectionName: '', topic: '', pyqExam: '', pyqYear: '', options: [], match: null,
  };
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
    createElement(ToastProvider, null, createElement(EditableQuestionCard, {
      question: transcription, number: 1, draft, dirty: false, saving: false, boxes: [], drawTarget: null,
      onDraftUpdate: () => undefined, onSave: () => undefined, onDelete: () => undefined,
      onRequestCrop: () => Promise.resolve(null), onRequestTranscription: () => Promise.resolve(null),
      onDrawRegion: () => undefined, onSaveBox: () => undefined, onDeleteBox: () => undefined, onTranscribeRegion: () => undefined,
    })),
  ));
  queryClient.clear();
  const result = html.match(/<section aria-labelledby="question-fixture"[\s\S]*?<\/section>/)?.[0];
  assert.ok(result);
  assert.match(result, /Write the products/);
  assert.match(result, /aria-label="Chemical structure C1CC1"/);
  assert.doesNotMatch(result, /See source diagram|<img|Source diagram · displayed result/);
  assert.match(html, /Source crop · comparison only/);
  assert.match(html, /Mark SMILES transcription reviewed/);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
});

void test('matrix and shared-passage transcription views retain drawn SMILES without hiding them behind placeholders', () => {
  const matrix = renderToStaticMarkup(createElement(ToastProvider, null, createElement(MatchTableEditor, {
    value: { columns: [{ title: 'Reactants', entries: [{ label: 'A', body: 'Reactant <smiles>C1CC1</smiles>', image: null }] }, { title: 'Products', entries: [] }], key: {} },
    onChange: () => undefined,
  })));
  assert.match(matrix, /aria-label="Chemical structure C1CC1"/);
  assert.doesNotMatch(matrix, /See source diagram/);
  const passage = renderToStaticMarkup(createElement(ToastProvider, null, createElement(ComprehensionGroupPanel, {
    documentId: 'document', passageId: 'passage', count: 1, passage: 'Reaction <smiles>C1CC1</smiles>', passageImage: null,
    dirty: false, onPassageChange: () => undefined, onReExtracted: () => undefined,
    onUngroup: () => undefined, onRequestCrop: () => Promise.resolve(null), onImageChange: () => undefined,
  })));
  assert.match(passage, /aria-label="Chemical structure C1CC1"/);
  assert.doesNotMatch(passage, /See source diagram/);
});

void test('a valid transcription can be checked against the original PDF when optional comparison storage is unavailable', () => {
  const transcription = QuestionSchema.parse({
    ...question, stem: 'Write the products <smiles>C1CC1</smiles>', explanation: null, questionImage: null, isQuestionImage: false,
    chemistry: { ...question.chemistry, representation: 'transcription', visuals: [{ id: 'stem', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CC1'], graphValid: true, cropUrl: null, sourcePage: 3 }] },
  });
  const html = renderToStaticMarkup(createElement(ChemistrySourceReview, { question: transcription, onReview: () => undefined, onRepair: () => undefined }));
  assert.match(html, /Check the structure directly on the original PDF, page 3/);
  const review = html.match(/<button[^>]*title="Confirm that the displayed molecular structures[^>]*>/)?.[0];
  assert.ok(review);
  assert.doesNotMatch(review, /disabled=""/);
});

void test('the main question field shows readable legacy text and a full source diagram instead of an empty edit field', () => {
  const draft: QuestionDraft = {
    stem: '', answer: '', explanation: question.explanation ?? '', questionType: 'subjective', level: '',
    sectionName: '', topic: '', pyqExam: '', pyqYear: '', options: [], match: null,
  };
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
    createElement(ToastProvider, null, createElement(EditableQuestionCard, {
      question, number: 1, draft, dirty: false, saving: false, boxes: [], drawTarget: null,
      onDraftUpdate: () => undefined, onSave: () => undefined, onDelete: () => undefined,
      onRequestCrop: () => Promise.resolve(null), onRequestTranscription: () => Promise.resolve(null),
      onDrawRegion: () => undefined, onSaveBox: () => undefined, onDeleteBox: () => undefined, onTranscribeRegion: () => undefined,
    })),
  ));
  queryClient.clear();
  const sourceResult = html.match(/<section aria-labelledby="question-fixture"[\s\S]*?<\/section>/)?.[0];
  assert.ok(sourceResult);
  assert.match(sourceResult, /Write the products \[See source diagram\]/);
  assert.match(sourceResult, /Source diagram · displayed result/);
  assert.match(sourceResult, /src="https:\/\/example.test\/question.png"/);
  assert.match(sourceResult, /View at original size/);
  assert.doesNotMatch(sourceResult, />Click to edit<|C1CC1|h-20 w-full/);
});

void test('matrix and shared-passage resting views hide molecular guesses while retaining their source diagrams', () => {
  const matrix = renderToStaticMarkup(createElement(ToastProvider, null, createElement(MatchTableEditor, {
    value: { columns: [{ title: 'Reactants', entries: [{ label: 'A', body: 'Reactant <smiles>C1CC1</smiles>', image: cropUrl }] }, { title: 'Products', entries: [] }], key: {} },
    displayText: chemistrySourceText, onChange: () => undefined,
  })));
  assert.match(matrix, /Reactant \[See source diagram\]/);
  assert.match(matrix, /src="https:\/\/example.test\/question.png"/);
  assert.doesNotMatch(matrix, /C1CC1/);
  const passage = renderToStaticMarkup(createElement(ToastProvider, null, createElement(ComprehensionGroupPanel, {
    documentId: 'document', passageId: 'passage', count: 1, passage: 'Reaction <smiles>C1CC1</smiles>', passageImage: cropUrl,
    displayText: chemistrySourceText, dirty: false, onPassageChange: () => undefined, onReExtracted: () => undefined,
    onUngroup: () => undefined, onRequestCrop: () => Promise.resolve(null), onImageChange: () => undefined,
  })));
  assert.match(passage, /Reaction \[See source diagram\]/);
  assert.match(passage, /src="https:\/\/example.test\/question.png"/);
  assert.doesNotMatch(passage, /C1CC1/);
});
