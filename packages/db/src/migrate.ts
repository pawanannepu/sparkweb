import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePostgresJs } from "drizzle-orm/postgres-js/migrator";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = resolve(currentDir, "../drizzle");

export async function runPostgresMigrations<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema>,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER
): Promise<void> {
  await migratePostgresJs(db, { migrationsFolder });
}

export async function runPgliteMigrations<TSchema extends Record<string, unknown>>(
  db: PgliteDatabase<TSchema>,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER
): Promise<void> {
  await migratePglite(db, { migrationsFolder });
}
