<!-- Archivo generado. No lo edites a mano: cambia docs/api-guide.md y ejecuta `npm run docs:api`. -->
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

**Roles.** Hay tres:

| Rol                                | Qué hace                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `platform_admin` (admin global)    | Crea, edita y suspende empresas. No pertenece a ninguna.                                                   |
| `company_admin` (admin de empresa) | Uno por empresa. Gestiona empleados, ve y corrige la asistencia, cierra periodos. **No marca asistencia.** |
| `employee` (empleado)              | Marca entrada y salida, escribe su reporte diario y consulta su historial.                                 |

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

### Contraseña temporal

Cuando el admin da de alta a un empleado o restablece una contraseña, el sistema genera una **contraseña temporal** (se muestra **una sola vez**). Dura 72 horas.

1. El usuario inicia sesión con ella. La respuesta trae `user.mustChangePassword: true`.
2. Mientras tenga contraseña temporal, **solo puede** consultar `GET /auth/me`, cambiar la contraseña con `PATCH /auth/me/password` y cerrar sus sesiones. Cualquier otra ruta responde `403 PASSWORD_CHANGE_REQUIRED`.
3. Al cambiarla, la respuesta trae una **sesión nueva** y las anteriores se cierran.

Una contraseña nueva debe tener **al menos 12 caracteres** (máximo 128), ser distinta de la actual, no ser igual al email y no ser una contraseña trivial (un mismo carácter repetido, `123456789012`, `password1234`...). Si no cumple, responde `400 WEAK_PASSWORD` con los motivos en `error.details`.

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

| Permiso                      | Admin global | Admin de empresa | Empleado |
| ---------------------------- | :----------: | :--------------: | :------: |
| `companies.manage`           |      sí      |                  |          |
| `company.settings.manage`    |              |        sí        |          |
| `employees.manage`           |              |        sí        |          |
| `attendance.read_all`        |              |        sí        |          |
| `time_entries.correct`       |              |        sí        |          |
| `attendance.clock_employees` |              |        sí        |          |
| `periods.manage`             |              |        sí        |          |
| `attendance.clock_own`       |              |                  |    sí    |
| `attendance.read_own`        |              |                  |    sí    |

`GET /auth/me` devuelve la lista de `permissions` del usuario: sirve para decidir qué pantallas y botones mostrar. Un usuario que intenta usar un endpoint sin el permiso recibe `403 FORBIDDEN`.

**Aislamiento entre empresas.** La empresa **sale siempre del token**, nunca de lo que mande el cliente. Un recurso de otra empresa responde `404`, igual que uno que no existe.

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

### Zonas horarias

- Todo instante se guarda en **UTC**. Cada empleado tiene su zona (`timezone`); si no la tiene, hereda la de la empresa (por defecto `America/Denver`).
- Cada marcaje guarda una "foto" de la zona y del día laboral: el historial no cambia si el empleado se muda.
- Las duraciones usan instantes UTC, así que el horario de verano no las altera.

### Empleados

- Una empresa no puede tener más empleados **activos** que su límite contratado (`409 EMPLOYEE_LIMIT_REACHED`).
- **Desactivar** a un empleado cierra su sesión y su entrada abierta. Un empleado desactivado puede volver a activarse y deja de contar para el tope de empleados.
- **Eliminar** (`DELETE /company/employees/{id}`) solo es posible si el empleado **nunca registró horas ni reportes** (por ejemplo un alta por error): borra su cuenta y su historial de accesos y libera su correo; su código no se reutiliza. Con historial responde `409 EMPLOYEE_HAS_HISTORY` y lo correcto es desactivarlo. Queda un evento `employee.deleted` en la auditoría.
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

**El contador en vivo lo dibuja el cliente.** Toma `elapsedSeconds` y `serverTime` en el momento de la respuesta y avanza con su propio reloj; no consultes cada segundo. Si hay límite diario, la cuenta regresiva parte de `dailyLimit.remainingSeconds`. Cuando llegue a cero, vuelve a pedir el estado: el servidor ya cerró la entrada.

### Marcar entrada

`POST /me/clock-in`. Si responde `409`:

- `ALREADY_CLOCKED_IN`: ya tiene una entrada abierta.
- `DAILY_LIMIT_REACHED`: alcanzó su límite de hoy.
- `DAILY_REPORT_PENDING`: tiene reportes por escribir (`error.details.dates`). Muestra la lista y deja que los escriba antes.

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
- `GET /company/attendance/live` — solo los que están trabajando ahora, con su tiempo transcurrido.
- `GET /company/daily-reports/pending` — quién debe qué reportes.

No hay actualizaciones en tiempo real por socket: **consulta cada 10 a 30 segundos** y avanza los contadores en el cliente con `elapsedSeconds`.

### Empleados

- `POST /company/employees` — alta. Devuelve el empleado y su **contraseña temporal (se muestra una sola vez)**. El código de empleado lo asigna el sistema.
- `GET /company/employees` y `GET /company/employees/{id}` — listado (con `search` por nombre, email o código, y `status`) y detalle.
- `PATCH /company/employees/{id}` — nombre, teléfono, fecha de ingreso, zona horaria y límite diario propio.
- `PATCH /company/employees/{id}/status` — activar o desactivar.
- `DELETE /company/employees/{id}` — eliminar a un empleado sin historial (ver arriba).
- `POST /company/employees/{id}/reset-password` — nueva contraseña temporal.
- `POST /company/employees/{id}/revoke-sessions` — cierra todas sus sesiones.

### Marcajes

- `GET /company/time-entries` — listado con filtros por empleado, rango de días (`from`, `to`) y estado (`open`, `closed`, `voided`), con `meta.totalHours`.
- `GET /company/time-entries/{id}` y `GET /company/time-entries/{id}/corrections` — detalle e historial de correcciones.
- Para corregir, crear o anular: ver la tabla de la sección 6.
- Para marcar por un empleado: `POST /company/employees/{id}/clock-in` y `/clock-out`.

### Horas del periodo

- `GET /company/timesheet?date=` — tabla de todos los empleados: una fila por empleado y una cifra de horas por día del periodo (`meta.days` da las fechas en el mismo orden), con totales de toda la empresa.
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

`GET /company` y `PATCH /company`: nombre, zona horaria, límite diario y si el reporte es obligatorio. El código de la empresa se ve aquí y no se puede cambiar. El límite de empleados y el estado de la empresa los define el admin global.

---

## 9. Guía por pantalla: el admin global

- `POST /platform/companies` crea una empresa **junto con su admin**. Devuelve la empresa (con su código) y la **contraseña temporal del admin, una sola vez**.
- `GET /platform/companies` lista las empresas. Con `search` busca por nombre, código o prefijo.
- `GET` y `PATCH /platform/companies/{id}` ven y editan una empresa (nombre, zona y límite de empleados).
- `PATCH /platform/companies/{id}/status` suspende o activa una empresa: al suspenderla, **nadie** de esa empresa puede usar el sistema.
- `POST /platform/companies/{id}/admin/reset-password` genera una contraseña temporal para el admin de la empresa.

> **Pedidos de ayuda por correo.** Si alguien escribe pidiendo restablecer una contraseña, el código de la empresa sirve para encontrarla rápido. Pero el código **no demuestra quién escribe**: actúa solo si el correo viene del email registrado del admin de esa empresa.

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
| `VALIDATION_ERROR`                                                          | 400  | Mostrar los mensajes de `error.details` junto a cada campo (`path`).                                   |
| `DAILY_REPORT_PENDING`                                                      | 409  | Mostrar `error.details.dates` y dejar escribir los reportes.                                           |
| `DAILY_REPORT_REQUIRED`                                                     | 400  | Pedir el reporte antes de marcar la salida.                                                            |
| `DAILY_LIMIT_REACHED`                                                       | 409  | Avisar que ya alcanzó su límite de hoy.                                                                |
| `PERIOD_CLOSED`                                                             | 409  | El periodo está cerrado; ya no admite cambios.                                                         |
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

### Índice de endpoints

**Sistema**

- [`GET /health`](#op-get-health) — Estado del servicio

**Autenticación**

- [`POST /auth/login`](#op-post-auth-login) — Iniciar sesión
- [`POST /auth/refresh`](#op-post-auth-refresh) — Renovar la sesión
- [`POST /auth/logout`](#op-post-auth-logout) — Cerrar sesión
- [`GET /auth/me`](#op-get-auth-me) — Perfil del usuario autenticado
- [`PATCH /auth/me`](#op-patch-auth-me) — Cambiar mi nombre
- [`POST /auth/me/logout-all`](#op-post-auth-me-logout-all) — Cerrar todas mis sesiones
- [`PATCH /auth/me/password`](#op-patch-auth-me-password) — Cambiar mi contraseña

**Plataforma · Empresas**

- [`GET /platform/companies`](#op-get-platform-companies) — Listar empresas
- [`POST /platform/companies`](#op-post-platform-companies) — Crear una empresa con su administrador
- [`GET /platform/companies/{id}`](#op-get-platform-companies-id) — Detalle de una empresa
- [`PATCH /platform/companies/{id}`](#op-patch-platform-companies-id) — Editar una empresa
- [`PATCH /platform/companies/{id}/status`](#op-patch-platform-companies-id-status) — Suspender o reactivar una empresa
- [`POST /platform/companies/{id}/admin/reset-password`](#op-post-platform-companies-id-admin-reset-password) — Restablecer la contraseña del admin de una empresa

**Empresa · Configuración**

- [`GET /company`](#op-get-company) — Datos de mi empresa
- [`PATCH /company`](#op-patch-company) — Editar mi empresa

**Empresa · Empleados**

- [`GET /company/employees`](#op-get-company-employees) — Listar empleados
- [`POST /company/employees`](#op-post-company-employees) — Dar de alta un empleado
- [`GET /company/employees/{id}`](#op-get-company-employees-id) — Detalle de un empleado
- [`PATCH /company/employees/{id}`](#op-patch-company-employees-id) — Editar un empleado
- [`DELETE /company/employees/{id}`](#op-delete-company-employees-id) — Eliminar un empleado
- [`PATCH /company/employees/{id}/status`](#op-patch-company-employees-id-status) — Activar o desactivar un empleado
- [`POST /company/employees/{id}/revoke-sessions`](#op-post-company-employees-id-revoke-sessions) — Cerrar las sesiones de un empleado
- [`POST /company/employees/{id}/reset-password`](#op-post-company-employees-id-reset-password) — Restablecer la contraseña de un empleado

**Empleado · Asistencia**

- [`GET /me/clock-status`](#op-get-me-clock-status) — ¿Estoy trabajando?
- [`POST /me/clock-in`](#op-post-me-clock-in) — Marcar entrada
- [`POST /me/clock-out`](#op-post-me-clock-out) — Marcar salida
- [`PUT /me/daily-reports/{date}`](#op-put-me-daily-reports-date) — Escribir o corregir el reporte de un día
- [`GET /me/daily-reports/pending`](#op-get-me-daily-reports-pending) — Mis reportes pendientes
- [`GET /me/daily-reports`](#op-get-me-daily-reports) — Mis reportes del día
- [`GET /me/timesheet`](#op-get-me-timesheet) — Mi hoja de tiempo del periodo
- [`GET /me/time-entries`](#op-get-me-time-entries) — Mi historial de asistencia

**Empresa · Asistencia**

- [`POST /company/employees/{id}/clock-in`](#op-post-company-employees-id-clock-in) — Marcar entrada a un empleado
- [`POST /company/employees/{id}/clock-out`](#op-post-company-employees-id-clock-out) — Marcar salida a un empleado
- [`GET /company/daily-reports/pending`](#op-get-company-daily-reports-pending) — Quién debe reportes del día
- [`GET /company/daily-reports`](#op-get-company-daily-reports) — Reportes del día de los empleados
- [`GET /company/daily-reports/export`](#op-get-company-daily-reports-export) — Exportar los reportes del día a CSV
- [`GET /company/daily-reports/{id}/revisions`](#op-get-company-daily-reports-id-revisions) — Versiones anteriores de un reporte
- [`GET /company/activity`](#op-get-company-activity) — Actividad del admin sobre la asistencia
- [`GET /company/attendance/summary`](#op-get-company-attendance-summary) — Resumen del día
- [`GET /company/attendance/roster`](#op-get-company-attendance-roster) — Empleados con su estado IN / OUT
- [`GET /company/attendance/live`](#op-get-company-attendance-live) — Quién está trabajando ahora
- [`GET /company/employees/{id}/timesheet`](#op-get-company-employees-id-timesheet) — Hoja de tiempo de un empleado
- [`POST /company/employees/{id}/time-entries`](#op-post-company-employees-id-time-entries) — Crear un registro manual
- [`GET /company/timesheet`](#op-get-company-timesheet) — Hoja de tiempo de todos los empleados
- [`GET /company/periods`](#op-get-company-periods) — Estado de un periodo de pago
- [`POST /company/periods/close`](#op-post-company-periods-close) — Cerrar un periodo de pago
- [`GET /company/timesheet/export`](#op-get-company-timesheet-export) — Exportar la hoja de tiempo a CSV
- [`GET /company/time-entries`](#op-get-company-time-entries) — Registros de asistencia de la empresa
- [`GET /company/time-entries/{id}`](#op-get-company-time-entries-id) — Detalle de un registro
- [`PATCH /company/time-entries/{id}`](#op-patch-company-time-entries-id) — Corregir un registro
- [`POST /company/time-entries/{id}/void`](#op-post-company-time-entries-id-void) — Anular un registro
- [`GET /company/time-entries/{id}/corrections`](#op-get-company-time-entries-id-corrections) — Historial de correcciones de un registro

### Detalle de cada endpoint

### Sistema

<a id="op-get-health"></a>
#### `GET /health`

**Estado del servicio**

**Acceso:** público (no lleva token).

Devuelve 200 si todo funciona y 503 si algún componente (p. ej. la BD) no responde.

**Respuesta 200:** Servicio operativo

- `data`: [HealthReport](#schema-healthreport)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 503 | `ERROR` | Servicio degradado |

### Autenticación

<a id="op-post-auth-login"></a>
#### `POST /auth/login`

**Iniciar sesión**

**Acceso:** público (no lleva token).

Devuelve un access token (vida corta) y un refresh token. Si `user.mustChangePassword` es true, solo se permite consultar el perfil y cambiar la contraseña.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `password` | texto | sí | (1 a 128 caracteres) |

**Respuesta 200:** Sesión iniciada

- `data`: [LoginResponse](#schema-loginresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `INVALID_CREDENTIALS` | Email o contraseña incorrectos (o cuenta bloqueada temporalmente) |
| 403 | `USER_INACTIVE` · `COMPANY_SUSPENDED` · `TEMPORARY_PASSWORD_EXPIRED` | Credenciales correctas pero sin acceso |

<a id="op-post-auth-refresh"></a>
#### `POST /auth/refresh`

**Renovar la sesión**

**Acceso:** público (no lleva token).

Cambia un refresh token por un par nuevo. El refresh token usado queda anulado; si se vuelve a presentar, se cierra toda la sesión por seguridad.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `refreshToken` | texto | sí | (32 a 256 caracteres) |

**Respuesta 200:** Sesión renovada

- `data`: [Session](#schema-session)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `INVALID_REFRESH_TOKEN` · `REFRESH_TOKEN_EXPIRED` · `SESSION_MAX_AGE_REACHED` | Refresh token inválido, ya usado o vencido |
| 403 | `USER_INACTIVE` · `COMPANY_SUSPENDED` | El usuario o su empresa ya no tienen acceso |

<a id="op-post-auth-logout"></a>
#### `POST /auth/logout`

**Cerrar sesión**

**Acceso:** público (no lleva token).

Anula el refresh token y su sesión. Siempre responde 204.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `refreshToken` | texto | sí | (32 a 256 caracteres) |

**Respuesta 204:** Sesión cerrada

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |

<a id="op-get-auth-me"></a>
#### `GET /auth/me`

**Perfil del usuario autenticado**

**Acceso:** permiso `authenticated` ().

**Respuesta 200:** Perfil

- `data`: [CurrentUser](#schema-currentuser)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-patch-auth-me"></a>
#### `PATCH /auth/me`

**Cambiar mi nombre**

**Acceso:** permiso `authenticated` ().

Solo nombre y apellido. El email es la identidad de acceso y no se edita aquí.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | sí | (1 a 100 caracteres) |
| `lastName` | texto | sí | (1 a 100 caracteres) |

**Respuesta 200:** Perfil actualizado

- `data`: [CurrentUser](#schema-currentuser)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-auth-me-logout-all"></a>
#### `POST /auth/me/logout-all`

**Cerrar todas mis sesiones**

**Acceso:** permiso `authenticated` ().

Cierra todas las sesiones del usuario, también la actual y de inmediato (los access tokens dejan de servir). Hay que iniciar sesión de nuevo.

**Respuesta 204:** Sesiones cerradas

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-patch-auth-me-password"></a>
#### `PATCH /auth/me/password`

**Cambiar mi contraseña**

**Acceso:** permiso `authenticated` ().

Cierra todas las sesiones abiertas del usuario y devuelve una sesión nueva. Es obligatorio cuando la contraseña es temporal.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `currentPassword` | texto | sí | (1 a 128 caracteres) |
| `newPassword` | texto | sí | Mínimo 12 caracteres; distinta de la actual y del email. (0 a 128 caracteres) |

**Respuesta 200:** Contraseña cambiada

- `data`: [Session](#schema-session)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_CURRENT_PASSWORD` · `PASSWORD_REUSED` · `WEAK_PASSWORD` · `VALIDATION_ERROR` · `INVALID_JSON` | No se pudo cambiar la contraseña |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 429 | `ACCOUNT_LOCKED` | Demasiados intentos fallidos |

### Plataforma · Empresas

<a id="op-get-platform-companies"></a>
#### `GET /platform/companies`

**Listar empresas**

**Acceso:** permiso `companies.manage` (admin global).

Ordenadas de la más reciente a la más antigua.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `search` | texto | no | Busca por nombre o por código de empresa (1 a 100 caracteres) |
| `status` | `active` \| `suspended` | no | — |

**Respuesta 200:** Página de empresas

- `data`: [Company](#schema-company)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-platform-companies"></a>
#### `POST /platform/companies`

**Crear una empresa con su administrador**

**Acceso:** permiso `companies.manage` (admin global).

Crea la empresa y su admin en una sola operación. Devuelve una contraseña temporal (se muestra una sola vez) que el admin deberá cambiar en su primer inicio de sesión.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (2 a 150 caracteres; ej. `"Taller Pérez"`) |
| `timezone` | texto | no | Zona horaria IANA. Si se omite: America/Denver (Salt Lake City, Utah). (1 a 64 caracteres; ej. `"America/Denver"`) |
| `maxEmployees` | entero | sí | (de 1 a 100000; ej. `25`) |
| `admin` | objeto | sí | — |
| `admin.email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `admin.firstName` | texto | sí | (1 a 100 caracteres; ej. `"Juan"`) |
| `admin.lastName` | texto | sí | (1 a 100 caracteres; ej. `"Pérez"`) |

**Respuesta 201:** Empresa creada

- `data`: [CreateCompanyResponse](#schema-createcompanyresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_COMPANY_NAME` · `INVALID_MAX_EMPLOYEES` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `EMAIL_TAKEN` | El email del admin ya está registrado |

<a id="op-get-platform-companies-id"></a>
#### `GET /platform/companies/{id}`

**Detalle de una empresa**

**Acceso:** permiso `companies.manage` (admin global).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Empresa

- `data`: [Company](#schema-company)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe |

<a id="op-patch-platform-companies-id"></a>
#### `PATCH /platform/companies/{id}`

**Editar una empresa**

**Acceso:** permiso `companies.manage` (admin global).

Solo se modifican los campos enviados.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (2 a 150 caracteres; ej. `"Taller Pérez"`) |
| `timezone` | texto | no | Zona horaria IANA (1 a 64 caracteres; ej. `"America/Denver"`) |
| `maxEmployees` | entero | no | (de 1 a 100000; ej. `25`) |

**Respuesta 200:** Empresa actualizada

- `data`: [Company](#schema-company)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_COMPANY_NAME` · `INVALID_MAX_EMPLOYEES` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe |
| 409 | `MAX_EMPLOYEES_BELOW_ACTIVE` | El límite es menor a los empleados activos |

<a id="op-patch-platform-companies-id-status"></a>
#### `PATCH /platform/companies/{id}/status`

**Suspender o reactivar una empresa**

**Acceso:** permiso `companies.manage` (admin global).

Al suspender, todos los usuarios de la empresa pierden el acceso de inmediato. Sus datos se conservan intactos.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `suspended` | sí | — |

**Respuesta 200:** Estado actualizado

- `data`: [Company](#schema-company)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe |

<a id="op-post-platform-companies-id-admin-reset-password"></a>
#### `POST /platform/companies/{id}/admin/reset-password`

**Restablecer la contraseña del admin de una empresa**

**Acceso:** permiso `companies.manage` (admin global).

Genera una contraseña temporal (se muestra una sola vez), cierra todas las sesiones del admin y desbloquea su cuenta.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Contraseña restablecida

- `data`: [ResetAdminPasswordResponse](#schema-resetadminpasswordresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` · `COMPANY_ADMIN_NOT_FOUND` | Empresa o admin inexistente |

### Empresa · Configuración

<a id="op-get-company"></a>
#### `GET /company`

**Datos de mi empresa**

**Acceso:** permiso `company.settings.manage` (admin de empresa).

**Respuesta 200:** Empresa

- `data`: [CompanySettings](#schema-companysettings)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-patch-company"></a>
#### `PATCH /company`

**Editar mi empresa**

**Acceso:** permiso `company.settings.manage` (admin de empresa).

Nombre y zona horaria. El límite de empleados y el estado solo los cambia el admin global.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (2 a 150 caracteres) |
| `timezone` | texto | no | (1 a 64 caracteres; ej. `"America/Denver"`) |
| `requireDailyReport` | booleano | no | true obliga al empleado a escribir el reporte de lo que hizo en el día al marcar salida (mínimo 10 caracteres). |
| `dailyLimitMinutes` | entero o null | no | Límite diario para todos los empleados de la empresa. Al alcanzarlo se cierra la entrada abierta y no pueden volver a marcar ese día. `null` = sin límite. (de 1 a 1440; ej. `490`) |

**Respuesta 200:** Empresa actualizada

- `data`: [CompanySettings](#schema-companysettings)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_COMPANY_NAME` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

### Empresa · Empleados

<a id="op-get-company-employees"></a>
#### `GET /company/employees`

**Listar empleados**

**Acceso:** permiso `employees.manage` (admin de empresa).

Ordenados por apellido y nombre.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `status` | `active` \| `inactive` | no | — |

**Respuesta 200:** Página de empleados

- `data`: [Employee](#schema-employee)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-company-employees"></a>
#### `POST /company/employees`

**Dar de alta un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Crea el empleado con su usuario y una contraseña temporal (se muestra una sola vez; deberá cambiarla al entrar). Respeta el límite de empleados activos de la empresa.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `firstName` | texto | sí | (1 a 100 caracteres; ej. `"Ana"`) |
| `lastName` | texto | sí | (1 a 100 caracteres; ej. `"López"`) |
| `phone` | texto o null | no | Teléfono de contacto opcional (solo informativo). `null` o vacío = sin teléfono. (0 a 30 caracteres; ej. `"+52 33 1234 5678"`) |
| `hiredAt` | fecha AAAA-MM-DD o null | no | Fecha de ingreso. Si se omite se registra sola el día del alta, en la zona horaria del empleado. (ej. `"2026-06-01"`) |
| `timezone` | texto o null | no | Zona horaria IANA del empleado. `null` u omitido = usa la de la empresa. (1 a 64 caracteres; ej. `"America/Mexico_City"`) |

**Respuesta 201:** Empleado creado

- `data`: [EmployeeWithTemporaryPassword](#schema-employeewithtemporarypassword)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_PHONE` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `EMPLOYEE_LIMIT_REACHED` · `EMAIL_TAKEN` | Límite alcanzado o email repetido |

<a id="op-get-company-employees-id"></a>
#### `GET /company/employees/{id}`

**Detalle de un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Empleado

- `data`: [Employee](#schema-employee)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |

<a id="op-patch-company-employees-id"></a>
#### `PATCH /company/employees/{id}`

**Editar un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Solo se modifican los campos enviados. `timezone: null` hace que herede la de la empresa.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | no | (1 a 100 caracteres) |
| `lastName` | texto | no | (1 a 100 caracteres) |
| `phone` | texto o null | no | Teléfono de contacto opcional (solo informativo). `null` o vacío = sin teléfono. (0 a 30 caracteres; ej. `"+52 33 1234 5678"`) |
| `hiredAt` | fecha AAAA-MM-DD o null | no | (ej. `"2026-06-01"`) |
| `timezone` | texto o null | no | Zona horaria IANA del empleado. `null` u omitido = usa la de la empresa. (1 a 64 caracteres; ej. `"America/Mexico_City"`) |
| `dailyLimitMinutes` | entero o null | no | Límite diario propio de este empleado. `null` = usa el de la empresa. Tiene prioridad sobre el de la empresa. (de 1 a 1440; ej. `490`) |

**Respuesta 200:** Empleado actualizado

- `data`: [Employee](#schema-employee)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_PHONE` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |

<a id="op-delete-company-employees-id"></a>
#### `DELETE /company/employees/{id}`

**Eliminar un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Solo funciona con un empleado que nunca registró horas ni reportes (por ejemplo un alta por error). Borra su cuenta y su historial de accesos, libera su correo y su lugar en el tope de empleados; su código no se reutiliza. Con historial responde `409 EMPLOYEE_HAS_HISTORY`: desactívalo en su lugar.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 204:** Empleado eliminado

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |
| 409 | `EMPLOYEE_HAS_HISTORY` | El empleado ya tiene historial |

<a id="op-patch-company-employees-id-status"></a>
#### `PATCH /company/employees/{id}/status`

**Activar o desactivar un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Desactivar le quita el acceso al instante y conserva su historial. Reactivar requiere lugar dentro del límite de la empresa.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `inactive` | sí | — |

**Respuesta 200:** Estado actualizado

- `data`: [Employee](#schema-employee)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |
| 409 | `EMPLOYEE_LIMIT_REACHED` | Sin lugar para reactivar |

<a id="op-post-company-employees-id-revoke-sessions"></a>
#### `POST /company/employees/{id}/revoke-sessions`

**Cerrar las sesiones de un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Cierra al instante todas las sesiones abiertas del empleado, por ejemplo si perdió su celular. No cambia su contraseña ni lo desactiva: puede iniciar sesión de nuevo.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 204:** Sesiones cerradas

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |

<a id="op-post-company-employees-id-reset-password"></a>
#### `POST /company/employees/{id}/reset-password`

**Restablecer la contraseña de un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa).

Genera una contraseña temporal (se muestra una sola vez), cierra sus sesiones y desbloquea su cuenta.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Contraseña restablecida

- `data`: [EmployeeWithTemporaryPassword](#schema-employeewithtemporarypassword)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |

### Empleado · Asistencia

<a id="op-get-me-clock-status"></a>
#### `GET /me/clock-status`

**¿Estoy trabajando?**

**Acceso:** permiso `attendance.clock_own` (empleado).

Estado actual, entrada abierta (si hay) y hora del servidor.

**Respuesta 200:** Estado

- `data`: [ClockStatus](#schema-clockstatus)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |

<a id="op-post-me-clock-in"></a>
#### `POST /me/clock-in`

**Marcar entrada**

**Acceso:** permiso `attendance.clock_own` (empleado).

La hora la registra el servidor (no se envía). Queda guardada la zona horaria del empleado y su día laboral local.

**Respuesta 201:** Entrada registrada

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |
| 409 | `ALREADY_CLOCKED_IN` · `DAILY_LIMIT_REACHED` · `DAILY_REPORT_PENDING` | Ya hay una entrada abierta, se alcanzó el límite diario o hay reportes pendientes (el error trae `details.dates`) |

<a id="op-post-me-clock-out"></a>
#### `POST /me/clock-out`

**Marcar salida**

**Acceso:** permiso `attendance.clock_own` (empleado).

Si la empresa exige el reporte diario, hay que mandar `dailyReport` con lo que hiciste hoy. El reporte y la salida van juntos: si el reporte no es válido no se marca la salida. Si el límite diario ya cerró la entrada, la salida queda en ese instante y el reporte no se exige.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `dailyReport` | texto | no | Reporte de lo que hiciste hoy (10 a 2000 caracteres). Si la empresa lo exige es obligatorio y se manda completo en cada salida, con el texto ya escrito ese día si lo hay. Reemplaza el reporte del día y se conserva la versión anterior. Texto en Markdown (negritas, cursiva, listas, enlaces y citas); un texto sin formato también sirve. (0 a 2000 caracteres) |

**Respuesta 200:** Salida registrada

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `DAILY_REPORT_REQUIRED` · `INVALID_DAILY_REPORT` · `VALIDATION_ERROR` · `INVALID_JSON` | Falta el reporte del día o no es válido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |
| 409 | `NOT_CLOCKED_IN` | No hay entrada abierta |

<a id="op-put-me-daily-reports-date"></a>
#### `PUT /me/daily-reports/{date}`

**Escribir o corregir el reporte de un día**

**Acceso:** permiso `attendance.clock_own` (empleado).

Un reporte por día laboral. Se puede editar el mismo día (la versión anterior queda en el historial) o escribir uno pendiente de un día reciente (hasta 14 días atrás) con marcajes. Un reporte de un día anterior ya no se edita.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `content` | texto | sí | Texto en Markdown (negritas, cursiva, listas, enlaces y citas); un texto sin formato también sirve. Los límites de 10 a 2000 caracteres cuentan el texto tal como se guarda, con sus marcas. (0 a 2000 caracteres) |

**Respuesta 200:** Reporte guardado

- `data`: [MyDailyReport](#schema-mydailyreport)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DAILY_REPORT` · `INVALID_REPORT_DATE` · `NO_WORK_ON_DATE` · `REPORT_DATE_TOO_OLD` · `VALIDATION_ERROR` · `INVALID_JSON` | Reporte o fecha inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |
| 409 | `DAILY_REPORT_LOCKED` | El reporte ya no se puede editar |

<a id="op-get-me-daily-reports-pending"></a>
#### `GET /me/daily-reports/pending`

**Mis reportes pendientes**

**Acceso:** permiso `attendance.read_own` (empleado).

Días anteriores con marcajes y sin reporte, de los últimos 14. Mientras haya alguno no se puede marcar entrada; se escriben con `PUT /me/daily-reports/{date}`. El de hoy no cuenta: se exige al marcar la salida.

**Respuesta 200:** Pendientes

- `data`: [MyPendingReports](#schema-mypendingreports)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |

<a id="op-get-me-daily-reports"></a>
#### `GET /me/daily-reports`

**Mis reportes del día**

**Acceso:** permiso `attendance.read_own` (empleado).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |

**Respuesta 200:** Reportes

- `data`: [MyDailyReport](#schema-mydailyreport)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |

<a id="op-get-me-timesheet"></a>
#### `GET /me/timesheet`

**Mi hoja de tiempo del periodo**

**Acceso:** permiso `attendance.read_own` (empleado).

Periodo de pago de 14 días (lunes a domingo) con una fila por día, su día de la semana y las horas decimales de ese día. Varios marcajes del mismo día se suman. Sin `date` devuelve el periodo actual; `previousPeriodStart` y `nextPeriodStart` sirven para navegar.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |

**Respuesta 200:** Hoja de tiempo

- `data`: [Timesheet](#schema-timesheet)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |

<a id="op-get-me-time-entries"></a>
#### `GET /me/time-entries`

**Mi historial de asistencia**

**Acceso:** permiso `attendance.read_own` (empleado).

Filtra por día laboral (`from`/`to`, inclusive). `meta.totalHours` suma las horas decimales trabajadas de todo el rango.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `status` | `open` \| `closed` | no | — |

**Respuesta 200:** Registros

- `data`: [MyTimeEntry](#schema-mytimeentry)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |
| `totalHours` | número | Horas decimales trabajadas (registros cerrados) de TODO el filtro, no solo esta página. Suma de las horas ya redondeadas de cada registro |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |

### Empresa · Asistencia

<a id="op-post-company-employees-id-clock-in"></a>
#### `POST /company/employees/{id}/clock-in`

**Marcar entrada a un empleado**

**Acceso:** permiso `attendance.clock_employees` (admin de empresa).

La hora la pone el servidor. Queda auditado quién lo hizo y el marcaje se ve como "admin". Si el empleado ya alcanzó su límite diario responde 409 `DAILY_LIMIT_REACHED`; con `overrideDailyLimit: true` se autoriza trabajar por encima del límite.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `overrideDailyLimit` | booleano | no | true autoriza trabajar por encima del límite diario (horas extra): si el empleado ya lo alcanzó se le marca entrada igual y esa entrada no se cierra sola. Con false se respeta el límite (por defecto `false`) |

**Respuesta 201:** Entrada registrada

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |
| 409 | `EMPLOYEE_ALREADY_CLOCKED_IN` · `EMPLOYEE_INACTIVE` · `DAILY_LIMIT_REACHED` | No se puede marcar entrada |

<a id="op-post-company-employees-id-clock-out"></a>
#### `POST /company/employees/{id}/clock-out`

**Marcar salida a un empleado**

**Acceso:** permiso `attendance.clock_employees` (admin de empresa).

La hora la pone el servidor. Queda auditado quién lo hizo y el marcaje muestra `closedBy: admin`.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Salida registrada

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |
| 409 | `EMPLOYEE_NOT_CLOCKED_IN` | El empleado no tiene entrada abierta |

<a id="op-get-company-daily-reports-pending"></a>
#### `GET /company/daily-reports/pending`

**Quién debe reportes del día**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Empleados activos con reportes pendientes y los días que les faltan, de los últimos 14 días. Solo si la empresa exige el reporte (`meta.required`). Filtra por `employeeId`.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `employeeId` | texto (uuid) | no | — |

**Respuesta 200:** Pendientes

- `data`: [PendingReportsOfEmployee](#schema-pendingreportsofemployee)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |
| `required` | booleano | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-daily-reports"></a>
#### `GET /company/daily-reports`

**Reportes del día de los empleados**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Filtra por empleado y día laboral (`from`/`to`, inclusive).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `employeeId` | texto (uuid) | no | — |

**Respuesta 200:** Reportes

- `data`: [DailyReport](#schema-dailyreport)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-daily-reports-export"></a>
#### `GET /company/daily-reports/export`

**Exportar los reportes del día a CSV**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Los mismos reportes de `/company/daily-reports` (filtra por empleado y día laboral con `from`/`to`), sin paginar, como archivo CSV (UTF-8). Con más de 5000 reportes hay que acotar el rango.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `employeeId` | texto (uuid) | no | — |

**Respuesta 200:** Archivo CSV

Devuelve un archivo CSV (`text/csv`), no JSON.

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `EXPORT_TOO_LARGE` · `VALIDATION_ERROR` | Rango inválido o demasiados reportes |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-daily-reports-id-revisions"></a>
#### `GET /company/daily-reports/{id}/revisions`

**Versiones anteriores de un reporte**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Las más recientes primero. Cada una trae cuándo fue reemplazada.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Versiones

- `data`: [DailyReportRevision](#schema-dailyreportrevision)[]

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `DAILY_REPORT_NOT_FOUND` | El reporte no existe en tu empresa |

<a id="op-get-company-activity"></a>
#### `GET /company/activity`

**Actividad del admin sobre la asistencia**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Quién marcó entrada o salida por un empleado, creó registros manuales, corrigió o anuló registros, y cuándo, con el motivo cuando lo hay. Lo más reciente primero. Filtra por empleado afectado, tipo y rango de instantes (`from` y `to`, UTC o local con desfase).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `employeeId` | texto (uuid) | no | Solo lo que afectó a este empleado |
| `type` | `time_entry.clocked_in_by_admin` \| `time_entry.clocked_out_by_admin` \| `time_entry.created_by_admin` \| `time_entry.corrected_by_admin` \| `time_entry.voided_by_admin` \| `pay_period.closed` | no | — |
| `from` | fecha y hora ISO 8601 | no | Desde este instante (inclusive) |
| `to` | fecha y hora ISO 8601 | no | Hasta este instante (inclusive) |

**Respuesta 200:** Actividad

- `data`: [AttendanceActivity](#schema-attendanceactivity)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-attendance-summary"></a>
#### `GET /company/attendance/summary`

**Resumen del día**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Pantalla de inicio del admin: empleados activos, cuántos están IN y OUT, horas trabajadas hoy por todos (cada empleado en su día local), quiénes alcanzaron su límite diario y cuántos reportes están pendientes. El detalle de pendientes está en `GET /company/daily-reports/pending`.

**Respuesta 200:** Resumen

- `data`: [AttendanceSummary](#schema-attendancesummary)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-attendance-roster"></a>
#### `GET /company/attendance/roster`

**Empleados con su estado IN / OUT**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Lista paginada de empleados activos, cada uno con `status` (`in` trabajando, `out` fuera), lo trabajado hoy y su límite diario. Filtra por `status` y busca por nombre, email o código. Para cambiar el estado usa `POST /company/employees/{id}/clock-in` o `/clock-out`.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `status` | `in` \| `out` | no | in = trabajando, out = fuera |

**Respuesta 200:** Empleados

- `data`: [AttendanceRosterEntry](#schema-attendancerosterentry)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |
| `asOf` | fecha y hora ISO 8601 | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-attendance-live"></a>
#### `GET /company/attendance/live`

**Quién está trabajando ahora**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

**Respuesta 200:** En turno

- `data`: [LiveAttendance](#schema-liveattendance)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-employees-id-timesheet"></a>
#### `GET /company/employees/{id}/timesheet`

**Hoja de tiempo de un empleado**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Igual que `/me/timesheet`, pero de cualquier empleado de la empresa.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |

**Respuesta 200:** Hoja de tiempo

- `data`: [Timesheet](#schema-timesheet)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-post-company-employees-id-time-entries"></a>
#### `POST /company/employees/{id}/time-entries`

**Crear un registro manual**

**Acceso:** permiso `time_entries.correct` (admin de empresa).

El admin registra una jornada pasada que nadie marcó, con entrada y salida. Solo de los últimos 14 días, sin horas futuras y sin cruzarse con otro registro del empleado. El motivo es obligatorio y queda auditado; el registro se ve como "admin". Acepta horas en UTC o locales con desfase.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `clockInAt` | fecha y hora ISO 8601 | sí | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutAt` | fecha y hora ISO 8601 | sí | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Olvidó marcar; confirmado con su supervisor"`) |

**Respuesta 201:** Registro creado

- `data`: [TimeEntry](#schema-timeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIME_RANGE` · `TIME_IN_FUTURE` · `MANUAL_ENTRY_TOO_OLD` · `INVALID_REASON` · `VALIDATION_ERROR` · `INVALID_JSON` | Horas o motivo inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |
| 409 | `TIME_ENTRY_OVERLAP` · `PERIOD_CLOSED` | Se cruza con otro registro o su periodo está cerrado |

<a id="op-get-company-timesheet"></a>
#### `GET /company/timesheet`

**Hoja de tiempo de todos los empleados**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Periodo de pago de 14 días con una fila por empleado y una cifra de horas por día (`meta.days` da las fechas en el mismo orden), más los totales de toda la empresa. Incluye a los empleados activos y a los desactivados que trabajaron en el periodo. Solo cuentan los marcajes cerrados. Sin `date` devuelve el periodo actual.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |

**Respuesta 200:** Hoja de tiempo

- `data`: [CompanyTimesheetRow](#schema-companytimesheetrow)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |
| `period` | objeto | — |
| `period.start` | fecha AAAA-MM-DD | (ej. `"2026-06-01"`) |
| `period.end` | fecha AAAA-MM-DD | (ej. `"2026-06-01"`) |
| `previousPeriodStart` | fecha AAAA-MM-DD | (ej. `"2026-06-01"`) |
| `nextPeriodStart` | fecha AAAA-MM-DD | (ej. `"2026-06-01"`) |
| `days` | objeto[] | — |
| `days[].date` | fecha AAAA-MM-DD | (ej. `"2026-06-01"`) |
| `days[].weekday` | `monday` \| `tuesday` \| `wednesday` \| `thursday` \| `friday` \| `saturday` \| `sunday` | — |
| `closed` | [PeriodClosure](#schema-periodclosure) o null | Datos del cierre; null si sigue abierto |
| `totals` | objeto | — |
| `totals.hours` | número[] | Horas de todos los empleados que coinciden con el filtro, por día |
| `totals.totalHours` | número | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-periods"></a>
#### `GET /company/periods`

**Estado de un periodo de pago**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Si el periodo está abierto o cerrado, si ya terminó, qué impide cerrarlo (entradas sin salida), cuántos reportes faltan (solo avisa) y el total de horas. `canClose` dice si se puede cerrar ahora. Sin `date` usa el periodo actual.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |

**Respuesta 200:** Estado

- `data`: [PayPeriodStatus](#schema-payperiodstatus)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-company-periods-close"></a>
#### `POST /company/periods/close`

**Cerrar un periodo de pago**

**Acceso:** permiso `periods.manage` (admin de empresa).

**Definitivo:** las horas del periodo quedan congeladas y no hay forma de reabrirlo. Después no se puede corregir, crear ni anular ningún registro de esos días (409 `PERIOD_CLOSED`); los reportes del día sí se siguen escribiendo. Solo se cierra un periodo que ya terminó y sin entradas abiertas. Los reportes pendientes no lo impiden. Queda guardado el total de horas al cerrar, quién y cuándo.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | sí | Cualquier día dentro del periodo que se cierra (ej. `"2026-06-01"`) |

**Respuesta 201:** Periodo cerrado

- `data`: [PeriodClosure](#schema-periodclosure)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `PERIOD_NOT_FINISHED` · `PERIOD_ALREADY_CLOSED` · `PERIOD_HAS_OPEN_ENTRIES` | No se puede cerrar |

<a id="op-get-company-timesheet-export"></a>
#### `GET /company/timesheet/export`

**Exportar la hoja de tiempo a CSV**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

La misma tabla de `/company/timesheet`, de todos los empleados y sin paginar, como archivo CSV (UTF-8, horas con 2 decimales).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |

**Respuesta 200:** Archivo CSV

Devuelve un archivo CSV (`text/csv`), no JSON.

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-time-entries"></a>
#### `GET /company/time-entries`

**Registros de asistencia de la empresa**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

Filtra por empleado, día laboral (`from`/`to`) y estado. Cada empleado se agrupa en sus días locales aunque estén en zonas horarias distintas.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `status` | `open` \| `closed` \| `voided` | no | Sin estado no se incluyen los anulados; voided trae solo los anulados |
| `employeeId` | texto (uuid) | no | — |

**Respuesta 200:** Registros

- `data`: [TimeEntry](#schema-timeentry)[]

- `meta` (datos adicionales de la respuesta):

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `page` | entero | — |
| `limit` | entero | — |
| `total` | entero | — |
| `totalPages` | entero | — |
| `totalHours` | número | Horas decimales trabajadas (registros cerrados) de TODO el filtro, no solo esta página. Suma de las horas ya redondeadas de cada registro |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-time-entries-id"></a>
#### `GET /company/time-entries/{id}`

**Detalle de un registro**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Registro

- `data`: [TimeEntry](#schema-timeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `TIME_ENTRY_NOT_FOUND` | El registro no existe en tu empresa |

<a id="op-patch-company-time-entries-id"></a>
#### `PATCH /company/time-entries/{id}`

**Corregir un registro**

**Acceso:** permiso `time_entries.correct` (admin de empresa).

Cambia la entrada y/o la salida (también sirve para cerrar una entrada olvidada). El motivo es obligatorio; el valor anterior queda guardado y el empleado ve que fue corregido. Acepta horas en UTC o locales con desfase.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `clockInAt` | fecha y hora ISO 8601 | no | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutAt` | fecha y hora ISO 8601 | no | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Olvidó marcar la salida; confirmado con su supervisor"`) |

**Respuesta 200:** Registro corregido

- `data`: [TimeEntry](#schema-timeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIME_RANGE` · `TIME_IN_FUTURE` · `NO_CHANGES` · `INVALID_REASON` · `VALIDATION_ERROR` · `INVALID_JSON` | Corrección inválida |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `TIME_ENTRY_NOT_FOUND` | El registro no existe en tu empresa |
| 409 | `TIME_ENTRY_OVERLAP` · `TIME_ENTRY_CHANGED` · `TIME_ENTRY_VOIDED` · `PERIOD_CLOSED` | Se cruza con otro registro |

<a id="op-post-company-time-entries-id-void"></a>
#### `POST /company/time-entries/{id}/void`

**Anular un registro**

**Acceso:** permiso `time_entries.correct` (admin de empresa).

Deja de contar en todo: horas, límite diario, hojas de tiempo, reportes pendientes, cruces y estado IN/OUT. No se borra: queda con quién lo anuló, cuándo y por qué, y el admin lo ve con `status: voided` (lista con `status=voided`). El empleado ya no lo ve. No se puede deshacer: si fue un error, se crea de nuevo con el registro manual. Si estaba abierto, el empleado queda libre para marcar entrada.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Se creó por duplicado"`) |

**Respuesta 200:** Registro anulado

- `data`: [TimeEntry](#schema-timeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_REASON` · `VALIDATION_ERROR` · `INVALID_JSON` | Motivo inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `TIME_ENTRY_NOT_FOUND` | El registro no existe en tu empresa |
| 409 | `TIME_ENTRY_VOIDED` · `PERIOD_CLOSED` | Ya estaba anulado o su periodo está cerrado |

<a id="op-get-company-time-entries-id-corrections"></a>
#### `GET /company/time-entries/{id}/corrections`

**Historial de correcciones de un registro**

**Acceso:** permiso `attendance.read_all` (admin de empresa).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Correcciones

- `data`: [TimeEntryCorrection](#schema-timeentrycorrection)[]

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `TIME_ENTRY_NOT_FOUND` | El registro no existe en tu empresa |

### Catálogo de códigos de error

| Código | HTTP | Dónde puede aparecer |
| --- | --- | --- |
| `ACCOUNT_LOCKED` | 429 | `PATCH /auth/me/password` |
| `ALREADY_CLOCKED_IN` | 409 | `POST /me/clock-in` |
| `COMPANY_ADMIN_NOT_FOUND` | 404 | `POST /platform/companies/{id}/admin/reset-password` |
| `COMPANY_NOT_FOUND` | 404 | 4 endpoints |
| `COMPANY_SUSPENDED` | 403 | 51 endpoints |
| `DAILY_LIMIT_REACHED` | 409 | `POST /me/clock-in`, `POST /company/employees/{id}/clock-in` |
| `DAILY_REPORT_LOCKED` | 409 | `PUT /me/daily-reports/{date}` |
| `DAILY_REPORT_NOT_FOUND` | 404 | `GET /company/daily-reports/{id}/revisions` |
| `DAILY_REPORT_PENDING` | 409 | `POST /me/clock-in` |
| `DAILY_REPORT_REQUIRED` | 400 | `POST /me/clock-out` |
| `EMAIL_TAKEN` | 409 | `POST /platform/companies`, `POST /company/employees` |
| `EMPLOYEE_ALREADY_CLOCKED_IN` | 409 | `POST /company/employees/{id}/clock-in` |
| `EMPLOYEE_HAS_HISTORY` | 409 | `DELETE /company/employees/{id}` |
| `EMPLOYEE_INACTIVE` | 409 | `POST /company/employees/{id}/clock-in` |
| `EMPLOYEE_LIMIT_REACHED` | 409 | `POST /company/employees`, `PATCH /company/employees/{id}/status` |
| `EMPLOYEE_NOT_CLOCKED_IN` | 409 | `POST /company/employees/{id}/clock-out` |
| `EMPLOYEE_NOT_FOUND` | 404 | 15 endpoints |
| `EMPLOYEE_PROFILE_NOT_FOUND` | 404 | 8 endpoints |
| `ERROR` | 503 | `GET /health` |
| `EXPORT_TOO_LARGE` | 400 | `GET /company/daily-reports/export` |
| `FORBIDDEN` | 403 | 45 endpoints |
| `INVALID_COMPANY_NAME` | 400 | `POST /platform/companies`, `PATCH /platform/companies/{id}`, `PATCH /company` |
| `INVALID_CREDENTIALS` | 401 | `POST /auth/login` |
| `INVALID_CURRENT_PASSWORD` | 400 | `PATCH /auth/me/password` |
| `INVALID_DAILY_REPORT` | 400 | `POST /me/clock-out`, `PUT /me/daily-reports/{date}` |
| `INVALID_DATE_RANGE` | 400 | 6 endpoints |
| `INVALID_JSON` | 400 | 19 endpoints |
| `INVALID_MAX_EMPLOYEES` | 400 | `POST /platform/companies`, `PATCH /platform/companies/{id}` |
| `INVALID_PHONE` | 400 | `POST /company/employees`, `PATCH /company/employees/{id}` |
| `INVALID_REASON` | 400 | `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}`, `POST /company/time-entries/{id}/void` |
| `INVALID_REFRESH_TOKEN` | 401 | `POST /auth/refresh` |
| `INVALID_REPORT_DATE` | 400 | `PUT /me/daily-reports/{date}` |
| `INVALID_TIME_RANGE` | 400 | `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `INVALID_TIMEZONE` | 400 | 5 endpoints |
| `INVALID_TOKEN` | 401 | 49 endpoints |
| `MANUAL_ENTRY_TOO_OLD` | 400 | `POST /company/employees/{id}/time-entries` |
| `MAX_EMPLOYEES_BELOW_ACTIVE` | 409 | `PATCH /platform/companies/{id}` |
| `MISSING_TOKEN` | 401 | 49 endpoints |
| `NO_CHANGES` | 400 | `PATCH /company/time-entries/{id}` |
| `NO_WORK_ON_DATE` | 400 | `PUT /me/daily-reports/{date}` |
| `NOT_CLOCKED_IN` | 409 | `POST /me/clock-out` |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 46 endpoints |
| `PASSWORD_REUSED` | 400 | `PATCH /auth/me/password` |
| `PERIOD_ALREADY_CLOSED` | 409 | `POST /company/periods/close` |
| `PERIOD_CLOSED` | 409 | `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}`, `POST /company/time-entries/{id}/void` |
| `PERIOD_HAS_OPEN_ENTRIES` | 409 | `POST /company/periods/close` |
| `PERIOD_NOT_FINISHED` | 409 | `POST /company/periods/close` |
| `REFRESH_TOKEN_EXPIRED` | 401 | `POST /auth/refresh` |
| `REPORT_DATE_TOO_OLD` | 400 | `PUT /me/daily-reports/{date}` |
| `SESSION_MAX_AGE_REACHED` | 401 | `POST /auth/refresh` |
| `SESSION_REVOKED` | 401 | 49 endpoints |
| `TEMPORARY_PASSWORD_EXPIRED` | 403 | `POST /auth/login` |
| `TIME_ENTRY_CHANGED` | 409 | `PATCH /company/time-entries/{id}` |
| `TIME_ENTRY_NOT_FOUND` | 404 | 4 endpoints |
| `TIME_ENTRY_OVERLAP` | 409 | `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `TIME_ENTRY_VOIDED` | 409 | `PATCH /company/time-entries/{id}`, `POST /company/time-entries/{id}/void` |
| `TIME_IN_FUTURE` | 400 | `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `TOKEN_EXPIRED` | 401 | 49 endpoints |
| `USER_INACTIVE` | 403 | 51 endpoints |
| `VALIDATION_ERROR` | 400 | 44 endpoints |
| `WEAK_PASSWORD` | 400 | `PATCH /auth/me/password` |

Además, **cualquier** endpoint puede responder `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `TOO_MANY_REQUESTS` (429) e `INTERNAL_ERROR` (500).

### Objetos que devuelve la API

<a id="schema-adminclockinrequest"></a>
#### AdminClockInRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `overrideDailyLimit` | booleano | no | true autoriza trabajar por encima del límite diario (horas extra): si el empleado ya lo alcanzó se le marca entrada igual y esa entrada no se cierra sola. Con false se respeta el límite (por defecto `false`) |

<a id="schema-attendanceactivity"></a>
#### AttendanceActivity

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `type` | `time_entry.clocked_in_by_admin` \| `time_entry.clocked_out_by_admin` \| `time_entry.created_by_admin` \| `time_entry.corrected_by_admin` \| `time_entry.voided_by_admin` \| `pay_period.closed` | sí | time_entry.clocked_in_by_admin, clocked_out_by_admin, created_by_admin, corrected_by_admin, voided_by_admin o pay_period.closed |
| `occurredAt` | fecha y hora ISO 8601 | sí | — |
| `actor` | objeto o null | sí | Quién lo hizo |
| `actor.id` | texto (uuid) | sí | — |
| `actor.firstName` | texto | sí | — |
| `actor.lastName` | texto | sí | — |
| `employee` | objeto o null | sí | A quién afectó |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `details` | objeto | sí | — |
| `details.timeEntryId` | texto (uuid) | no | — |
| `details.reason` | texto | no | — |
| `details.clockInAt` | fecha y hora ISO 8601 | no | — |
| `details.clockOutAt` | fecha y hora ISO 8601 o null | no | — |
| `details.previousClockInAt` | fecha y hora ISO 8601 | no | — |
| `details.previousClockOutAt` | fecha y hora ISO 8601 o null | no | — |
| `details.overrideDailyLimit` | booleano | no | — |
| `details.periodStart` | fecha AAAA-MM-DD | no | (ej. `"2026-06-01"`) |
| `details.periodEnd` | fecha AAAA-MM-DD | no | (ej. `"2026-06-01"`) |
| `details.totalHours` | número | no | — |

<a id="schema-attendancerosterentry"></a>
#### AttendanceRosterEntry

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `timezone` | texto | sí | — |
| `status` | `in` \| `out` | sí | — |
| `openEntryId` | texto (uuid) o null | sí | — |
| `clockedInAt` | fecha y hora ISO 8601 o null | sí | — |
| `clockedInLocal` | texto o null | sí | — |
| `elapsedSeconds` | entero o null | sí | De la entrada abierta |
| `workedTodaySeconds` | entero | sí | — |
| `workedTodayHours` | número | sí | — |
| `dailyLimit` | objeto o null | sí | null si el empleado no tiene límite diario |
| `dailyLimit.minutes` | entero | sí | — |
| `dailyLimit.workedSeconds` | entero | sí | — |
| `dailyLimit.remainingSeconds` | entero | sí | — |
| `dailyLimit.reached` | booleano | sí | — |

<a id="schema-attendancesummary"></a>
#### AttendanceSummary

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `asOf` | fecha y hora ISO 8601 | sí | — |
| `employees` | objeto | sí | — |
| `employees.active` | entero | sí | — |
| `employees.in` | entero | sí | Trabajando ahora |
| `employees.out` | entero | sí | — |
| `worked` | objeto | sí | Trabajado hoy por todos, incluidas las entradas abiertas |
| `worked.seconds` | entero | sí | — |
| `worked.hours` | número | sí | — |
| `atLimit` | objeto | sí | — |
| `atLimit.count` | entero | sí | — |
| `atLimit.employees` | objeto[] | sí | — |
| `atLimit.employees[].id` | texto (uuid) | sí | — |
| `atLimit.employees[].firstName` | texto | sí | — |
| `atLimit.employees[].lastName` | texto | sí | — |
| `atLimit.employees[].employeeCode` | texto o null | sí | — |
| `atLimit.employees[].limitMinutes` | entero | sí | — |
| `atLimit.employees[].workedSeconds` | entero | sí | — |
| `pendingReports` | objeto | sí | — |
| `pendingReports.required` | booleano | sí | — |
| `pendingReports.employees` | entero | sí | Empleados con reportes pendientes |
| `pendingReports.days` | entero | sí | Reportes pendientes en total |

<a id="schema-changecompanystatusrequest"></a>
#### ChangeCompanyStatusRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `suspended` | sí | — |

<a id="schema-changeemployeestatusrequest"></a>
#### ChangeEmployeeStatusRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `inactive` | sí | — |

<a id="schema-changepasswordrequest"></a>
#### ChangePasswordRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `currentPassword` | texto | sí | (1 a 128 caracteres) |
| `newPassword` | texto | sí | Mínimo 12 caracteres; distinta de la actual y del email. (0 a 128 caracteres) |

<a id="schema-clockoutrequest"></a>
#### ClockOutRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `dailyReport` | texto | no | Reporte de lo que hiciste hoy (10 a 2000 caracteres). Si la empresa lo exige es obligatorio y se manda completo en cada salida, con el texto ya escrito ese día si lo hay. Reemplaza el reporte del día y se conserva la versión anterior. Texto en Markdown (negritas, cursiva, listas, enlaces y citas); un texto sin formato también sirve. (0 a 2000 caracteres) |

<a id="schema-clockstatus"></a>
#### ClockStatus

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `clockedIn` | booleano | sí | — |
| `openEntry` | [MyTimeEntry](#schema-mytimeentry) o null | sí | null si no hay entrada abierta |
| `serverTime` | fecha y hora ISO 8601 | sí | — |
| `dailyLimit` | objeto o null | sí | null si el empleado no tiene límite diario |
| `dailyLimit.minutes` | entero | sí | — |
| `dailyLimit.workedSeconds` | entero | sí | Trabajado hoy, incluida la entrada abierta |
| `dailyLimit.remainingSeconds` | entero | sí | — |
| `dailyLimit.reached` | booleano | sí | true: ya no puede marcar entrada hoy |
| `elapsedSeconds` | entero o null | sí | Segundos transcurridos de la entrada abierta al momento de serverTime. El cliente avanza el contador desde aquí con su propio reloj |
| `timezone` | texto | sí | Zona que se usará al marcar |
| `pendingReports` | fecha AAAA-MM-DD[] | sí | Días con el reporte pendiente; mientras haya alguno no se puede marcar entrada |
| `canClockIn` | booleano | sí | false si ya hay una entrada abierta, hay reportes pendientes o se alcanzó el límite diario |
| `dailyReport` | objeto | sí | Reporte del día de la entrada abierta, o de hoy si no hay |
| `dailyReport.required` | booleano | sí | true: la empresa exige el reporte al marcar salida |
| `dailyReport.workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `dailyReport.content` | texto o null | sí | Reporte ya escrito ese día, para mostrarlo cargado al marcar salida. Es Markdown. |

<a id="schema-closeperiodrequest"></a>
#### ClosePeriodRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | sí | Cualquier día dentro del periodo que se cierra (ej. `"2026-06-01"`) |

<a id="schema-company"></a>
#### Company

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `code` | texto | sí | Código aleatorio que identifica a la empresa (soporte, correos). No cambia nunca. Identifica, no autentica: no es un secreto (ej. `"K7QF-29MX"`) |
| `employeeCodePrefix` | texto | sí | Letras con las que empiezan los códigos de sus empleados (KCS-0001) (ej. `"KCS"`) |
| `name` | texto | sí | — |
| `timezone` | texto | sí | — |
| `maxEmployees` | entero | sí | — |
| `activeEmployees` | entero | sí | — |
| `status` | `active` \| `suspended` | sí | — |
| `admin` | [CompanyAdmin](#schema-companyadmin) o null | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-companyadmin"></a>
#### CompanyAdmin

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `email` | texto (email) | sí | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `status` | `active` \| `inactive` | sí | — |
| `lastLoginAt` | fecha y hora ISO 8601 o null | sí | — |

<a id="schema-companysettings"></a>
#### CompanySettings

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `code` | texto | sí | Código que identifica a tu empresa (soporte, correos). No cambia nunca. No es un secreto (ej. `"K7QF-29MX"`) |
| `employeeCodePrefix` | texto | sí | Letras con las que empiezan los códigos de tus empleados (KCS-0001) (ej. `"KCS"`) |
| `name` | texto | sí | — |
| `timezone` | texto | sí | — |
| `status` | `active` \| `suspended` | sí | — |
| `dailyLimitMinutes` | entero o null | sí | null = sin límite. |
| `requireDailyReport` | booleano | sí | — |
| `maxEmployees` | entero | sí | Lo define el admin global. |
| `activeEmployees` | entero | sí | — |

<a id="schema-companytimesheetrow"></a>
#### CompanyTimesheetRow

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `employee.active` | booleano | sí | — |
| `hours` | número[] | sí | Horas decimales de cada día del periodo, en el mismo orden que meta.days |
| `totalHours` | número | sí | — |
| `openEntries` | entero | sí | Marcajes aún abiertos en el periodo (no suman horas hasta que se cierren) |

<a id="schema-correcttimeentryrequest"></a>
#### CorrectTimeEntryRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `clockInAt` | fecha y hora ISO 8601 | no | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutAt` | fecha y hora ISO 8601 | no | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Olvidó marcar la salida; confirmado con su supervisor"`) |

<a id="schema-createcompanyrequest"></a>
#### CreateCompanyRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (2 a 150 caracteres; ej. `"Taller Pérez"`) |
| `timezone` | texto | no | Zona horaria IANA. Si se omite: America/Denver (Salt Lake City, Utah). (1 a 64 caracteres; ej. `"America/Denver"`) |
| `maxEmployees` | entero | sí | (de 1 a 100000; ej. `25`) |
| `admin` | objeto | sí | — |
| `admin.email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `admin.firstName` | texto | sí | (1 a 100 caracteres; ej. `"Juan"`) |
| `admin.lastName` | texto | sí | (1 a 100 caracteres; ej. `"Pérez"`) |

<a id="schema-createcompanyresponse"></a>
#### CreateCompanyResponse

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `company` | [Company](#schema-company) | sí | — |
| `temporaryPassword` | texto | sí | Contraseña temporal del admin. Se muestra UNA sola vez; entrégala de forma segura. |
| `temporaryPasswordExpiresAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-createemployeerequest"></a>
#### CreateEmployeeRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `firstName` | texto | sí | (1 a 100 caracteres; ej. `"Ana"`) |
| `lastName` | texto | sí | (1 a 100 caracteres; ej. `"López"`) |
| `phone` | texto o null | no | Teléfono de contacto opcional (solo informativo). `null` o vacío = sin teléfono. (0 a 30 caracteres; ej. `"+52 33 1234 5678"`) |
| `hiredAt` | fecha AAAA-MM-DD o null | no | Fecha de ingreso. Si se omite se registra sola el día del alta, en la zona horaria del empleado. (ej. `"2026-06-01"`) |
| `timezone` | texto o null | no | Zona horaria IANA del empleado. `null` u omitido = usa la de la empresa. (1 a 64 caracteres; ej. `"America/Mexico_City"`) |

<a id="schema-createmanualtimeentryrequest"></a>
#### CreateManualTimeEntryRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `clockInAt` | fecha y hora ISO 8601 | sí | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutAt` | fecha y hora ISO 8601 | sí | (ej. `"2026-06-01T08:00:00-06:00"`) |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Olvidó marcar; confirmado con su supervisor"`) |

<a id="schema-currentuser"></a>
#### CurrentUser

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `email` | texto (email) | sí | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `role` | `platform_admin` \| `company_admin` \| `employee` | sí | — |
| `mustChangePassword` | booleano | sí | — |
| `company` | objeto o null | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.code` | texto | sí | — |
| `company.name` | texto | sí | — |
| `company.timezone` | texto | sí | — |
| `employee` | objeto o null | sí | — |
| `permissions` | (`companies.manage` \| `company.settings.manage` \| `employees.manage` \| `attendance.read_all` \| `time_entries.correct` \| `attendance.clock_employees` \| `periods.manage` \| `attendance.clock_own` \| `attendance.read_own`)[] | sí | — |

<a id="schema-dailyreport"></a>
#### DailyReport

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `content` | texto | sí | Texto del reporte en Markdown |
| `revisions` | entero | sí | Versiones anteriores conservadas |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |

<a id="schema-dailyreportrevision"></a>
#### DailyReportRevision

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `content` | texto | sí | — |
| `savedAt` | fecha y hora ISO 8601 | sí | Cuándo se reemplazó esta versión |

<a id="schema-employee"></a>
#### Employee

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `userId` | texto (uuid) | sí | — |
| `email` | texto (email) | sí | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `employeeCode` | texto | sí | Lo asigna el sistema al dar de alta: letras de la empresa y consecutivo. No cambia ni se reutiliza (ej. `"KCS-0001"`) |
| `phone` | texto o null | sí | — |
| `hiredAt` | fecha AAAA-MM-DD o null | sí | — |
| `timezone` | texto o null | sí | Zona propia; null = hereda. |
| `effectiveTimezone` | texto | sí | Zona que realmente aplica. |
| `dailyLimitMinutes` | entero o null | sí | Propio; null = hereda. |
| `effectiveDailyLimitMinutes` | entero o null | sí | Límite que realmente aplica; null = sin límite. |
| `status` | `active` \| `inactive` | sí | — |
| `mustChangePassword` | booleano | sí | — |
| `lastLoginAt` | fecha y hora ISO 8601 o null | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-employeewithtemporarypassword"></a>
#### EmployeeWithTemporaryPassword

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `employee` | [Employee](#schema-employee) | sí | — |
| `temporaryPassword` | texto | sí | Se muestra UNA sola vez; entrégala de forma segura al empleado. |
| `temporaryPasswordExpiresAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-healthreport"></a>
#### HealthReport

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `ok` \| `degraded` | sí | — |
| `checks` | objeto | sí | — |
| `uptimeSeconds` | entero | sí | — |
| `timestamp` | fecha y hora ISO 8601 | sí | — |

<a id="schema-liveattendance"></a>
#### LiveAttendance

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `asOf` | fecha y hora ISO 8601 | sí | — |
| `working` | entero | sí | — |
| `entries` | [TimeEntry](#schema-timeentry) + objeto[] | sí | — |

<a id="schema-loginrequest"></a>
#### LoginRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `password` | texto | sí | (1 a 128 caracteres) |

<a id="schema-loginresponse"></a>
#### LoginResponse

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `tokenType` | `Bearer` | sí | — |
| `accessToken` | texto | sí | — |
| `accessTokenExpiresAt` | fecha y hora ISO 8601 | sí | — |
| `refreshToken` | texto | sí | Guárdalo de forma segura. Cada uso devuelve uno nuevo y anula el anterior. |
| `refreshTokenExpiresAt` | fecha y hora ISO 8601 | sí | — |
| `user` | [CurrentUser](#schema-currentuser) | sí | — |

<a id="schema-mydailyreport"></a>
#### MyDailyReport

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `content` | texto | sí | Texto del reporte en Markdown |
| `revisions` | entero | sí | Versiones anteriores conservadas |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-mypendingreports"></a>
#### MyPendingReports

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `required` | booleano | sí | false: la empresa no exige el reporte |
| `days` | fecha AAAA-MM-DD[] | sí | Días anteriores con marcajes y sin reporte, de los últimos 14, del más viejo al más nuevo |

<a id="schema-mytimeentry"></a>
#### MyTimeEntry

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `status` | `open` \| `closed` | sí | — |
| `clockInAt` | fecha y hora ISO 8601 | sí | Instante exacto en UTC |
| `clockOutAt` | fecha y hora ISO 8601 o null | sí | — |
| `clockInLocal` | texto | sí | Hora local del empleado, con su desfase (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutLocal` | texto o null | sí | — |
| `timezone` | texto | sí | (ej. `"America/Denver"`) |
| `workDate` | fecha AAAA-MM-DD | sí | Día laboral local (fecha de la entrada) (ej. `"2026-06-01"`) |
| `durationSeconds` | entero o null | sí | null si sigue abierta |
| `durationHours` | número o null | sí | Horas decimales con 2 decimales, redondeadas al más cercano. null si sigue abierta (ej. `8.52`) |
| `source` | `web` \| `admin` | sí | — |
| `createdReason` | texto o null | sí | Motivo cuando el admin creó el registro a mano; null en un marcaje normal |
| `closedBy` | `employee` \| `admin` \| `daily_limit` o null | sí | Quién cerró el registro: el empleado, un admin o el límite diario. null si sigue abierto o es anterior a este dato |
| `corrected` | booleano | sí | true si un admin lo corrigió |

<a id="schema-payperiodstatus"></a>
#### PayPeriodStatus

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `period` | objeto | sí | — |
| `period.start` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `period.end` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `previousPeriodStart` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `nextPeriodStart` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `finished` | booleano | sí | El periodo ya terminó en la zona de la empresa |
| `closure` | [PeriodClosure](#schema-periodclosure) o null | sí | null si el periodo sigue abierto |
| `totalHours` | número | sí | Horas de los marcajes cerrados hoy |
| `openEntries` | objeto[] | sí | Entradas sin salida que impiden cerrar (máximo 50) |
| `openEntries[].timeEntryId` | texto (uuid) | sí | — |
| `openEntries[].employee` | objeto | sí | — |
| `openEntries[].employee.id` | texto (uuid) | sí | — |
| `openEntries[].employee.firstName` | texto | sí | — |
| `openEntries[].employee.lastName` | texto | sí | — |
| `openEntries[].employee.employeeCode` | texto o null | sí | — |
| `openEntries[].workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `pendingReports` | objeto | sí | — |
| `pendingReports.required` | booleano | sí | — |
| `pendingReports.employees` | entero | sí | — |
| `pendingReports.days` | entero | sí | Avisa pero no impide cerrar |
| `canClose` | booleano | sí | — |

<a id="schema-pendingreportsofemployee"></a>
#### PendingReportsOfEmployee

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `days` | fecha AAAA-MM-DD[] | sí | Días anteriores con marcajes y sin reporte, de los últimos 14, del más viejo al más nuevo |

<a id="schema-periodclosure"></a>
#### PeriodClosure

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `periodStart` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `periodEnd` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `totalHours` | número | sí | Horas del periodo al cerrar, para comparar con lo exportado |
| `closedAt` | fecha y hora ISO 8601 | sí | — |
| `closedBy` | objeto | sí | — |
| `closedBy.id` | texto (uuid) | sí | — |
| `closedBy.firstName` | texto | sí | — |
| `closedBy.lastName` | texto | sí | — |

<a id="schema-refreshrequest"></a>
#### RefreshRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `refreshToken` | texto | sí | (32 a 256 caracteres) |

<a id="schema-resetadminpasswordresponse"></a>
#### ResetAdminPasswordResponse

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `admin` | [CompanyAdmin](#schema-companyadmin) | sí | — |
| `temporaryPassword` | texto | sí | Se muestra UNA sola vez. |
| `temporaryPasswordExpiresAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-savedailyreportrequest"></a>
#### SaveDailyReportRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `content` | texto | sí | Texto en Markdown (negritas, cursiva, listas, enlaces y citas); un texto sin formato también sirve. Los límites de 10 a 2000 caracteres cuentan el texto tal como se guarda, con sus marcas. (0 a 2000 caracteres) |

<a id="schema-session"></a>
#### Session

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `tokenType` | `Bearer` | sí | — |
| `accessToken` | texto | sí | — |
| `accessTokenExpiresAt` | fecha y hora ISO 8601 | sí | — |
| `refreshToken` | texto | sí | Guárdalo de forma segura. Cada uso devuelve uno nuevo y anula el anterior. |
| `refreshTokenExpiresAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-timeentry"></a>
#### TimeEntry

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `status` | `open` \| `closed` \| `voided` | sí | — |
| `clockInAt` | fecha y hora ISO 8601 | sí | Instante exacto en UTC |
| `clockOutAt` | fecha y hora ISO 8601 o null | sí | — |
| `clockInLocal` | texto | sí | Hora local del empleado, con su desfase (ej. `"2026-06-01T08:00:00-06:00"`) |
| `clockOutLocal` | texto o null | sí | — |
| `timezone` | texto | sí | (ej. `"America/Denver"`) |
| `workDate` | fecha AAAA-MM-DD | sí | Día laboral local (fecha de la entrada) (ej. `"2026-06-01"`) |
| `durationSeconds` | entero o null | sí | null si sigue abierta |
| `durationHours` | número o null | sí | Horas decimales con 2 decimales, redondeadas al más cercano. null si sigue abierta (ej. `8.52`) |
| `source` | `web` \| `admin` | sí | — |
| `createdReason` | texto o null | sí | Motivo cuando el admin creó el registro a mano; null en un marcaje normal |
| `closedBy` | `employee` \| `admin` \| `daily_limit` o null | sí | Quién cerró el registro: el empleado, un admin o el límite diario. null si sigue abierto o es anterior a este dato |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `corrections` | entero | sí | — |
| `voidedAt` | fecha y hora ISO 8601 o null | sí | — |
| `voidReason` | texto o null | sí | — |
| `voidedBy` | objeto o null | sí | — |
| `voidedBy.id` | texto (uuid) | sí | — |
| `voidedBy.firstName` | texto | sí | — |
| `voidedBy.lastName` | texto | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-timeentrycorrection"></a>
#### TimeEntryCorrection

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `correctedBy` | objeto | sí | — |
| `correctedBy.id` | texto (uuid) | sí | — |
| `correctedBy.firstName` | texto | sí | — |
| `correctedBy.lastName` | texto | sí | — |
| `previousClockInAt` | fecha y hora ISO 8601 | sí | — |
| `previousClockOutAt` | fecha y hora ISO 8601 o null | sí | — |
| `newClockInAt` | fecha y hora ISO 8601 | sí | — |
| `newClockOutAt` | fecha y hora ISO 8601 o null | sí | — |
| `reason` | texto | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-timesheet"></a>
#### Timesheet

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `period` | objeto | sí | Periodo de pago de 14 días, de lunes a domingo |
| `period.start` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `period.end` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `previousPeriodStart` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `nextPeriodStart` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `timezone` | texto | sí | (ej. `"America/Denver"`) |
| `closed` | booleano | sí | El periodo ya se cerró: sus horas están congeladas y no cambian |
| `requiresDailyReport` | booleano | sí | Si es true, un día con marcajes y hasReport false tiene el reporte pendiente |
| `days` | objeto[] | sí | — |
| `days[].date` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `days[].weekday` | `monday` \| `tuesday` \| `wednesday` \| `thursday` \| `friday` \| `saturday` \| `sunday` | sí | — |
| `days[].entries` | entero | sí | Marcajes del día, abiertos o cerrados |
| `days[].openEntries` | entero | sí | Marcajes aún sin salida |
| `days[].hasReport` | booleano | sí | Si ese día tiene reporte escrito |
| `days[].hours` | número | sí | Horas decimales del día (solo marcajes cerrados) (ej. `8`) |
| `totalHours` | número | sí | (ej. `80.5`) |

<a id="schema-updatecompanyrequest"></a>
#### UpdateCompanyRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (2 a 150 caracteres; ej. `"Taller Pérez"`) |
| `timezone` | texto | no | Zona horaria IANA (1 a 64 caracteres; ej. `"America/Denver"`) |
| `maxEmployees` | entero | no | (de 1 a 100000; ej. `25`) |

<a id="schema-updatecompanysettingsrequest"></a>
#### UpdateCompanySettingsRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (2 a 150 caracteres) |
| `timezone` | texto | no | (1 a 64 caracteres; ej. `"America/Denver"`) |
| `requireDailyReport` | booleano | no | true obliga al empleado a escribir el reporte de lo que hizo en el día al marcar salida (mínimo 10 caracteres). |
| `dailyLimitMinutes` | entero o null | no | Límite diario para todos los empleados de la empresa. Al alcanzarlo se cierra la entrada abierta y no pueden volver a marcar ese día. `null` = sin límite. (de 1 a 1440; ej. `490`) |

<a id="schema-updateemployeerequest"></a>
#### UpdateEmployeeRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | no | (1 a 100 caracteres) |
| `lastName` | texto | no | (1 a 100 caracteres) |
| `phone` | texto o null | no | Teléfono de contacto opcional (solo informativo). `null` o vacío = sin teléfono. (0 a 30 caracteres; ej. `"+52 33 1234 5678"`) |
| `hiredAt` | fecha AAAA-MM-DD o null | no | (ej. `"2026-06-01"`) |
| `timezone` | texto o null | no | Zona horaria IANA del empleado. `null` u omitido = usa la de la empresa. (1 a 64 caracteres; ej. `"America/Mexico_City"`) |
| `dailyLimitMinutes` | entero o null | no | Límite diario propio de este empleado. `null` = usa el de la empresa. Tiene prioridad sobre el de la empresa. (de 1 a 1440; ej. `490`) |

<a id="schema-updateprofilerequest"></a>
#### UpdateProfileRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | sí | (1 a 100 caracteres) |
| `lastName` | texto | sí | (1 a 100 caracteres) |

<a id="schema-voidtimeentryrequest"></a>
#### VoidTimeEntryRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Se creó por duplicado"`) |
