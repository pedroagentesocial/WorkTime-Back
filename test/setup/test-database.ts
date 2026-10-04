import { execSync } from 'node:child_process';
import pg from 'pg';

export function toTestDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  assertTestDatabase(url.toString());
  return url.toString();
}

// Salvaguarda: solo se aceptan BDs cuyo nombre termine en _test
export function assertTestDatabase(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Los tests se negaron a usar la BD "${name}": su nombre debe terminar en "_test".`,
    );
  }
  return name;
}

export async function ensureDatabaseExists(testDatabaseUrl: string): Promise<void> {
  const name = assertTestDatabase(testDatabaseUrl);
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

export function applyMigrations(testDatabaseUrl: string): void {
  assertTestDatabase(testDatabaseUrl);
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'pipe',
  });
}
