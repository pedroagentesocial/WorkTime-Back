# WorkTime API — Guía de uso

API de control de asistencia multiempresa. Este documento explica **cómo funciona** y **cómo usarla** desde un front propio o desde cualquier otro sistema (por ejemplo, un CRM). Al final está la **referencia de cada endpoint**, generada automáticamente del código para que nunca se desincronice.

> **Fuente de verdad.** Si algo de este documento contradice a la API real, manda la API. Con la API corriendo fuera de producción, Swagger está en `/docs` y el contrato en formato OpenAPI en `/docs/openapi.json`.
> **Este archivo es generado.** La guía se edita en `docs/api-guide.md` y se regenera con `npm run docs:api`. Un test falla si `API.md` quedó desactualizado.

## Contenido

1. [Conceptos básicos](#1-conceptos-básicos)
2. [Inicio rápido](#2-inicio-rápido)
3. [Convenciones de la API](#3-convenciones-de-la-api)
4. [Autenticación y sesiones](#4-autenticación-y-sesiones)
5. [Roles y permisos](#5-roles-y-permisos)
6. [Reglas de negocio que conviene conocer](#6-reglas-de-negocio-que-conviene-conocer)
7. [Guía por pantalla: el empleado](#7-guía-por-pantalla-el-empleado)
8. [Guía por pantalla: el admin de empresa](#8-guía-por-pantalla-el-admin-de-empresa)
9. [Guía por pantalla: el admin global](#9-guía-por-pantalla-el-admin-global)
10. [Qué hacer ante cada error](#10-qué-hacer-ante-cada-error)
11. [Integrarla con otro sistema](#11-integrarla-con-otro-sistema)
12. [Referencia de endpoints](#12-referencia-de-endpoints)

---

## 1. Conceptos básicos

**Empresas.** El sistema es multiempresa. Cada empresa tiene su propio administrador y sus empleados, y **nunca ve datos de otra**. La empresa se identifica por su `id` (UUID) y por un **código** legible como `K7QF-29MX`, pensado para soporte (por ejemplo, si alguien pide por correo restablecer una contraseña). El código **identifica, no autentica**: no es un secreto.

**Roles.** Hay cuatro:

| Rol                                        | Qué hace                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_admin` (admin global)            | Crea, edita y suspende empresas. No pertenece a ninguna.                                                                                             |
| `company_admin` (admin de empresa)         | Uno por empresa. Gestiona empleados, ve y corrige la asistencia, cierra periodos. **No marca asistencia.**                                           |
| `multi_company_admin` (admin multiempresa) | Una persona que administra **varias empresas**, solo las que el admin global le asigna o las que crea dentro de su paquete. Trabaja en una a la vez. |
| `employee` (empleado)                      | Marca entrada y salida, escribe su reporte diario y consulta su historial.                                                                           |

**Marcajes (`time entries`).** Un marcaje es una jornada con entrada y salida. Un empleado puede tener **varios por día** (por ejemplo, salir a comer y volver a entrar), pero **solo uno abierto a la vez**. No hay "pausas": una pausa es una salida y una entrada.

**Día laboral (`workDate`).** Es la fecha **local** del empleado en la que empezó el marcaje. Un turno nocturno cuenta para el día en que empezó.

**Quién pone la hora.** Siempre el **servidor**. El cliente nunca manda la hora de un marcaje. Solo el admin puede indicar horas, al crear o corregir un registro.

**Periodos de pago.** Son de 14 días, de lunes a domingo, y el primero empezó el **2026-09-21**. Son iguales para todas las empresas. El admin **cierra** un periodo cuando ya está revisado, y desde ese momento sus horas quedan **congeladas para siempre**.

**Reporte diario.** Un texto de lo que el empleado hizo ese día. Por defecto la empresa lo exige al marcar cada salida (es configurable).

**Códigos.** Cada empresa tiene un código (`K7QF-29MX`) y un prefijo de tres letras (`KCS`). Cada empleado recibe un código consecutivo asignado por el sistema: `KCS-0001`, `KCS-0002`... No se escribe ni se edita, y un número nunca se reutiliza.

---

## 2. Inicio rápido

La URL base es `/api/v1`. En desarrollo: `http://localhost:3000/api/v1`.

**1. Iniciar sesión**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@empresa.com","password":"su-contraseña"}'
```

```json
{
  "data": {
    "tokenType": "Bearer",
    "accessToken": "eyJhbGciOi...",
    "accessTokenExpiresAt": "2026-10-07T18:15:00.000Z",
    "refreshToken": "q3Vf...",
    "refreshTokenExpiresAt": "2026-10-14T18:00:00.000Z",
    "user": {
      "id": "0199...",
      "email": "ana@empresa.com",
      "firstName": "Ana",
      "lastName": "López",
      "role": "employee",
      "mustChangePassword": false,
      "company": {
        "id": "0199...",
        "code": "K7QF-29MX",
        "name": "Taller Pérez",
        "timezone": "America/Denver"
      },
      "permissions": ["attendance.clock_own", "attendance.read_own"]
    }
  }
}
```

**2. Ver el estado y marcar entrada**

```bash
curl -s http://localhost:3000/api/v1/me/clock-status -H "Authorization: Bearer <accessToken>"
curl -s -X POST http://localhost:3000/api/v1/me/clock-in -H "Authorization: Bearer <accessToken>"
```

**3. Marcar salida** (con el reporte del día si la empresa lo exige)

```bash
curl -s -X POST http://localhost:3000/api/v1/me/clock-out \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"dailyReport":"Atendí a tres clientes y cerré el inventario."}'
```

Respuesta de la salida (un marcaje, con las horas calculadas por el servidor):

```json
{
  "data": {
    "id": "0199...",
    "status": "closed",
    "clockInAt": "2026-10-07T14:00:00.000Z",
    "clockOutAt": "2026-10-07T22:30:00.000Z",
    "clockInLocal": "2026-10-07T08:00:00-06:00",
    "clockOutLocal": "2026-10-07T16:30:00-06:00",
    "timezone": "America/Denver",
    "workDate": "2026-10-07",
    "durationSeconds": 30600,
    "durationHours": 8.5,
    "source": "web",
    "closedBy": "employee",
    "createdReason": null,
    "corrected": false
  }
}
```

---

## 3. Convenciones de la API

**Formato.** Todo es JSON (`Content-Type: application/json`). Un cuerpo con otro tipo responde `415`. El cuerpo máximo es de 100 KB (`413`). Los cuerpos **no aceptan campos desconocidos**: un campo de más responde `400`. La única respuesta que no es JSON es la exportación a CSV.

**Respuesta exitosa.**

```json
{ "data": {}, "meta": {} }
```

`data` es el recurso (o una lista de recursos). `meta` solo aparece cuando hay datos adicionales, por ejemplo la paginación.

**Respuesta de error.** Siempre con esta forma:

```json
{
  "error": {
    "code": "DAILY_REPORT_PENDING",
    "message": "Tienes reportes del día pendientes; escríbelos para poder marcar entrada",
    "details": { "dates": ["2026-10-05"] },
    "requestId": "0199..."
  }
}
```

- **`code`** es estable: úsalo en tu código para decidir qué hacer. **`message`** está en español y se puede mostrar al usuario, pero puede cambiar.
- **`details`** es opcional y su forma depende del error. En los errores de validación (`VALIDATION_ERROR`, HTTP 400) es una lista:

```json
{
  "location": "body",
  "path": "reason",
  "message": "Too small: expected string to have >=5 characters"
}
```

- **`requestId`** también viaja en el encabezado `X-Request-Id`. Inclúyelo al reportar un problema.

**Códigos HTTP.** `200` y `201` (creado) y `204` (sin contenido) son éxito. `400` datos inválidos, `401` sin sesión válida, `403` sin permiso, `404` no existe (o es de otra empresa), `409` conflicto con una regla de negocio, `413`, `415`, `429` demasiadas peticiones, `500` error inesperado. Estos cuatro últimos pueden darse en cualquier endpoint, así que **no se repiten** en la referencia.

**Paginación.** Los listados aceptan `page` (desde 1) y `limit` (de 1 a 100, por defecto 20) y devuelven:

```json
{ "data": [], "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }
```

**Identificadores.** Todos los `id` son UUID (versión 7).

**Fechas y horas.**

| Tipo       | Formato              | Ejemplo                     | Dónde                                      |
| ---------- | -------------------- | --------------------------- | ------------------------------------------ |
| Instante   | ISO 8601 en **UTC**  | `2026-10-07T14:00:00.000Z`  | Todos los campos `...At` de las respuestas |
| Hora local | ISO 8601 con desfase | `2026-10-07T08:00:00-06:00` | Campos `...Local` de las respuestas        |
| Día        | `AAAA-MM-DD`         | `2026-10-07`                | `workDate`, `date`, `from`, `to`           |

- Cuando **mandas** un instante (por ejemplo al crear un registro manual) puedes usar UTC o una hora local **con su desfase**. Una hora sin desfase se rechaza.
- Las fechas deben estar entre los años 2000 y 2100.
- La zona horaria es el nombre IANA (`America/Denver`, `America/Mexico_City`), nunca un desfase fijo.

**Horas decimales.** Las duraciones se calculan en segundos y se muestran como horas con **2 decimales, redondeadas al más cercano** (por ejemplo `8.52`). Los totales se calculan **sumando las horas ya redondeadas de cada marcaje**, para que siempre cuadren con lo que se ve. Solo cuentan los marcajes **cerrados**.

**Límites de uso.** Si excedes un límite recibes `429` con `error.code = TOO_MANY_REQUESTS`. Los encabezados `RateLimit`, `RateLimit-Policy` y `Retry-After` indican cuánto esperar. Los límites son por IP:

| Límite             | Ventana    | Peticiones                    | A qué aplica                                                                                                         |
| ------------------ | ---------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Global             | 1 minuto   | 300                           | Todo                                                                                                                 |
| Inicio de sesión   | 15 minutos | 10 por IP y email, 100 por IP | `POST /auth/login`                                                                                                   |
| Renovar sesión     | 15 minutos | 120                           | `POST /auth/refresh`                                                                                                 |
| Acciones sensibles | 15 minutos | 30                            | cerrar sesión, cambiar contraseña, cerrar todas las sesiones, cerrar las sesiones de un empleado y cerrar un periodo |
| Consultas pesadas  | 1 minuto   | 60                            | resumen del día, actividad, hoja de tiempo de la empresa, estado del periodo y reportes pendientes de la empresa     |
| Exportaciones      | 15 minutos | 20                            | descarga de CSV                                                                                                      |

**Seguridad HTTP.** Si llamas desde un navegador, el origen del front debe estar en la lista `CORS_ORIGINS` del servidor. Las llamadas de servidor a servidor no pasan por CORS.

**Salud del servicio.** `GET /health` es público y no necesita token. Responde `{ "data": { "status": "ok", "checks": { "database": "up" }, ... } }`.

---

## 4. Autenticación y sesiones

La API usa **tokens JWT**. Todas las rutas, salvo cuatro, exigen el encabezado:

```
Authorization: Bearer <accessToken>
```

Las rutas públicas son `GET /health`, `POST /auth/login`, `POST /auth/refresh` y `POST /auth/logout`.

### Los dos tokens

| Token          | Duración   | Para qué                                          |
| -------------- | ---------- | ------------------------------------------------- |
| `accessToken`  | 15 minutos | Se manda en cada petición                         |
| `refreshToken` | 7 días     | Se cambia por un par nuevo cuando el access vence |

Además, una sesión dura **como máximo 30 días desde el inicio de sesión**, aunque se renueve siempre. Pasado ese tiempo hay que iniciar sesión de nuevo (`SESSION_MAX_AGE_REACHED`).

### Renovar la sesión

Cuando una petición responde `401` con `TOKEN_EXPIRED`, llama a `POST /auth/refresh` con el `refreshToken` y repite la petición original con el token nuevo.

**Reglas importantes:**

- **Cada refresh token se usa una sola vez.** La respuesta trae un par nuevo y el anterior queda anulado: guarda siempre el nuevo.
- Si se **reutiliza** un refresh token ya usado, el sistema asume que fue robado y **cierra toda esa sesión**. Por eso nunca hay que reintentar un refresh con el mismo token.
- Si dos pestañas o procesos renuevan **a la vez** con el mismo token, uno de los dos cerrará la sesión. El cliente debe hacer **un solo refresh a la vez** (y que las demás peticiones esperen el resultado).
- Guarda el refresh token en un lugar seguro. En un navegador, evita `localStorage` si puedes y no lo expongas a scripts de terceros.

### Cerrar sesión

- `POST /auth/logout` con el refresh token cierra esa sesión. Siempre responde `204`.
- `POST /auth/me/logout-all` cierra **todas** las sesiones del usuario, **también la actual**, y es inmediato.
- Un admin puede cerrar todas las sesiones de un empleado con `POST /company/employees/{id}/revoke-sessions`.

> Un access token **ya emitido** deja de servir al instante si el usuario cambia su contraseña, es desactivado, se le cierran todas las sesiones o su empresa se suspende. En cada petición el servidor lo verifica.

### Acceso de una cuenta nueva o restablecida

Al dar de alta a un empleado, una empresa con su admin o un admin multiempresa, y al restablecer la contraseña de alguien, la persona recibe su acceso de una de dos formas (campo `delivery` del cuerpo; sin él, por correo):

- **`email`** (por defecto): le llega un correo con un enlace de un solo uso para crear su contraseña (`APP_URL/crear-contrasena?token=…` al darla de alta, `APP_URL/restablecer-contrasena?token=…` al restablecer). Vence a las **72 horas** y se confirma con `POST /auth/password-reset/confirm`. Nadie ve ninguna contraseña. Si el correo no sale, la respuesta trae `emailSent: false`: se reenvía con el botón de restablecer o se le da una temporal.
- **`temporary_password`**: para quien no usa correo. Se usa también, sin pedirlo, si los correos no están configurados o el correo es de un dominio de pruebas (`.test`, `.example`…).

La respuesta trae `delivery`, `emailSent`, `temporaryPassword` (solo con la temporal; `null` con correo) y `temporaryPasswordExpiresAt` (cuándo vence el enlace o la temporal). Restablecer, por cualquiera de las dos vías, deja sin servir la contraseña anterior y cierra sus sesiones.

### Contraseña temporal

Cuando se elige la **contraseña temporal**, se muestra **una sola vez** y dura 72 horas.

1. El usuario inicia sesión con ella. La respuesta trae `user.mustChangePassword: true`.
2. Mientras tenga contraseña temporal, **solo puede** consultar `GET /auth/me`, cambiar la contraseña con `PATCH /auth/me/password` y cerrar sus sesiones. Cualquier otra ruta responde `403 PASSWORD_CHANGE_REQUIRED`.
3. Al cambiarla, la respuesta trae una **sesión nueva** y las anteriores se cierran.

Una contraseña nueva debe tener **al menos 12 caracteres** (máximo 128), ser distinta de la actual, no ser igual al email y no ser una contraseña trivial (un mismo carácter repetido, `123456789012`, `password1234`...). Si no cumple, responde `400 WEAK_PASSWORD` con los motivos en `error.details`.

### Recuperar la contraseña por correo

Quien olvidó su contraseña la recupera sin sesión:

1. `POST /auth/password-reset` con su `email`. Si es de una cuenta con acceso, le llega un correo con un enlace a `APP_URL/restablecer-contrasena?token=…`. Responde **siempre `204`**, exista o no la cuenta, para no revelar qué correos están registrados. Manda como máximo un correo por minuto a la misma persona.
2. `POST /auth/password-reset/confirm` con ese `token` y la `newPassword`. Pone la contraseña nueva, **cierra todas las sesiones** y quita el bloqueo por intentos. Después hay que iniciar sesión.

El enlace sirve **una sola vez** y vence a los **30 minutos**; pedir otro anula el anterior. Un enlace usado, vencido o inventado responde `400 INVALID_RESET_TOKEN`. El admin global no se recupera por aquí, solo desde la terminal del servidor (`npm run admin:recover`), ni las cuentas desactivadas o de una empresa suspendida. Los correos salen por Resend con `RESEND_API_KEY`, `EMAIL_FROM` y `APP_URL` del `.env` (sin ellas la API funciona y no envía correos) y nunca a dominios reservados para pruebas (`.test`, `.example`, `.invalid`, `.localhost`).

### Bloqueo por intentos fallidos

Tres intentos fallidos de iniciar sesión bloquean la cuenta **30 segundos**. El bloqueo es progresivo: cada reincidencia duplica la espera (1, 2, 4 minutos…) hasta un máximo de 15 minutos, y vuelve a 30 segundos si pasan 15 minutos sin reincidir o al iniciar sesión bien. El login nunca revela si el email existe: ante un error responde siempre `401 INVALID_CREDENTIALS`.

### Cliente de ejemplo (JavaScript)

Un cliente mínimo que renueva el token solo y evita refrescos simultáneos:

```js
class WorkTimeClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl; // por ejemplo http://localhost:3000/api/v1
    this.session = null; // { accessToken, refreshToken }
    this.refreshing = null; // un solo refresh a la vez
  }

  async login(email, password) {
    const { data } = await this.#send('POST', '/auth/login', {
      body: { email, password },
      auth: false,
    });
    this.session = data;
    return data.user;
  }

  async #refresh() {
    this.refreshing ??= this.#send('POST', '/auth/refresh', {
      body: { refreshToken: this.session.refreshToken },
      auth: false,
    })
      .then(({ data }) => {
        this.session = data;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async request(method, path, { query, body } = {}) {
    try {
      return await this.#send(method, path, { query, body });
    } catch (error) {
      if (error.code !== 'TOKEN_EXPIRED' || !this.session) throw error;
      await this.#refresh(); // si falla, hay que iniciar sesión de nuevo
      return this.#send(method, path, { query, body });
    }
  }

  async #send(method, path, { query, body, auth = true } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.session) headers.Authorization = `Bearer ${this.session.accessToken}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return { data: null };
    const json = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(json.error.message), json.error, { status: response.status });
    }
    return json; // { data, meta }
  }
}

// Uso
const client = new WorkTimeClient('http://localhost:3000/api/v1');
await client.login('ana@empresa.com', 'su-contraseña');
const { data: status } = await client.request('GET', '/me/clock-status');
```

---

## 5. Roles y permisos

Cada endpoint exige un **permiso**, no un rol. Cada rol tiene un conjunto de permisos:

| Permiso                      | Admin global | Admin de empresa | Admin multiempresa | Empleado |
| ---------------------------- | :----------: | :--------------: | :----------------: | :------: |
| `companies.manage`           |      sí      |                  |                    |          |
| `multi_admins.manage`        |      sí      |                  |                    |          |
| `portfolio.read`             |              |                  |         sí         |          |
| `portfolio.companies.create` |              |                  |         sí         |          |
| `company.settings.manage`    |              |        sí        |         sí         |          |
| `employees.manage`           |              |        sí        |         sí         |          |
| `attendance.read_all`        |              |        sí        |         sí         |          |
| `time_entries.correct`       |              |        sí        |         sí         |          |
| `attendance.clock_employees` |              |        sí        |         sí         |          |
| `periods.manage`             |              |        sí        |         sí         |          |
| `pay.manage`                 |              |        sí        |         sí         |          |
| `attendance.clock_own`       |              |                  |                    |    sí    |
| `attendance.read_own`        |              |                  |                    |    sí    |

`GET /auth/me` devuelve la lista de `permissions` del usuario: sirve para decidir qué pantallas y botones mostrar. Un usuario que intenta usar un endpoint sin el permiso recibe `403 FORBIDDEN`.

**Aislamiento entre empresas.** La empresa **sale siempre del token**, nunca de lo que mande el cliente. Un recurso de otra empresa responde `404`, igual que uno que no existe.

**Admin multiempresa.** No tiene empresa propia: su acceso son las empresas que tiene asignadas. Al iniciar sesión **no tiene empresa activa**; con `POST /auth/active-company` elige una mandando también el `refreshToken` de su sesión actual, que se cambia por un par nuevo cuya empresa activa es esa (el refresh token enviado queda anulado y la sesión conserva su duración máxima de 30 días; un token ajeno, ya usado o vencido responde `401 INVALID_REFRESH_TOKEN`). Desde ahí todo funciona como para un admin de esa empresa y solo ve sus datos. Con `companyId: null` vuelve a quedar sin empresa activa. Si le quitan la empresa o la suspenden, su sesión en ella deja de servir de inmediato (`SESSION_REVOKED` o `COMPANY_SUSPENDED`) y no se puede renovar. Sin empresa activa, las rutas de empresa responden `403 COMPANY_REQUIRED`.

---

## 6. Reglas de negocio que conviene conocer

### Límite diario de trabajo

- La empresa puede definir un máximo de minutos por día laboral (`dailyLimitMinutes`, de 1 a 1440), y cada empleado puede tener el suyo (el del empleado manda). `null` significa sin límite.
- Se cuenta por **día laboral** y suma todos los marcajes del día.
- Al agotarse, la entrada abierta se cierra sola **en el instante exacto del límite** (`closedBy: "daily_limit"`) y el empleado no puede volver a marcar entrada ese día (`409 DAILY_LIMIT_REACHED`).
- El admin puede **autorizar horas extra** marcando la entrada con `overrideDailyLimit: true`: esa entrada no se cierra sola.
- Un marcaje puede verse abierto hasta 15 segundos después de pasar el límite, hasta que corre la tarea automática.

### Reporte diario

- Si la empresa lo exige (por defecto sí, `requireDailyReport`), `POST /me/clock-out` necesita `dailyReport` (de 10 a 2000 caracteres) **en cada salida**.
- Se manda **completo**: `GET /me/clock-status` trae `dailyReport.content` con el texto ya escrito ese día para mostrarlo cargado, y el empleado lo confirma o le agrega. El reporte reemplaza al anterior, y las versiones previas quedan guardadas (el admin las consulta).
- El reporte y la salida van juntos: si el reporte no es válido, no se marca la salida.
- Solo se edita el **mismo día laboral**. Un reporte de un día anterior ya escrito no se edita (`DAILY_REPORT_LOCKED`).
- Si **el sistema o el admin** cerraron la entrada (límite diario, o el admin marcó la salida), el reporte no se exige en ese momento: queda **pendiente**.

### Reportes pendientes y bloqueo de la entrada

- Un día es **pendiente** si tuvo marcajes (todos cerrados), no tiene reporte y es de los **últimos 14 días**, sin contar hoy. Solo aplica si la empresa exige el reporte y solo desde que lo exige.
- Mientras un empleado tenga días pendientes, `POST /me/clock-in` responde `409 DAILY_REPORT_PENDING` con las fechas en `error.details.dates`. Los escribe con `PUT /me/daily-reports/{date}`.
- `GET /me/clock-status` trae `pendingReports` y `canClockIn` para mostrar el botón desactivado **antes** de que lo intente.
- **El admin sí puede marcarle la entrada** a un empleado con pendientes.
- Los reportes se pueden seguir escribiendo aunque el periodo esté cerrado.

### Correcciones del propio empleado

- El admin puede dejar que un empleado corrija **sus propias horas** (`allowSelfEdit` en `PATCH /company/employees/{id}`), por un tiempo opcional en minutos (`selfEditMinutes`, hasta 365 días): el servidor calcula con su hora cuándo vence y lo devuelve en `selfEditUntil`. Con `null` dura hasta que lo quite, y puede quitarlo antes con `allowSelfEdit: false`.
- Con el permiso, `PATCH /me/time-entries/{id}` cambia la entrada o la salida de un marcaje suyo, también para poner la salida que olvidó un día anterior. El motivo es obligatorio.
- Solo de los últimos días que elige la empresa (`selfEditDays` en `PATCH /company`, de 1 a 31, 7 por defecto) y nunca en un periodo cerrado (`409 SELF_EDIT_OUT_OF_RANGE`, `PERIOD_CLOSED`). La entrada abierta de hoy se termina con la salida (`409 SELF_EDIT_OPEN_TODAY`) y el cambio no puede pasar su límite diario (`409 SELF_EDIT_OVER_LIMIT`; una entrada abierta de un día anterior se mide hasta ahora, y un marcaje con horas extra autorizadas por el admin no se puede alargar). Un marcaje corregido por el empleado no dura más de 24 horas aunque no haya límite diario (`409 SELF_EDIT_TOO_LONG`). Sin permiso o vencido: `403 SELF_EDIT_NOT_ALLOWED`.
- `GET /me/clock-status` trae `selfEdit` (días y vencimiento; `null` si hoy no puede). Cada cambio queda en el historial del marcaje y en la actividad del admin como `time_entry.corrected_by_employee`, que nunca se purga.

### Correcciones, registros manuales y anulaciones (admin)

| Acción                                  | Endpoint                                               | Reglas                                                                                                              |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Corregir la entrada o salida            | `PATCH /company/time-entries/{id}`                     | Motivo obligatorio (5 a 500). Queda el valor anterior y el empleado ve que fue corregido.                           |
| Crear una jornada que nadie marcó       | `POST /company/employees/{id}/time-entries`            | Solo de los **últimos 14 días**, sin horas futuras y **sin cruzarse** con otro registro. Motivo obligatorio.        |
| Anular un registro equivocado           | `POST /company/time-entries/{id}/void`                 | Motivo obligatorio. **No se borra**: deja de contar en todo y queda con quién, cuándo y por qué. **No se deshace.** |
| Marcar entrada o salida por un empleado | `POST /company/employees/{id}/clock-in` y `/clock-out` | La hora la pone el servidor. Queda auditado.                                                                        |

Un registro **anulado** no cuenta para horas, límites, hojas de tiempo ni reportes, y **el empleado no lo ve**. El admin lo ve con `?status=voided`.

Todo esto queda en `GET /company/activity` (quién hizo qué, a quién y por qué).

### Periodos y cierre

- Los periodos son de 14 días (lunes a domingo) desde el 2026-09-21. `GET /company/periods?date=` dice el estado de cualquiera.
- `POST /company/periods/close` es **definitivo**: no existe reapertura. Solo se cierra un periodo que **ya terminó en todo el mundo**, y **sin entradas abiertas** (`PERIOD_HAS_OPEN_ENTRIES` lista cuáles). Los reportes pendientes avisan, pero no impiden cerrar.
- Después de cerrar, **no se puede corregir, crear, anular ni marcar** nada en esos días (`409 PERIOD_CLOSED`). Si hay un error, se corrige por fuera del sistema (por ejemplo, pagando la diferencia en el siguiente pago).
- La API guarda el total de horas al cerrar, para poder compararlo con lo exportado.
- Al cerrar también **congela lo que se paga a cada empleado** y la moneda de la empresa: si después cambia la moneda o se reactiva a alguien, el periodo cerrado sigue mostrando lo mismo.

### Sueldos y pago del periodo

- Cada empleado tiene un **historial de sueldo**: cada cambio rige desde su `effectiveFrom` hasta el siguiente. Hay dos tipos: `hourly` (tarifa por hora) y `salary` (sueldo fijo de cada periodo de 14 días). Montos en **centavos** enteros de la moneda de la empresa (`currency` en `PATCH /company`, código ISO de 3 letras, por defecto `USD`).
- **Por hora:** horas de cada día × la tarifa de ese día. **Sueldo fijo:** se reparte entre los 14 días del periodo y solo cuenta los días desde que rige hasta el último día activo; el día de la baja cuenta. No hay horas extra, impuestos ni descuentos. Se redondea a centavos una sola vez por empleado.
- Un cambio a mitad del periodo solo afecta desde su fecha. Para aplicarlo a **todo el periodo en curso**, manda como `effectiveFrom` el primer día del periodo. Dos cambios con la misma fecha: el segundo reemplaza al primero.
- Nunca puede regir en un día de un periodo cerrado (`409 PAY_RATE_IN_CLOSED_PERIOD`). Cada cambio queda en la auditoría (`employee.pay_rate_changed`) y nunca se purga.
- Un cambio equivocado se quita con `DELETE /company/employees/{id}/pay-rates/{rateId}`, salvo que rija en un periodo cerrado (`locked: true` en el historial, `409 PAY_RATE_IN_CLOSED_PERIOD`). Queda en la auditoría como `employee.pay_rate_removed`, con el monto que tenía.
- **Bajas:** al desactivar, `effectiveOn` es el último día que se le paga; al reactivar, el primero (por defecto hoy en la zona del empleado). Los días de en medio no cuentan para el sueldo fijo. No puede ser futuro ni caer en un periodo cerrado (`400 INVALID_STATUS_DATE`, `409 STATUS_DATE_IN_CLOSED_PERIOD`). El acceso a la app cambia al momento. El historial de sueldo trae `inactiveSpans` con cada baja.
- Solo los admins (de empresa y multiempresa) ven sueldos. El empleado y el admin global, no.

### Zonas horarias

- Todo instante se guarda en **UTC**. Cada empleado tiene su zona (`timezone`); si no la tiene, hereda la de la empresa (por defecto `America/Denver`).
- Cada marcaje guarda una "foto" de la zona y del día laboral: el historial no cambia si el empleado se muda.
- Las duraciones usan instantes UTC, así que el horario de verano no las altera.

### Empleados

- Una empresa no puede tener más empleados **activos** que su límite contratado (`409 EMPLOYEE_LIMIT_REACHED`).
- **Desactivar** a un empleado cierra su sesión y su entrada abierta. Un empleado desactivado puede volver a activarse y deja de contar para el tope de empleados.
- **Eliminar** (`DELETE /company/employees/{id}`) solo es posible si el empleado **nunca registró horas, reportes, check-ins ni tuvo pagos en un periodo cerrado** (por ejemplo un alta por error): borra su cuenta y su historial de accesos y libera su correo; su código no se reutiliza. Con historial responde `409 EMPLOYEE_HAS_HISTORY` y lo correcto es desactivarlo. Queda un evento `employee.deleted` en la auditoría.
- El email del empleado es su identidad de acceso y **no se edita**.
- El teléfono es opcional y solo informativo.

---

## 7. Guía por pantalla: el empleado

### Pantalla de inicio (el reloj)

Llama a `GET /me/clock-status`. Trae todo lo necesario para dibujarla:

| Campo                           | Para qué                                    |
| ------------------------------- | ------------------------------------------- |
| `clockedIn`                     | Si está trabajando                          |
| `openEntry`                     | La entrada abierta (o `null`)               |
| `serverTime` y `elapsedSeconds` | Para el contador en vivo                    |
| `canClockIn`                    | Si el botón de entrada debe estar activo    |
| `pendingReports`                | Fechas de reportes que debe escribir        |
| `dailyLimit`                    | Límite diario y cuánto le queda (o `null`)  |
| `dailyReport`                   | Si es obligatorio y el texto ya escrito hoy |
| `canCheckIn`                    | Si la empresa deja registrar llegadas       |

**El contador en vivo lo dibuja el cliente.** Toma `elapsedSeconds` y `serverTime` en el momento de la respuesta y avanza con su propio reloj; no consultes cada segundo. Si hay límite diario, la cuenta regresiva parte de `dailyLimit.remainingSeconds`. Cuando llegue a cero, vuelve a pedir el estado: el servidor ya cerró la entrada.

### Marcar entrada

`POST /me/clock-in`. **Hay que mandar la ubicación del dispositivo** (`latitude`, `longitude` y `accuracyMeters`, en metros); sin ella responde `400 LOCATION_REQUIRED` y no se marca. Un valor fuera de rango responde `400 INVALID_LOCATION`. Una precisión baja no impide marcar: solo se guarda. La ubicación se captura **solo al marcar la entrada**, nunca de forma continua, y el navegador solo la entrega en páginas seguras (HTTPS o `localhost`). La salida no pide ubicación.

Si el empleado niega el permiso o su aparato no tiene ubicación, el admin puede marcar la entrada por él (`POST /company/employees/{id}/clock-in`) o registrar la jornada a mano; esos registros no llevan ubicación (`clockInLocation: null`).

#### Mapa de marcajes

`GET /company/attendance/map` devuelve dónde marcó la entrada cada empleado en un rango de días laborales (`from`, `to`, opcional `employeeId`): los marcajes con ubicación y no anulados, los más recientes primero, con `open`, `clockInLocation` y `clockInZone`. Devuelve hasta 500 puntos y `truncated: true` avisa si había más. El admin multiempresa tiene `GET /portfolio/attendance/map`, igual pero sobre todas sus empresas activas, con `companyId` para acotar a una suya (404 si no lo es). Los marcajes registrados por un admin no tienen ubicación y no salen.

#### Zonas de trabajo

El admin define zonas (círculos con centro y radio de 10 a 60000 m) en `GET/POST /company/work-sites` y `PATCH /company/work-sites/{id}`; una zona se desactiva, no se borra. Con al menos una zona activa, cada marcaje guarda `clockInZone`: `inside` o `outside`, con la zona más cercana y la distancia en metros. Se cuenta como dentro si la distancia es menor o igual al radio más la precisión del dispositivo, para no castigar un GPS impreciso. La zona queda guardada en el marcaje: editar o desactivar la zona después no cambia lo ya registrado. Sin zonas, `clockInZone` es `null`.

Por defecto solo se marca el dato. Si la empresa enciende `enforceWorkSites` (`PATCH /company`), marcar la entrada fuera de toda zona responde `409 OUTSIDE_WORK_AREA` con `error.details.siteName` y `distanceMeters`. No se puede encender sin una zona activa, ni desactivar la última mientras esté encendido (`409 WORK_SITES_REQUIRED`). Los marcajes del admin no se evalúan. `GET /company/time-entries` acepta `location=without` (sin ubicación) o `location=outside` (fuera de zona).

Si responde `409`:

- `OUTSIDE_WORK_AREA`: la empresa exige zona y el empleado está fuera.
- `ALREADY_CLOCKED_IN`: ya tiene una entrada abierta.
- `DAILY_LIMIT_REACHED`: alcanzó su límite de hoy.
- `DAILY_REPORT_PENDING`: tiene reportes por escribir (`error.details.dates`). Muestra la lista y deja que los escriba antes.

### Registrar llegada (check-in)

`POST /me/check-ins` deja constancia de que el empleado llegó a un lugar: guarda la hora del servidor, la ubicación (`latitude`, `longitude` y `accuracyMeters`, obligatorias, igual que al marcar entrada) y una `note` opcional de hasta 200 caracteres. **No es un marcaje:** no abre ni cierra la jornada, no cuenta horas y funciona con o sin la entrada marcada, así que no lo frenan el límite diario, los reportes pendientes ni un periodo cerrado. Sirve, por ejemplo, para que alguien que recorre la ciudad registre cada visita a un cliente.

- La empresa lo activa con `allowCheckIns` (`PATCH /company`) y cada empleado puede tener el suyo (`PATCH /company/employees/{id}` con `allowCheckIns`): `true` lo permite y `false` lo prohíbe aunque la empresa diga lo contrario, `null` hereda la de la empresa. El empleado trae `allowCheckIns` (el propio) y `effectiveAllowCheckIns` (el que aplica). Sin permiso responde `409 CHECK_INS_DISABLED`. `GET /me/clock-status` trae `canCheckIn` para mostrar u ocultar el botón. Quitar el permiso no borra ni oculta lo que ya registró.
- Se guarda si cayó dentro o fuera de la zona de trabajo más cercana (`zone`, como `clockInZone`), pero nunca bloquea, aunque la empresa exija zonas para marcar entrada.
- Hasta 50 por empleado y día laboral, contando los anulados (`409 CHECK_IN_LIMIT_REACHED`).
- `GET /me/check-ins?from=&to=` lista los propios; los anulados no aparecen.

El admin los ve en `GET /company/check-ins` (filtros `employeeId`, `from`/`to`, `location=outside` y `status=voided`) y anula uno registrado por error con `POST /company/check-ins/{id}/void` y un motivo: no se borra, queda con quién lo anuló y por qué, y aparece en la actividad (`check_in.voided_by_admin`). La base de datos impide borrar un check-in o cambiar lo registrado. Un empleado con check-ins ya no se puede eliminar (`EMPLOYEE_HAS_HISTORY`).

### Marcar salida

`POST /me/clock-out`. Si la empresa exige el reporte (`dailyReport.required`), muestra un cuadro de texto **ya cargado** con `dailyReport.content` y manda lo que quede escrito en `dailyReport`. Errores posibles: `DAILY_REPORT_REQUIRED` (faltó) e `INVALID_DAILY_REPORT` (largo inválido).

### Escribir un reporte pendiente

`PUT /me/daily-reports/{fecha}` con `{ "content": "..." }`. El contenido es **Markdown** (negritas, cursiva, listas, enlaces y citas; un texto sin formato también sirve) y los límites de 10 a 2000 caracteres cuentan el texto tal como se guarda, con sus marcas. Para mostrarlo, usa un visor de Markdown que **no interprete HTML en bruto** y que filtre los enlaces peligrosos. Funciona para días con marcajes de los últimos 14 días. `GET /me/daily-reports/pending` da la lista completa.

### Historial y periodo

- `GET /me/time-entries?from=&to=&status=` lista los marcajes con `meta.totalHours` del rango completo.
- `GET /me/timesheet?date=` da los 14 días del periodo (con `weekday`, `entries`, `hours` y `hasReport` por día), `totalHours`, `closed` y los inicios del periodo anterior y siguiente, para navegar. Los días sin marcajes salen con 0 horas.
- `GET /me/daily-reports` lista sus reportes.

### Cuenta

`GET /auth/me`, `PATCH /auth/me` (nombre y apellido), `PATCH /auth/me/password` y `POST /auth/me/logout-all`. El perfil (`CurrentUser`, también en el login) incluye `employee: { employeeCode, timezone }` para el rol `employee` (la zona es la efectiva) y `null` para los admins.

---

## 8. Guía por pantalla: el admin de empresa

### Panel de inicio

`GET /company/attendance/summary` da de un vistazo: empleados activos, cuántos están dentro y fuera, horas trabajadas hoy por todos, quiénes alcanzaron su límite y cuántos reportes faltan. Para el detalle:

- `GET /company/attendance/roster` — lista de empleados con su estado `in` u `out` (filtros `status` y `search`). Sirve para la pantalla de "quién está trabajando".
- `GET /company/attendance/live` — solo los que están trabajando ahora, con su tiempo transcurrido y `clockInLocation` (dónde marcaron la entrada), para el mapa. El roster trae `clockedInLocation`.
- `GET /company/daily-reports/pending` — quién debe qué reportes.

No hay actualizaciones en tiempo real por socket: **consulta cada 10 a 30 segundos** y avanza los contadores en el cliente con `elapsedSeconds`.

### Empleados

- `POST /company/employees` — alta. Devuelve el empleado y su **contraseña temporal (se muestra una sola vez)**. El código de empleado lo asigna el sistema.
- `GET /company/employees` y `GET /company/employees/{id}` — listado (con `search` por nombre, email o código, y `status`) y detalle.
- `PATCH /company/employees/{id}` — nombre, teléfono, fecha de ingreso, zona horaria, límite diario propio y el permiso para corregir sus horas (`allowSelfEdit`, `selfEditMinutes`).
- `PATCH /company/employees/{id}/status` — activar o desactivar; con `effectiveOn` se elige desde cuándo cuenta para el sueldo fijo (ver Bajas).
- `DELETE /company/employees/{id}` — eliminar a un empleado sin historial (ver arriba).
- `POST /company/employees/{id}/reset-password` — nueva contraseña temporal.
- `POST /company/employees/{id}/revoke-sessions` — cierra todas sus sesiones.
- `GET /company/employees/{id}/pay-rates` — su historial de sueldo y la moneda. `POST` con `{ "kind", "amountCents", "effectiveFrom" }` agrega un cambio. Al guardar, pregunta si rige **desde una fecha** (por defecto hoy) o **en todo el periodo en curso** (su primer día).

### Marcajes

- `GET /company/time-entries` — listado con filtros por empleado, rango de días (`from`, `to`) y estado (`open`, `closed`, `voided`), con `meta.totalHours`. Cada marcaje trae `clockInLocation` (`null` si lo registró un admin o es anterior a este dato).
- `GET /company/time-entries/{id}` y `GET /company/time-entries/{id}/corrections` — detalle e historial de correcciones.
- Para corregir, crear o anular: ver la tabla de la sección 6.
- Para marcar por un empleado: `POST /company/employees/{id}/clock-in` y `/clock-out`.

### Horas del periodo

- `GET /company/timesheet?date=` — tabla de todos los empleados: una fila por empleado y una cifra de horas por día del periodo (`meta.days` da las fechas en el mismo orden), con totales de toda la empresa. Solo horas: el pago está en Nómina.

### Nómina

- `GET /company/payroll?date=` (permiso `pay.manage`) — lo que se paga a cada empleado en el periodo: `pay` con `amountCents`, el sueldo vigente (`rate`) y `salaryDays` (días pagados con sueldo fijo), sus horas y marcajes abiertos. `meta.pay` da la moneda, el total y cuánto es de quienes cobran por hora (`hourlyCents`) y con sueldo fijo (`salaryCents`); `meta.closed`, el cierre. La tabla solo trae a quien tiene monto: los que no tienen sueldo van en `meta.missingPay` y `meta.employeeCount` cuenta a todos. En un periodo cerrado son los montos congelados.
- `GET /company/payroll/export?date=` — la misma tabla en CSV: tipo, sueldo, horas, días con sueldo fijo y pago, con una fila de total.
- `GET /company/employees/{id}/timesheet?date=` — la hoja de un empleado.
- `GET /company/timesheet/export?date=` — la misma tabla de la empresa como **CSV** (UTF-8 con BOM, horas con 2 decimales y una fila de totales). Descárgalo con el token en el encabezado; no se puede abrir con un simple enlace.

### Cerrar un periodo

1. `GET /company/periods?date=` — mira `canClose`, las `openEntries` que lo impiden y cuántos `pendingReports` faltan.
2. Muestra un aviso claro: **es definitivo**. Indica el total de horas (`totalHours`) y los reportes pendientes.
3. `POST /company/periods/close` con `{ "date": "2026-09-30" }` (cualquier día del periodo).

### Reportes y actividad

- `GET /company/daily-reports` — reportes escritos (filtros por empleado y días) y `GET /company/daily-reports/{id}/revisions` para ver las versiones anteriores.
- `GET /company/daily-reports/export` — los mismos reportes, con los mismos filtros (`employeeId`, `from`, `to`) y sin paginar, como **CSV** (UTF-8 con BOM; columnas: código, empleado, fecha, reporte como texto plano sin las marcas de formato, creado y última edición en UTC). Los textos que empiezan con `= + - @` llevan un apóstrofo delante para evitar fórmulas en Excel. Más de 5000 reportes responde `400 EXPORT_TOO_LARGE`: acota el rango. Se descarga con el token en el encabezado.
- `GET /company/activity` — todo lo que el admin hizo sobre la asistencia (marcar por otros, registros manuales, correcciones, anulaciones y cierres), con filtros.

### Ajustes de la empresa

`GET /company` y `PATCH /company`: nombre, zona horaria, moneda, límite diario y si el reporte es obligatorio. El código de la empresa se ve aquí y no se puede cambiar. El límite de empleados y el estado de la empresa los define el admin global.

---

## 9. Guía por pantalla: el admin global

- `POST /platform/companies` crea una empresa **junto con su admin**. Devuelve la empresa (con su código) y la **contraseña temporal del admin, una sola vez**.
- `GET /platform/companies` lista las empresas. Con `search` busca por nombre, código o prefijo.
- `GET` y `PATCH /platform/companies/{id}` ven y editan una empresa (nombre, zona y límite de empleados). El límite puede quedar por debajo de los empleados activos, por ejemplo al bajar de plan: nadie pierde el acceso ni sus horas, pero la empresa queda **excedida** y no puede dar de alta ni reactivar empleados (`409 EMPLOYEE_LIMIT_REACHED`) hasta que su admin desactive a los que sobran. El cambio se audita con el límite anterior, el nuevo y los activos.
- `PATCH /platform/companies/{id}/status` suspende o activa una empresa: al suspenderla, **nadie** de esa empresa puede usar el sistema.
- `POST /platform/companies/{id}/admin/reset-password` genera una contraseña temporal para el admin de la empresa.

> **Pedidos de ayuda por correo.** Si alguien escribe pidiendo restablecer una contraseña, el código de la empresa sirve para encontrarla rápido. Pero el código **no demuestra quién escribe**: actúa solo si el correo viene del email registrado del admin de esa empresa.

---

### Administradores multiempresa

- `POST /platform/multi-admins` crea a la persona con su **paquete**: `maxCompanies` (cuántas empresas puede tener) y `maxEmployeesPerCompany` (empleados máximos de cada empresa que cree). Devuelve su **contraseña temporal una sola vez**.
- `GET /platform/multi-admins` lista, con `search` y `status`. `GET /platform/multi-admins/{id}` muestra a la persona con sus empresas.
- `PATCH /platform/multi-admins/{id}` cambia nombre y paquete. El máximo de empresas no puede quedar por debajo de las que ya tiene (`409 MAX_COMPANIES_BELOW_ASSIGNED`).
- `PATCH /platform/multi-admins/{id}/status` la desactiva o reactiva. Al desactivarla pierde el acceso al instante.
- `POST /platform/multi-admins/{id}/reset-password` genera una contraseña temporal y cierra sus sesiones.
- `POST /platform/multi-admins/{id}/companies` le asigna una empresa **que ya existe** (`409 MAX_COMPANIES_REACHED` si ya llegó a su máximo) y `DELETE /platform/multi-admins/{id}/companies/{companyId}` se la quita. Quitar una empresa no toca la empresa ni sus datos.

Paquetes: una empresa con su admin de empresa es el paquete de una empresa. Para varias empresas se crea un admin multiempresa con el máximo que corresponda. Una empresa siempre nace con su admin de empresa, y esa persona convive con el admin multiempresa.

### Pantallas del admin multiempresa

- `GET /portfolio/companies` devuelve sus empresas (por nombre) y lo que le queda de su paquete. Sirve para el selector de empresa.
- `POST /portfolio/companies` crea una empresa con su admin dentro de su paquete. La empresa nace con `maxEmployeesPerCompany` empleados de máximo y queda asignada a la persona. `409 MAX_COMPANIES_REACHED` si ya llegó a su máximo. Devuelve la contraseña temporal del admin de la empresa una sola vez.
- `POST /auth/active-company` elige la empresa con la que trabaja (ver sección 5).

**Vistas de todas sus empresas** (solo lectura, no dependen de la empresa activa de la sesión; solo cuentan sus empresas **activas**, las suspendidas quedan fuera):

- `GET /portfolio/summary` es su panel: empleados activos, IN y OUT, horas de hoy y del periodo, límites alcanzados y reportes pendientes, en total y por empresa, más las horas de todos por día del periodo. El periodo no avanza hasta que todas sus empresas terminaron el anterior.
- `GET /portfolio/attendance/live` lista quién está trabajando ahora en todas sus empresas, con su empresa y `clockInLocation`, para el mapa.
- `GET /portfolio/employees` lista los empleados de todas sus empresas, con la empresa de cada uno. Filtra por `search`, `status` y `companyId`.
- `GET /portfolio/timesheet` es la hoja de horas de todos los empleados, con su empresa, y `GET /portfolio/timesheet/export` la baja en CSV con la empresa y su código al inicio de cada fila. `GET /portfolio/payroll` es la nómina de todas sus empresas: cada fila lleva su `currency` (la de su empresa) y `meta.payTotals` da **un total por moneda**, porque los montos de monedas distintas nunca se suman. `GET /portfolio/payroll/export` la baja en CSV con una fila de total por moneda.
- `GET /portfolio/daily-reports` lista los reportes de todas sus empresas y `GET /portfolio/daily-reports/export` los baja en CSV, también con la empresa. Con más de 5000 reportes hay que acotar el rango.
- Todas aceptan `companyId` para acotar a una empresa; una que no es suya responde `404 COMPANY_NOT_FOUND`, igual que una inexistente o suspendida.
- No puede cambiar el límite de empleados de una empresa, suspenderla ni cambiar su propio paquete: eso es solo del admin global.

---

## 10. Qué hacer ante cada error

Decide por `error.code`, no por el texto. Los casos más importantes:

| Código                                                                      | HTTP | Qué hacer                                                                                              |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `TOKEN_EXPIRED`                                                             | 401  | Renovar con `POST /auth/refresh` y repetir la petición.                                                |
| `MISSING_TOKEN`, `INVALID_TOKEN`                                            | 401  | Iniciar sesión de nuevo.                                                                               |
| `SESSION_REVOKED`                                                           | 401  | La sesión se cerró (contraseña cambiada, desactivación o cierre de sesiones): iniciar sesión de nuevo. |
| `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_EXPIRED`, `SESSION_MAX_AGE_REACHED` | 401  | Iniciar sesión de nuevo. No reintentes el refresh.                                                     |
| `INVALID_CREDENTIALS`                                                       | 401  | Email o contraseña incorrectos (o cuenta bloqueada temporalmente).                                     |
| `PASSWORD_CHANGE_REQUIRED`                                                  | 403  | Llevar al usuario a cambiar su contraseña temporal.                                                    |
| `USER_INACTIVE`, `COMPANY_SUSPENDED`                                        | 403  | Mostrar que no tiene acceso; no insistir.                                                              |
| `TEMPORARY_PASSWORD_EXPIRED`                                                | 403  | Pedir al admin una contraseña temporal nueva.                                                          |
| `FORBIDDEN`                                                                 | 403  | El usuario no tiene el permiso. Revisa los `permissions` de `/auth/me`.                                |
| `COMPANY_REQUIRED`                                                          | 403  | Es un admin multiempresa sin empresa activa: pedirle que elija una (`POST /auth/active-company`).      |
| `VALIDATION_ERROR`                                                          | 400  | Mostrar los mensajes de `error.details` junto a cada campo (`path`).                                   |
| `DAILY_REPORT_PENDING`                                                      | 409  | Mostrar `error.details.dates` y dejar escribir los reportes.                                           |
| `DAILY_REPORT_REQUIRED`                                                     | 400  | Pedir el reporte antes de marcar la salida.                                                            |
| `DAILY_LIMIT_REACHED`                                                       | 409  | Avisar que ya alcanzó su límite de hoy.                                                                |
| `CHECK_INS_DISABLED`                                                        | 409  | La empresa no deja registrar llegadas: ocultar el botón (`canCheckIn`).                                |
| `CHECK_IN_LIMIT_REACHED`                                                    | 409  | Ya registró el máximo de llegadas del día (`error.details.perDay`).                                    |
| `PERIOD_CLOSED`                                                             | 409  | El periodo está cerrado; ya no admite cambios.                                                         |
| `PAY_RATE_IN_CLOSED_PERIOD`                                                 | 409  | Elegir un día posterior al último periodo cerrado (lo dice el mensaje).                                |
| `PERIOD_HAS_OPEN_ENTRIES`                                                   | 409  | Mostrar `error.details.entries` y pedir corregirlas o anularlas.                                       |
| `TIME_ENTRY_OVERLAP`                                                        | 409  | El horario se cruza con otro registro del empleado.                                                    |
| `TIME_ENTRY_CHANGED`                                                        | 409  | Alguien cambió el registro mientras lo editabas: recárgalo.                                            |
| `TOO_MANY_REQUESTS`                                                         | 429  | Esperar lo que indique `Retry-After`.                                                                  |

El **catálogo completo de códigos**, con en qué endpoints puede aparecer cada uno, está al final de la referencia.

---

## 11. Integrarla con otro sistema

Cualquier sistema puede usarla: es una API HTTP normal con JSON. Algunas recomendaciones para una integración **de servidor a servidor** (por ejemplo, un CRM que lea asistencia):

**Cómo autenticarse.** Hoy no existen "API keys": un sistema externo inicia sesión como un usuario más (`POST /auth/login`) y usa sus tokens. Eso implica que usaría las credenciales de un usuario real (por ejemplo, del admin de la empresa, que es el único con acceso a todos los datos). Por eso:

- Haz las llamadas **desde tu servidor**, nunca desde el navegador de un usuario, y guarda las credenciales y el refresh token como secretos.
- Renueva la sesión como en el cliente de ejemplo, y vuelve a iniciar sesión si el refresh falla o pasan 30 días.
- Se recomienda, cuando se vaya a integrar de verdad, agregar llaves de API con permisos limitados de solo lectura. Hoy no existen.

**Qué leer.** Las consultas más útiles para un sistema externo:

| Necesidad                                  | Endpoint                                                |
| ------------------------------------------ | ------------------------------------------------------- |
| Horas por empleado y por día de un periodo | `GET /company/timesheet?date=` (JSON) o `/export` (CSV) |
| Todos los marcajes de un rango             | `GET /company/time-entries?from=&to=` (paginado)        |
| Horas de un empleado                       | `GET /company/employees/{id}/timesheet`                 |
| Lista de empleados y sus códigos           | `GET /company/employees`                                |
| Quién está trabajando ahora                | `GET /company/attendance/live`                          |
| Saber si un periodo ya es definitivo       | `GET /company/periods?date=` (`closure`)                |

**Buenas prácticas.**

- **Usa solo periodos cerrados para pagar o facturar.** Un periodo cerrado ya no cambia. Compara el `totalHours` de su `closure` con lo que obtengas.
- Para sincronizar, consulta por rango de días (`from` y `to`) y pagina con `page` y `limit`. No hay un filtro de "cambiado desde".
- Identifica a los empleados por su `id` (UUID) o por su código `employeeCode` (por ejemplo `KCS-0001`), que nunca se reutiliza.
- Respeta los límites de uso y reacciona a `429` esperando `Retry-After`.
- Guarda el `requestId` de los errores para poder investigarlos.

**Lo que la API todavía no tiene.** No hay llaves de API, ni webhooks (avisos cuando algo cambia), ni actualizaciones en tiempo real, ni correos (la recuperación de contraseña pasa por el admin). Cualquiera de esas funciones puede agregarse más adelante.

---

## 12. Referencia de endpoints

Cada endpoint indica el permiso que exige, qué parámetros recibe, qué devuelve y qué errores específicos puede dar. Los tipos con enlace (por ejemplo [MyTimeEntry](#schema-mytimeentry)) se describen al final, en _Objetos que devuelve la API_. Los campos "o null" pueden venir vacíos. Todas las rutas empiezan con `/api/v1`.

{{REFERENCE}}
