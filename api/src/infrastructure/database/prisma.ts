import { PrismaClient } from '@prisma/client';

/**
 * The one PrismaClient for the process (§6.4). Lazily constructed so importing this module has no
 * side effect and dev boots on the in-memory driver without ever touching Mongo. Requires
 * `npm run prisma:generate` before the `mongo` driver can be used.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}
