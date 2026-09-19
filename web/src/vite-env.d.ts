/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// KaTeX's mhchem contrib subpath ships no type declarations; it is imported only for its side effect
// (registering `\ce` on the KaTeX singleton — see shared/lib/katex-setup.ts).
declare module 'katex/contrib/mhchem';
