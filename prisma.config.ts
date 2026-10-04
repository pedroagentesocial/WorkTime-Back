import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 ya no carga el .env solo; una DATABASE_URL ya definida tiene prioridad
loadDotenv({ path: '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --conditions=development prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
