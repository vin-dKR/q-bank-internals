# infrastructure/ai

Vision-extraction adapter. Belongs here (§ CONVENTIONS 3, 11): an adapter to an external system.

**Port** (a `VisionExtractor` interface owned by the extraction module): given a section PDF's
rasterized pages, return draft questions (stem, options, answer, figures, source region). This
folder implements it with an OpenAI vision model (`OPENAI_API_KEY`, `EXTRACTION_MODEL`), plus an
`unconfigured.*` null-object adapter that fails loudly when no key is set.

Extraction runs in the **worker**, not the request path — the API only enqueues jobs (see
`modules/extraction`). The sibling adapters here (LaTeX refiner, diagram detector, question
re-extractor) do run on the request path, and each has its own model env var.
