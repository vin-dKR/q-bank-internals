# infrastructure/queue

BullMQ (Redis) adapter for the extraction job queue. Belongs here (§ CONVENTIONS 3, 11).

The API enqueues an extraction job (`modules/extraction`); a separate long-running **worker**
process consumes the queue, rasterizes the PDF, calls `infrastructure/ai`, writes drafts, and
updates the job + document status. Keeping the heavy, slow work off the request path is the whole
reason this stack exists (Express + persistent worker, not serverless).

Add `bullmq.queue.ts` and a sibling `worker/` app when you move extraction off the in-memory stub.
`REDIS_URL` configures the connection.
