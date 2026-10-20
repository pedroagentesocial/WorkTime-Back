# WorkTime API — Contexto para asistentes de IA

Lee este archivo antes de cambiar nada. Si algo aquí contradice al código, **el código manda**: verifícalo y actualiza este archivo. Las reglas de negocio detalladas y cada endpoint están en `API.md` (generado) y `docs/api-guide.md` (guía a mano); la seguridad en `docs/security.md`.

## 1. Qué es

Backend (solo API) de **control de asistencia multiempresa** tipo OnTheClock. Hoy es de uso propio; la meta es poder comercializarlo como SaaS. Se alojará con Docker en un servidor Linux en Salt Lake City, Utah. Hay empleados en varios estados y países: **las zonas horarias son un requisito central**.

El front de pruebas (simulador legacy, HTML y JS sin build) vive en un repositorio o carpeta aparte, `WorkTime-Front`. Se levanta con `node server.js` y se abre en http://localhost:4200, el único origen que permite el CORS. Debe actualizarse cuando cambia un endpoint.

| Rol (valor en BD)     | Qué hace                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_admin`      | Admin global: crea, edita y suspende empresas y su admin. Sin empresa. Se crea con el seed.                                                                                                                                                     |
| `company_admin`       | Uno por empresa. Gestiona empresa y empleados, ve y corrige asistencia. **No marca asistencia propia.**                                                                                                                                         |
| `multi_company_admin` | Persona que administra varias empresas, solo las asignadas por el admin global o creadas dentro de su paquete (máximo de empresas y de empleados por empresa). Sin empresa propia; trabaja en una empresa activa a la vez como `company_admin`. |
| `employee`            | Marca entrada y salida y consulta su historial.                                                                                                                                                                                                 |

Los endpoints nunca preguntan por un rol, solo por un **permiso** (`src/shared/domain/permissions.ts`). Un rol nuevo es una entrada en `ROLE_PERMISSIONS`.

## 2. Reglas del usuario (obligatorias)

1. **Pregunta ante cualquier decisión de diseño o duda.** No asumas.
2. **Git:** el proyecto es un repositorio. No hagas commits, push ni cambios en el historial salvo que el usuario lo pida. Los commits siguen Conventional Commits: `tipo(alcance): descripción`, con el tipo en inglés y la descripción en español, minúscula y sin punto final.
3. **Identificadores de código en inglés** (variables, clases, archivos).
4. **Mensajes al usuario final en español con acentos:** errores de la API y descripciones de Swagger.
5. **Comentarios en el código:** pocos, solo los clave (seguridad, reglas de negocio, razones técnicas no obvias), breves, en español natural, **sin acentos ni ñ, sin emojis y sin paréntesis**.
6. **Un solo `.env`** (nada de `.env.test`). Todo secreto va ahí, nunca en el código ni en otros archivos. No imprimas ni repitas sus valores. Plantilla en `.env.example`.
7. **Seguridad como prioridad.** Cada funcionalidad nueva lleva tests, incluido el aislamiento entre empresas.
8. **Arquitectura limpia** (sección 4).
9. **No pongas rutas de la computadora del usuario ni datos personales** en archivos del proyecto.

## 3. Stack (versiones exactas, `--save-exact`)

Node 24 · TypeScript 5.9.3 (no subir: typescript-eslint soporta `<6.1`) · Express 5.2.1 · **Prisma 7.10.0** (el tag `latest` de npm apunta a Prisma 8 RC: instalar siempre la versión exacta) · PostgreSQL 18 · Zod 4 · zod-to-openapi + swagger-ui (`/docs`) · Awilix 13 (DI) · argon2 · jose (JWT HS256) · pino · helmet, cors, express-rate-limit · Vitest + Supertest · ESLint 10 + eslint-plugin-security + Prettier.

`package.json` tiene `overrides` para `deepmerge-ts` y `mysql2`. `npm audit` solo marca `braces` (sin arreglo, riesgo aceptado en `docs/security.md`): no uses `npm audit fix --force`.

**Prisma 7:**

- La URL de la BD va en `prisma.config.ts` (carga `.env` con dotenv), no en `schema.prisma`.
- El cliente se genera en `src/generated/prisma` y se importa desde `#generated/prisma/client.js`, no desde `@prisma/client`.
- El driver adapter es obligatorio (`PrismaPg`).
- `migrate dev` ya no corre `generate` ni el seed: se corren aparte.
- Se usa el preview feature `partialIndexes`.

## 4. Arquitectura

Monolito modular con arquitectura limpia.

```
src/
├── main.ts · bootstrap.ts · app.ts   arranque, raíz de composición, Express
├── config/        env.ts (único que lee process.env) · security.ts · jobs.ts · retention.ts
├── shared/        domain · application (puertos) · infrastructure · http · composition
└── modules/       system · identity · platform · workforce · timekeeping · maintenance
```

Cada módulo tiene `domain/` (reglas puras), `application/` (casos de uso y `ports/`), `infrastructure/` (repositorios Prisma), `presentation/` (rutas y esquemas Zod) y `<modulo>.module.ts`. **ESLint impone las capas:** `domain` no importa librerías ni otras capas; `application` no importa infraestructura, Express, Prisma, Awilix ni Zod.

**Piezas clave**

- **`defineRoute`** (`src/shared/http/route.ts`): una declaración da método, ruta, `auth` (obligatorio: `'public' | 'authenticated' | Permission`), `rateLimit`, esquemas, respuestas con `errorCodes` y handler. De ahí salen validación, autenticación, permiso, rate limit y Swagger.
- **Pipeline:** rate limit → token → cambio de contraseña pendiente → permiso → validación Zod → handler → manejador de errores.
- **DI:** cada clase recibe `constructor({ dep1 }: Deps)`; cada módulo amplía `Cradle`. Las claves del contenedor son únicas.
- **Admin multiempresa:** `company_memberships` (quién tiene acceso a qué empresa) y `multi_company_admins` (su paquete). Un solo `companyId` por petición, como siempre: `POST /auth/active-company` emite una sesión con la empresa elegida (`refresh_tokens.company_id` la conserva al renovar) y `findById(id, { activeCompanyId })` solo la trae si la membresía sigue vigente, así quitar la empresa o suspenderla corta la sesión al instante. Gestión en el módulo `platform` (`multi-admin.*`, `portfolio.*`); `identity` solo lee las membresías. Triggers de BD exigen el rol en membresías y límites. Las vistas consolidadas (`/portfolio/summary`, `employees`, `timesheet`, `daily-reports` y sus CSV, de solo lectura) viven en `timekeeping` y `workforce`: el puerto compartido `PortfolioScope` (`shared/application/portfolio-scope.ts`, lo implementa `platform`) da las empresas **activas** de la persona desde sus membresías, y cada caso de uso consulta por empresa con las mismas piezas de la hoja y el resumen de una empresa o con un lector que filtra `companyId IN (...)`. Nunca hay una lista de empresas en el token ni viene del cliente; `companyId` es solo un filtro validado contra esa lista (404 si no es suya). Las suspendidas no cuentan.
- **Multiempresa:** `companyId` sale **solo** del token (`Actor`). Los repositorios exigen `companyId` y un recurso de otra empresa responde **404**. FKs compuestas `(company_id, id)` impiden cruces en la BD.
- **Transacciones:** `transactions.run(...)` (AsyncLocalStorage); los repositorios usan `db.client` y participan solos. Carreras: `SELECT … FOR UPDATE`, updates condicionales y concurrencia optimista.
- **Tareas periódicas:** `jobs(container)` en el `AppModule`, arrancadas por `main.ts`, idempotentes. Hoy: cerrar entradas que agotaron el límite diario (15 s), cerrar entradas de empleados desactivados (60 s) y limpiar datos viejos (1 h).
- **Auditoría:** `SecurityEventRecorder.record` es de mejor esfuerzo; `recordOrThrow` se usa **dentro de la transacción** en acciones sensibles del admin (si no se puede auditar, no se hace).
- **Eventos entre módulos:** por el bus (`workforce.employee_deactivated` lo consume `timekeeping`); ningún módulo importa a otro salvo el tipo del evento.
- **Errores:** `AppError` con `code` estable → `{ error: { code, message, details?, requestId } }`. Éxito: `{ data, meta? }`.
- **Imports:** aliases `#config/*`, `#shared/*`, `#modules/*`, `#generated/*`, con extensión `.js`.

**Cómo agregar cosas**

- **Endpoint:** caso de uso + test unitario → repositorio si hace falta → esquema Zod → `defineRoute` con `auth` y `errorCodes` → registrarlo en el `.module.ts` → test e2e → **`npm run docs:api`** (un test falla si `API.md` quedó desactualizado o si un `errorCodes` no lo lanza nada). Si cambias una regla que describe la guía, edita `docs/api-guide.md` a mano.
- **Módulo:** copiar `system` o `workforce`, exportar un `AppModule` y agregarlo a `src/modules/index.ts`.
- **Campo en una entidad:** `schema.prisma` + migración, vista del puerto, mapeo del repositorio, esquema Zod y regla de dominio.
- En Zod, un objeto con nombre que puede ser `null` se escribe `schema.or(z.null())`, no `.nullable()` (Swagger perdía el `null`).

## 5. Comandos

```bash
npm run dev              # http://localhost:3000/api/v1 · Swagger en /docs (solo fuera de producción)
npm run check            # typecheck + lint + tests unitarios
npm test                 # unitarios + e2e contra Postgres
npm run build
npm run db:migrate       # crea y aplica migración (desarrollo)
npm run db:migrate:create  # crea sin aplicar, para editar el SQL
npm run db:seed          # crea el admin global si no existe
npm run admin:recover    # rescate del admin global: temporal nueva, desbloqueo y cierre de sesiones
npm run docs:api         # regenera API.md
```

`.env` (plantilla en `.env.example`): `NODE_ENV` (obligatoria), `PORT`, `TRUST_PROXY_HOPS`, `CORS_ORIGINS`, `DATABASE_URL`, `JWT_SECRET` (≥64 caracteres, se rechazan valores de ejemplo), `JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`. Se validan con Zod en `src/config/env.ts`. Las políticas que no son secretos están en `src/config/security.ts`.

**BD local:** PostgreSQL en `localhost:5432`; desarrollo `worktime`, tests `worktime_test` (se deriva del `.env` agregando `_test`, se crea y migra sola; los tests se niegan a usar una BD que no termine en `_test`). **Nunca modifiques una migración ya aplicada** (cambia su checksum): crea una nueva.

## 6. Decisiones de dominio (resumen; el detalle está en `API.md` y `docs/api-guide.md`)

- IDs **UUID v7** generados por la app; fechas `timestamptz`; nada de borrado en cascada (se desactiva o suspende; la única excepción es eliminar a un empleado que nunca registró horas ni reportes, `DELETE /company/employees/{id}`, que borra su cuenta y su historial de accesos y deja el evento `employee.deleted`). Índices únicos parciales: una entrada abierta (no anulada) por empleado y un `company_admin` por empresa.
- **Zonas horarias:** todo instante en UTC; el empleado tiene zona IANA (si es `NULL`, hereda la de la empresa; por defecto `America/Denver`). Cada marcaje guarda una foto de `timezone` y `workDate` (día local de la entrada; los turnos nocturnos cuentan para ese día). Nunca desfases fijos. Los marcajes los registra el servidor con su hora.
- **Horas decimales:** segundos enteros como fuente de verdad; salida con 2 decimales, `floor((segundos + 18) / 36)` centésimas, redondeo **por marcaje** y luego suma (el SQL repite la fórmula).
- **Límite diario** (empresa y empleado; el del empleado manda; 1 a 1440 min): cierra la entrada en el instante exacto del límite (`closedBy: daily_limit`), con tarea periódica. El admin puede autorizar horas extra con `overrideDailyLimit`.
- **Reporte diario:** obligatorio por defecto (configurable por empresa); uno por empleado y día laboral, con historial de versiones. Si cierra el sistema o el admin, queda pendiente; un pendiente (solo desde `daily_report_required_since`, sin contar hoy) bloquea `POST /me/clock-in` (409 `DAILY_REPORT_PENDING`) pero no al admin.
- **Periodos de pago:** fijos de 14 días lunes a domingo desde 2026-09-21, iguales para todas las empresas (`domain/pay-period.ts`). El **cierre es definitivo, sin reapertura**: solo periodos ya terminados en UTC-12, sin entradas abiertas. Un periodo cerrado congela las horas (409 `PERIOD_CLOSED`) con el trigger `time_entries_period_lock` como red de seguridad. **Toda operación que cambie horas debe llamar `assertPeriodsOpen` dentro de su transacción.**
- **Anular:** no se borra (`voided_at`, `voided_by_id`, `void_reason`); un anulado no cuenta en nada. **Toda consulta nueva sobre `time_entries` debe filtrar `voided_at IS NULL`.** El empleado no ve los anulados.
- **Identificadores:** código de empresa aleatorio e inmutable (`K7QF-29MX`; identifica, no autentica); prefijo de 3 letras por empresa y código de empleado `PREFIJO-0001` consecutivo asignado por el sistema, que no se reutiliza ni se edita. Triggers de BD lo protegen. El teléfono del empleado es opcional e informativo.
- **Admin multiempresa:** solo el admin global lo crea (`/platform/multi-admins`), le asigna o quita empresas y fija su paquete. Él crea empresas con su admin dentro del paquete (`POST /portfolio/companies`; el máximo de empleados de cada una es el del paquete). Una empresa siempre nace con su `company_admin`; no hay empresas sin admin. No cambia `maxEmployees`, no suspende empresas ni toca su propio paquete. Siempre hay un solo admin global, creado por el seed.
- **Rescate del admin global** (`src/cli/recover-platform-admin.ts`, caso de uso `RecoverPlatformAdminUseCase` en `platform`): como nadie está por encima de él, se recupera **solo desde la consola del servidor**, sin ruta HTTP (tener acceso al servidor y a la BD es la autoridad). Le da una contraseña temporal de 16 caracteres que vence en 72 h, lo desbloquea, lo reactiva, incrementa `tokenVersion` y deja el evento `platform_admin.recovered` con `recordOrThrow`. Si hay cero o más de un admin global no toca nada (`PLATFORM_ADMIN_NOT_FOUND`, `PLATFORM_ADMIN_AMBIGUOUS`). La contraseña del seed solo sirve para el primer inicio de sesión, que obliga a cambiarla.
- **Sesiones:** `users.token_version` anula todos los access y refresh tokens al incrementarse (cambio o reset de contraseña, desactivación, `logout-all`, `revoke-sessions`). Solo se puede cerrar todas las sesiones, no una sola.
- **Limpieza** (`modules/maintenance`, `src/config/retention.ts`): borra sesiones completas viejas y `security_events` de más de 365 días, salvo las acciones del admin sobre la asistencia. Registros de horas, correcciones, reportes y cierres nunca se borran.
- **Actividad del admin** (`GET /company/activity`): solo sus acciones sobre la asistencia, sin inicios de sesión ni IPs.
- **Exportaciones CSV** (hoja de tiempo y reportes diarios, `presentation/csv.ts`): UTF-8 con BOM, textos que empiezan con `= + - @` con apóstrofo delante y límite `export`. La de reportes se acota a 5000 filas (`EXPORT_TOO_LARGE`).
- La documentación de la API se genera con `npm run docs:api` (`scripts/build-api-docs.ts` a partir del OpenAPI y `docs/api-guide.md`).

## 7. Seguridad (detalle en `docs/security.md`)

Contraseñas con argon2id · access token JWT de 15 min (se verifica en la BD en cada petición usuario, empresa, `tokenVersion`, rol y empresa) · refresh tokens opacos, hasheados, rotativos, con detección de reuso y duración máxima de 30 días · bloqueo progresivo tras 3 intentos (30 s, se duplica hasta 15 min) · contraseñas temporales de 16 caracteres que vencen en 72 h · rate limit por IP y por acción (`heavyRead`, `export`, `sensitive`) · Zod `.strict()`, solo JSON, cuerpo máximo de 100 KB, helmet, CORS con lista blanca, `Cache-Control: no-store` · fechas de timekeeping limitadas a los años 2000 a 2100 · logs con redacción de secretos · auditoría en `security_events`. Hubo dos revisiones independientes con hallazgos corregidos.

## 8. Tests

- Unitarios junto al código (`src/**/*.test.ts`) y e2e en `test/*.test.ts` contra Postgres real. Corre `npm test` para el conteo actual.
- **`test/authorization-matrix.test.ts`** recorre todas las rutas con cada rol. Solo pueden ser públicas `health`, `login`, `refresh` y `logout`. Las rutas que cierran sesiones (`logout-all`) se prueban aparte, al final (`SESSION_KILLER_ROUTES`).
- Helpers en `test/helpers/`: `createTestApp()` (`{ app, clock, container }`, reloj falso), `login`, `bearer`, `api`, y fixtures `createCompany`, `createUser`, `createEmployee`, `companyIdentifiers()`, `employeeCodeFor()`. `createCompany` crea la empresa **sin exigir reporte diario** y con `dailyReportRequiredSince` en el año 2000.
- Los tests de cierre de periodo fijan el reloj en 2026-10-07.
- **Trampa:** al adelantar el `FakeClock` más de 15 minutos los access tokens vencen; inicia sesión en la hora simulada (helper `asUser` en `test/timekeeping.test.ts`).
- **Fallo conocido en Windows:** al correr toda la suite Vitest a veces pierde un proceso (exit code `0xC0000409`) y el conteo sale incompleto, sin tests fallidos. Corre cada archivo por separado (`npx vitest run test/<archivo>.test.ts`) y repite el que falle.

## 9. Estado y pendientes

**MVP completo y endurecido** para los tres roles.

**Docker (hecho para la api):** `Dockerfile` multi-stage sin root y `docker-compose.yml` con `migrate` (`prisma migrate deploy` y seed) y `api` (publicada solo en 127.0.0.1, `TRUST_PROXY_HOPS` por `.env`). Usa el PostgreSQL del servidor: la base se crea a mano y su `DATABASE_URL` va en el `.env` (host `host.docker.internal`). Guía en `docs/deployment.md`. **Falta, solo cuando el usuario lo pida:** contenedor del front, HTTPS vía Tailscale, respaldos diarios con prueba de restauración, CI con GitHub Actions (lint, typecheck, tests y audit).

**Aplazado:** correos con Resend (recuperación de contraseña, invitación; requiere dominio verificado). **Por confirmar:** pruebas de carga y concurrencia, front real nuevo, periodos configurables por empresa.

**Descartado por el usuario:** solicitudes de corrección del empleado, pausas y almuerzos (se resuelven con salida y entrada) y alertas de entradas olvidadas.

**Sin hacer a propósito (bajo impacto):** tope de duración de un marcaje; restricción `btree_gist` contra marcajes cruzados; que el apagado espere a la tarea en curso; costo del `FOR SHARE` sobre la fila de la empresa al escalar.

**Ideas para después:** sucursales y departamentos, horarios y turnos, solicitudes (vacaciones, permisos), nómina, rol supervisor, API keys y webhooks firmados, planes y cobro, Row Level Security.

**Riesgos aceptados:** el admin de empresa puede enterarse de que un email existe (`EMAIL_TAKEN`); el access token vive hasta 15 min tras el logout; dos pestañas que renuevan a la vez cierran la sesión.
