import { pdfjs } from 'react-pdf';
// Self-host the pdf.js worker via Vite's `?url` asset import — fingerprinted, served from our own
// origin, correct in both dev and build. Importing this module for its side effect sets the worker
// once for every react-pdf surface (the ingestion previewer sets the same URL; assigning twice is a
// harmless idempotent write). Every tool that renders a PDF imports this before mounting `<Document>`.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
