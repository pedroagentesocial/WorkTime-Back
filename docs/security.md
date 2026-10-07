# Seguridad de WorkTime API

Estado a la fecha de la última revisión (auditoría interna independiente + verificación de
correcciones). Sin hallazgos críticos ni altos abiertos.

## Controles implementados

**Aislamiento entre empresas**

- La empresa (`companyId`) sale solo del token verificado, nunca del cliente.
- Todo repositorio exige `companyId`; un recurso de otra empresa responde 404 (no se revela).
- Llaves foráneas compuestas `(company_id, id)` en la BD: un registro no puede apuntar a datos de otra empresa.
- Matriz de autorización automática (`test/authorization-matrix.test.ts`) sobre TODAS las rutas.

**Autenticación y sesiones**

- Contraseñas con Argon2id (parámetros OWASP) y rehash automático.
- JWT HS256 de 15 min con algoritmo fijado, `iss`/`aud`/`exp` obligatorios.
- En cada petición se verifica en la BD: usuario activo, empresa activa, `tokenVersion`, rol y empresa.
- Refresh tokens opacos, guardados como SHA-256, rotativos, con detección de reuso (revoca la sesión entera), ligados a `tokenVersion` y con duración máxima absoluta de 30 días.
- Admin multiempresa: la empresa activa va en el token y se valida contra `company_memberships` en cada petición (y al renovar la sesión); sin membresía vigente o con la empresa suspendida la sesión muere al instante. Una empresa ajena responde 404 igual que una inexistente. Los límites del paquete se deciden con la fila de límites bloqueada (`FOR UPDATE`), así dos altas a la vez no pasan del máximo, y las acciones sobre membresías y paquetes se auditan dentro de la transacción (`recordOrThrow`).
- Vistas consolidadas del admin multiempresa: la lista de empresas sale siempre de `company_memberships` (solo activas) vía `PortfolioScope`; el `companyId` del cliente solo filtra dentro de esa lista y una empresa ajena responde 404. Son de solo lectura y los CSV neutralizan fórmulas como el resto.
- Bloqueo tras 3 intentos fallidos: 30 s, duplicándose en cada reincidencia hasta 15 min (`users.lock_level`, se reinicia al entrar bien o tras 15 min sin reincidir), con reserva atómica del intento: ni con ráfagas en paralelo se prueban más contraseñas.
- Login sin enumeración: mismo mensaje y trabajo equivalente para email inexistente, contraseña incorrecta o cuenta bloqueada.
- Contraseñas temporales aleatorias (CSPRNG), vencen en 72 h, obligan a cambiarse y no sirven para renovar sesión una vez vencidas.

**Entrada y HTTP**

- Validación Zod estricta en todos los cuerpos (se rechazan campos extra: sin asignación masiva).
- Solo `application/json` (415), cuerpo máx. 100 KB, `Cache-Control: no-store`, helmet, CORS con lista blanca (`*` prohibido en producción).
- Rate limit por IP global y por endpoint sensible; el login además por IP + cuenta.
- Timeouts de servidor (anti slowloris) y cierre ordenado ante errores fatales (código de salida 1).
- SQL solo parametrizado (ESLint prohíbe `$queryRawUnsafe`).

**Integridad de datos**

- Una sola entrada abierta por empleado (índice único parcial).
- Límite de empleados y correcciones serializados con `SELECT … FOR UPDATE`; correcciones con concurrencia optimista (`TIME_ENTRY_CHANGED`).
- Restricciones `CHECK` en la BD; nada se borra en cascada; toda corrección queda auditada.

**Auditoría y logs**

- `security_events`: logins, bloqueos, cambios de contraseña, altas/bajas, suspensiones, etc.
- Logs sin secretos (redacción de campos sensibles) y sin mensajes de error de Prisma (pueden traer datos).
- `NODE_ENV` obligatorio: la API nunca arranca "en desarrollo" por olvido.

## Riesgos aceptados (documentados)

| Riesgo                                                                                            | Motivo                                                    | Mitigación                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un admin de empresa puede saber si un email existe en el sistema (`EMAIL_TAKEN`)                  | El email es la identidad de acceso y es único global      | Requiere crear usuarios; queda auditado                                                                                                                                                                                  |
| Tras logout, el access token vive hasta 15 min                                                    | JWT sin estado                                            | Vida corta; cambio de contraseña/desactivación lo anulan al instante                                                                                                                                                     |
| Dos pestañas que renuevan a la vez pueden cerrar la sesión                                        | Es la detección de reuso funcionando                      | El cliente vuelve a iniciar sesión                                                                                                                                                                                       |
| Un atacante puede bloquear una cuenta conocida (hasta 15 min si insiste)                          | Contrapartida del bloqueo por intentos                    | Bloqueo temporal; el admin puede restablecer la contraseña                                                                                                                                                               |
| `npm audit`: `braces` (DoS por patrones anidados) llega vía `awilix` > `fast-glob` > `micromatch` | Aviso sin versión corregida (`braces` 3.0.3 es la última) | `awilix` solo usa glob en `loadModules`, que no se usa (todo se registra a mano); no ejecutar `npm audit fix --force`, que instalaría una versión vieja de `awilix`. Revisar de nuevo cuando salga una versión corregida |

## Pendiente para el despliegue (fase Docker)

- Configurar `trust proxy` con los saltos reales del proxy; si no, todos los clientes parecerán una sola IP y el rate limit afectará a todos.
- HTTPS obligatorio (HSTS ya está activo).
- Usuario de PostgreSQL con permisos mínimos (sin DDL) y otro solo para migraciones; SSL hacia la BD.
- Respaldos automáticos y prueba de restauración.
- Store compartido (Redis) para el rate limit si hay más de una instancia.
- Mantener Node actualizado (reglas de zonas horarias) y `npm audit` en CI.
- Si se agrega limpieza de refresh tokens viejos, conservar el primero de cada sesión (se usa para la duración máxima).
