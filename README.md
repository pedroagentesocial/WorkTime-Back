# WorkTime API

API REST multiempresa de control de asistencia. Node 24 · Express 5 · Prisma 7 · PostgreSQL · TypeScript.

## Puesta en marcha

```bash
npm install                 # instala y genera el cliente de Prisma
cp .env.example .env        # completa DATABASE_URL, JWT_SECRET y SEED_ADMIN_*
npm run db:migrate          # crea las tablas
npm run db:seed             # crea el admin global inicial
npm run admin:recover       # si el admin global perdió el acceso: le da una contraseña temporal
npm run dev                 # http://localhost:3000/api/v1 · docs: http://localhost:3000/docs
```

Los tests e2e usan la conexión del `.env` sobre una BD con sufijo `_test` (p. ej. `worktime_test`), que se crea y migra sola.

## Documentación

- [`API.md`](API.md): cómo usar la API y referencia de cada endpoint. Es un archivo generado: la guía se edita en `docs/api-guide.md` y se regenera con `npm run docs:api`.
- [`docs/security.md`](docs/security.md): medidas de seguridad y riesgos aceptados.
- [`CLAUDE.md`](CLAUDE.md): arquitectura y decisiones del proyecto.

## Scripts

| Script                                             | Qué hace                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `dev`                                              | Servidor con recarga automática                                                                       |
| `build` / `start`                                  | Compila a `dist/` y lo ejecuta                                                                        |
| `check`                                            | typecheck + lint + tests unitarios                                                                    |
| `test`, `test:unit`, `test:e2e`, `test:cov`        | Tests                                                                                                 |
| `db:migrate` / `db:migrate:create`                 | Crea una migración (con o sin aplicarla)                                                              |
| `db:deploy`                                        | Aplica migraciones pendientes (producción)                                                            |
| `db:seed`, `db:studio`, `db:status`, `db:generate` | Utilidades de Prisma                                                                                  |
| `docs:api`                                         | Regenera `API.md`                                                                                     |
| `admin:recover`                                    | Recupera el acceso del admin global con una contraseña temporal (en Docker: ver `docs/deployment.md`) |

## Estructura

Monolito modular con arquitectura limpia: cada módulo de `src/modules/<nombre>/` tiene `domain/`, `application/`, `infrastructure/` y `presentation/`. ESLint impide que `domain` y `application` dependan de infraestructura.
