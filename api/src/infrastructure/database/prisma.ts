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

/**
 * The "row is live (not soft-deleted)" filter for any model with an optional `deletedAt`, spread
 * into a Prisma `where`. On the Mongo connector `{ deletedAt: null }` does NOT match a document
 * where the field is *absent*, and `deletedAt` is absent on every row created before the soft-delete
 * field existed — and on rows Prisma writes null to, which it stores as unset. Filtering on `null`
 * alone therefore hides all such rows from listings (see the sessions/documents repositories). We
 * must match `null` OR unset. A factory (not a shared const) so each call is a fresh, mutable object
 * assignable to any model's WhereInput.
 */
export function notSoftDeleted(): {
  OR: ({ deletedAt: null } | { deletedAt: { isSet: boolean } })[];
} {
  return { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };
}
