import { build } from 'esbuild';

/**
 * Bundles the serverless entry (`src/serverless.ts`) to plain JS at repo-root `api/index.js`, which
 * is what Vercel's function builder wraps. Bundling to JS ourselves is deliberate: it stops
 * @vercel/node from type-checking our TypeScript source graph with its own tsconfig (which lacks
 * esModuleInterop and fails on the CJS `helmet` default import).
 *
 * We bundle our OWN workspace source — including `@ingest/contracts`, whose package entry points at
 * uncompiled `.ts` and would be unloadable at runtime if left external — but keep every real npm
 * dependency external. Native/dynamic packages (node-`canvas` via `pdf-to-img`, the Prisma query
 * engine) must not be bundled; Vercel's file tracer resolves all externals from `node_modules`.
 */
const externalizeNpmDeps = {
  name: 'externalize-npm-deps',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      const p = args.path;
      if (p.startsWith('.') || p.startsWith('/')) return undefined; // relative → bundle
      if (p.startsWith('@ingest/')) return undefined; // workspace package → bundle
      return { path: p, external: true }; // real npm dependency → external
    });
  },
};

await build({
  entryPoints: ['src/serverless.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '../../api/index.js',
  logLevel: 'info',
  plugins: [externalizeNpmDeps],
});
