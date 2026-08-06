# infrastructure/ai

Vision-extraction adapter. Belongs here (§ CONVENTIONS 3, 11): an adapter to an external system.

**Port** (a `VisionExtractor` interface owned by the extraction module): given a section PDF's
rasterized pages, return draft questions (stem, options, answer, figures, source region). This
folder implements it with Gemini (`GEMINI_API_KEY`, `EXTRACTION_MODEL`) and OpenAI as a fallback.

This runs in the **worker**, not the request path — the API only enqueues jobs (see
`modules/extraction`). Add `gemini-vision.extractor.ts` when the worker is built.
