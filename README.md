# Eduents Ingest

Internal pipeline that turns a module PDF into verified, tagged questions in the Eduents bank:
**split → upload to Drive → AI-extract → verify/fix → publish**. One app, replacing the four
standalone helpers (chapter splitter, page cutter, extractor, question editor).

> **Read [`CONVENTIONS.md`](./CONVENTIONS.md) before contributing.** It is the law of this repo —
> where every file goes, how layers may call each other, and what counts as unacceptable code.

## Stack

| Concern | Choice |
|---|---|
| Structure | **Two independent apps** (`api/`, `web/`) — no workspace; each installs and deploys on its own |
| Backend | Express + Node + TypeScript (`api/`) |
| Frontend | Vite + React + TypeScript (`web/`) |
| API boundary | zod schemas in `@ingest/contracts`, **vendored into each app** (`api/contracts`, `web/contracts`) |
| Persistence | Prisma + MongoDB (prod) · in-memory adapter (dev, default) |
| Server state | TanStack Query |
| Heavy jobs | BullMQ + Redis worker (`npm run worker`) · in-process queue (dev) · synchronous in-request (serverless) |
| AI extraction | OpenAI `gpt-4o` vision (ported from the standalone PDF Extractor) |

## Layout

```
api/   Express backend — layered: routes → controller → service → repository(port) → infrastructure(impl)
  contracts/   vendored copy of @ingest/contracts (installed via file:./contracts)
  api/index.ts Vercel serverless entry (wraps the Express app)
web/   Vite/React frontend — feature-sliced: features/<name>/{api,components,hooks,types}
  contracts/   vendored copy of @ingest/contracts (installed via file:./contracts)
```

> The two apps are **not** a workspace anymore. `@ingest/contracts` is copied into each app, so a
> change to the API boundary must be made in **both** `api/contracts` and `web/contracts`.

## Run it — two servers, two terminals

```bash
# terminal 1 — API on :4000
cd api && npm install && npm run prisma:generate && npm run dev

# terminal 2 — web on :5173 (Vite proxies /api → :4000)
cd web && npm install && npm run dev
```

Per app: `npm run typecheck`, `npm run lint`, `npm run build`.

The PDF editor renders only visible pages and releases offscreen canvases in both List and Grid
views. Applying horizontal/vertical cuts shares fonts and images across the rebuilt document,
instead of copying those resources for each output cell. Page controls stay available for
selection and navigation. Run `npm run test:pdf-cut` in `web/` for clipping and resource-sharing
regressions.

## AI structure detection in Cut & upload

Load and edit a PDF, apply pending page cuts, fill chapter metadata and choose the answer layout
manually. In **Build structure from heading crops**, select **Horizontal** or **Rectangle**.
Horizontal clicks select a top band; dragging selects a band between two points. Rectangle drags
select any region. These heading crops do not alter the working PDF. A crop can contain Exercise,
Part and Topic together, or only the headings that change on a later page.
Drag an existing box or its numbered handle to move it (arrow keys also work on the handle).
Horizontal bands move vertically; rectangles move in both directions and stay within the page.
Moving a crop clears its old OCR/review and requires saving the reading order again.
**Clear all crops** removes every heading box and its saved OCR draft text for this PDF.

The flow is **Save ordered crops → Run OCR → review/edit/save text → Generate JSON with AI**.
Use **Extract with AI** beside a crop's **Rerun OCR** to preview its cleaned Section, Part, Topic
and question type directly. It makes one text-only AI call using the current crop and selected
source rules; original OCR text stays available above the result. Missing headings/types stay
null, and unnamed Topics stay blank. Review the extracted values and save reviewed text.
Step 4 builds the hierarchy in crop order, reusing per-crop results without another AI call when
the text, chapter context and saved source rules match. Crops without reusable results still
make one call each. Moving a box, rerunning OCR or editing its text clears its AI result.
Results are saved with the OCR draft, and preview/generation calls appear in the PDF's usage totals.
**Regenerate JSON with AI** rebuilds from reviewed text/results; **Extract with AI** always makes
a fresh call for that crop when another model reading is needed.
Use **Rerun OCR** in step 2 to extract all completed crops again, or the OCR button inside a crop
to extract just that region. When some crops are unfinished, **Run OCR**/**Retry unfinished OCR**
processes only those crops; **Rerun all OCR** also includes completed crops. Previous text is kept
if OCR fails, and a rerun requires fresh review before generating JSON. **Review saved text again**
reopens the saved text for editing without rerunning OCR; save the review again afterward.
Crops start in page/top/left order; arrow buttons allow manual reading order for columns.
PDF.js renders just the selected regions at 3× resolution. PNG crops are temporarily staged in
Supabase and sent to `POST /api/ingestion/structure-crop-ocr`. Tesseract.js runs locally in the
Node.js API with bundled English data, and the worker and staged PNG are cleaned up afterward.
Each crop runs Automatic and Sparse-text segmentation on the original image. Results are merged
by position to avoid duplicate lines. Additional recovered lines and conflicting readings are
flagged for review; the Automatic reading is kept when the two passes disagree.
There is no hosted OCR call or automatic AI call during OCR. Low-confidence lines are preserved
for review, with warnings below `STRUCTURE_OCR_MIN_CONFIDENCE` (default 70). Recognition times
out after `STRUCTURE_OCR_TIMEOUT_MS` (default 45000). Completed text is reused when retrying
unfinished OCR crops. OCR can misread even high-confidence text; verify identifiers and spelling.

Small coordinate/text drafts are saved in browser storage under the PDF's SHA-256 identity and
session. Reloading the same PDF restores its crops and OCR text; changed PDFs get a separate draft.
PDFs and crop images are not saved in browser storage. **Download OCR draft** keeps a JSON copy
of coordinates, reading order and extracted/reviewed text.

Per-crop previews send that crop's current OCR text to `POST /api/ingestion/detect-structure`, using
`EXTRACTION_MODEL` and `OPENAI_API_KEY`. Full JSON generation uses saved reviewed text/results.
Each nonempty crop without a reusable result makes one sequential AI call, with preceding
headings and question-type scopes provided as context. Blank reviewed crops make no AI call.
GPT-5.4 and GPT-5.4 Mini structure requests use **high reasoning** and allow **10,000 completion
tokens per call**, shared by reasoning and the returned JSON. The cost estimate uses this same limit.
The AI never receives PDF bytes or page images in this step. Its strict schema includes crop IDs
and three printed/label heading pairs plus question-type evidence; code independently verifies each against that crop's text and builds
the tree in operator order. Saved examples teach heading roles/formatting. Unmarked cropped text
can be considered for Topic only; Section/Part require a marker or the provider's saved format.
Question identifiers, instruction notes and exam/year labels are excluded.
Raw OCR evidence is kept separate from the display label. Decorative glyphs before a marker can
be removed, but cleanup cannot change an identifier or replace/truncate the printed Topic name.
An Exercise change clears the active Part and Topic; a Part change clears the active Topic.
Absent headings continue the previous hierarchy, and repeated unchanged parents preserve children.
A printed unnamed Topic creates a blank Topic rather than continuing the previous named Topic.
Exam/year labels such as
`AIPMT 2006` or `NEET-UG 2013` are PYQ information and cannot become Topics.
Part labels keep only the identifier: `PART I: SUBJECTIVE QUESTIONS` becomes `I`.
Topic labels use only the printed name: `Section (A): Polymers` becomes `Polymers`.
AI must not infer a topic from questions, answers, chapter metadata or subject matter. If no
topic name is printed, the Topic input stays blank. No synthetic topic names are generated.

AI also reads explicit question-type labels in the same reviewed crops and returns the existing
canonical `questionType` values (`single_correct`, `multi_correct`, `integer`, `matrix`,
`comprehension`, `assertion_reason`, `true_false`, `fill_blank`, `subjective`). For example,
`PART I: SUBJECTIVE QUESTIONS` gives its Topic leaves `questionType: "subjective"`, while
the Part display label remains `I`. A Topic's explicit type overrides its Part/Exercise type;
following Topics inherit their own parent type. New Parts/Exercises clear the preceding scope.
An unnamed Topic can still carry a supported type. Missing, conflicting or generic labels such
as `Objective Questions`/`Multiple Choice Questions` stay blank rather than guessing single vs
multiple correct. A conflicting later observation of an already typed heading produces a warning
and retains the earlier value for review. Types require evidence from the current crop, not
chapter metadata or saved examples. Type detection uses the same crop call and adds no calls.
Review the proposed JSON, then apply it to populate the existing question-type dropdowns.

Page numbering and answer/solution matching are manual. There are no AI start markers.

Open **Structure rules** (`/structure-rules`) to save pairs of **Printed heading example** and
**Expected output** for Section, Part and Topic, plus optional recognition notes. Each source and
provider has its own pairs. For example, `Level 2: Objective Questions` → `2` and
`Block B: Chemical Bonding` → `Chemical Bonding` teach a provider's format; another page with
`Level 3` or `Block C: Biomolecules` must use its own number/name, not copy the examples.
AI returns both the printed heading and formatted label for configured levels, so code can retain
raw hierarchy context without overwriting custom output formats. Old saved profiles retain the
general cleanup rules until edited and saved. Module profiles match the selected
module name (Allen, PW, Resonance, etc.); textbook profiles match the Textbook / publisher field;
PYQ profiles match the paper's exam name. Profiles are isolated by source and provider, with
case/whitespace-insensitive matching and no fallback to another provider's examples.
The Detect card shows the matching profile and links to its settings in a new tab. The backend
loads it once at the start of each detection and adds the same examples to every text batch.
Examples describe formats; they never supply missing Topic names or page assignments. Cost
estimates include the saved example context without increasing the number of AI calls.
Profiles use the `ingest_structure_rules` Mongo collection when `DB_DRIVER=mongo`; the existing
in-memory development driver keeps them only for that server process.

Detected nodes have empty page slots (optional Solution is null). Review the JSON and headings,
then **Apply structure** and bind Question, Answer, Solution or Companion pages in the existing
editor according to the selected layout. Applying replaces existing nodes and clears attachments,
so all pages must be rebound manually. Invalid page responses produce review warnings while
valid headings remain available. Chapter metadata and layout stay operator-owned.

OCR requires the existing signed-upload staging store (`SUPABASE_SERVICE_KEY`). Crops must be PNGs
under 10 MB and 20 million pixels. Each crop's text is limited to 12,000 characters, and a generation
accepts at most 1,000 crops / 250,000 characters. The AI model must support strict structured outputs.
No automatic paid retries occur; provider/network failures stop further requests and preserve partial
results. Detection usage is recorded per batch as `structure-detection`; the global token budget is
checked before each batch. Blank crops use no AI tokens.

After text is saved, the card shows a text-based token/cost planning range. A debounced
`POST /api/ingestion/estimate-structure` uses the same batching limits, reviewed text, rules, schema
and manual context; it makes no paid AI call. Actual usage can fall outside the planning range.
After each detection, OpenAI-reported input/output/cache/reasoning tokens determine its estimated
USD cost. Cache tokens receive the cached rate; reasoning is already included in output tokens.
Failed detections with reported usage also return a receipt. Receipts survive applying/discarding
the proposal, with aggregated batch tokens/cost and a total for repeated detections on the loaded PDF.
These costs cover structure detection API calls only, not local OCR compute time, later question
extraction, taxes, or storage. OCR itself consumes no OpenAI tokens, but adds processing time.
This cropped OCR flow applies to structure detection; question content extraction still uses its
existing AI image workflow.
Published standard rates for GPT-5.4 and GPT-5.4 Mini live in
`api/src/infrastructure/ai/structure-cost.ts` (verified 2026-09-30), including GPT-5.4's long-context
surcharge. Unknown models still show tokens but report pricing unavailable; missing usage is never
shown as zero cost. Update the rate table when changing the model or when provider pricing changes.

The behavioral prompt and strict crop-heading JSON Schema live in
`api/src/infrastructure/ai/prompts/structure-prompts.ts`. Run the focused regression tests from `api/`:
`node --import tsx --conditions=development --test tests/structure-detection.test.mts`.
Crop geometry, reading order and reviewed-text regressions run from `web/` with `npm run test:structure`.

The API boots with **no external services**: `DB_DRIVER=memory` (default) means no MongoDB needed,
and Drive/OpenAI are only required by the routes that actually use them. To use MongoDB, set
`DB_DRIVER=mongo` + `DATABASE_URL`. Copy `api/.env.example` → `api/.env` (and `web/.env.example` →
`web/.env`) when you wire real services.

Deploying to Vercel: see [`DEPLOY_VERCEL.md`](./DEPLOY_VERCEL.md) — one project per app, Root
Directory `api` and `web` respectively.
