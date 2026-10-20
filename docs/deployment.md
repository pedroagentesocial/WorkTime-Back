# Despliegue con Docker

La API corre con `docker compose` y usa el PostgreSQL que ya tiene el servidor. No se crea ningún contenedor de base de datos.

## Piezas

| Servicio  | Qué hace                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `migrate` | Aplica las migraciones y termina. También sirve para el seed.                                                 |
| `api`     | La API en modo producción, sin root, con sistema de archivos de solo lectura. Se publica solo en `127.0.0.1`. |

## Antes de empezar: la base de datos

En el PostgreSQL del servidor, crea un usuario y una base solo para WorkTime (cambia la contraseña):

```sql
CREATE ROLE worktime LOGIN PASSWORD 'una-contraseña-segura';
CREATE DATABASE worktime OWNER worktime;
```

El usuario debe ser dueño de la base, porque las migraciones crean y cambian tablas. Usa PostgreSQL 16 o superior (el proyecto se probó con la 18).

El PostgreSQL debe aceptar conexiones desde Docker. Desde un contenedor, el servidor se alcanza con el nombre `host.docker.internal`. Hay que:

1. Que PostgreSQL escuche en la interfaz de Docker (`listen_addresses` en `postgresql.conf`).
2. Permitir al usuario `worktime` desde la red de Docker (una línea en `pg_hba.conf`, por ejemplo `host worktime worktime 172.16.0.0/12 scram-sha-256`).
3. Si hay firewall, permitir el puerto 5432 solo desde esa red.

## Primera vez

1. Instala Docker con Compose en el servidor y clona el repositorio.
2. Crea un `.env` a partir de `.env.example` y completa `DATABASE_URL`, `CORS_ORIGINS`, `JWT_SECRET` (64 o más caracteres) y `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` para el primer admin. En `DATABASE_URL` el servidor es `host.docker.internal`, por ejemplo `postgresql://worktime:CONTRASEÑA@host.docker.internal:5432/worktime`. Si la contraseña tiene símbolos, codifícalos para URL.
3. Levanta todo: `docker compose up -d --build`. Espera a que `docker compose ps` muestre `api` en `healthy`.
4. Crea el admin global, una sola vez: `docker compose run --rm migrate npm run db:seed`. Después puedes quitar `SEED_ADMIN_PASSWORD` del `.env`.

## Rescatar al admin global

Si el admin global olvidó su contraseña o quedó bloqueado, desde el servidor:

```bash
docker compose run --rm --no-deps api node dist/cli/recover-platform-admin.js
```

Muestra **una sola vez** una contraseña temporal que vence en 72 h y obliga a cambiarla al entrar. También quita el bloqueo por intentos, reactiva la cuenta y cierra todas sus sesiones. Queda el evento `platform_admin.recovered` en `security_events`. No hay ruta HTTP para esto: solo lo puede hacer quien tiene acceso al servidor. En desarrollo es `npm run admin:recover`.

## Actualizar

```bash
git pull
docker compose up -d --build
```

`migrate` corre primero y la API arranca solo si las migraciones terminaron bien.

## Proxy y rate limit

La API escucha en `127.0.0.1:${API_PORT}` (3000 si no defines `API_PORT`). Para exponerla usa un proxy, por ejemplo Tailscale o nginx, y define `TRUST_PROXY_HOPS` con el número de proxies delante de la API. Con 0 el rate limit ve una sola IP, la del proxy. Con un valor mayor al real, un cliente podría falsificar su IP.

## Datos y respaldos

Los datos viven en el PostgreSQL del servidor, así que sus respaldos los cubren los del servidor. Si no existen, hacen falta respaldos diarios de la base `worktime` con prueba de restauración (pendiente).
