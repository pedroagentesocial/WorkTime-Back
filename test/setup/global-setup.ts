import { loadEnv } from '#config/env.js';
import { applyMigrations, ensureDatabaseExists, toTestDatabaseUrl } from './test-database.js';

export default async function globalSetup(): Promise<void> {
  const testUrl = toTestDatabaseUrl(loadEnv().databaseUrl);
  await ensureDatabaseExists(testUrl);
  applyMigrations(testUrl);
}
