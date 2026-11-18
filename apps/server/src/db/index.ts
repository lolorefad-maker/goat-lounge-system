import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export { schema };

/** Both drivers expose the same query API; we type against node-postgres. */
export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Anything that can run queries: the db itself or an open transaction. */
export type Q = DB | Tx;

const here = path.dirname(fileURLToPath(import.meta.url));
const possibleFolders = [
  path.resolve(here, '../../drizzle'),
  path.resolve(here, '../drizzle'),
  path.resolve(process.cwd(), 'apps/server/drizzle'),
  path.resolve(process.cwd(), 'drizzle'),
];
const migrationsFolder = possibleFolders.find((f) => existsSync(f)) || possibleFolders[0]!;

export interface Database {
  db: DB;
  driver: 'pg' | 'pglite';
  close(): Promise<void>;
}

/**
 * Open the database and bring the schema up to date.
 * - `databaseUrl` set → real Postgres (cloud, or a shop PC running Postgres).
 * - otherwise → embedded Postgres (PGlite) stored in `dataDir`, or in memory when dataDir is null (tests).
 */
export async function openDatabase(opts: { databaseUrl: string | null; dataDir: string | null }): Promise<Database> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder });
    return { db, driver: 'pg', close: () => pool.end() };
  }

  // Lazy-load PGlite so cloud deployments (Postgres) don't load WebAssembly binary into memory
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { migrate: migratePglite } = await import('drizzle-orm/pglite/migrator');

  const client = opts.dataDir ? new PGlite(path.join(opts.dataDir, 'pgdata')) : new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as DB, driver: 'pglite', close: () => client.close() };
}
