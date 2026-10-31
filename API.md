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

**Admin multiempresa.** No tiene empresa propia: su acceso son las empresas que tiene asignadas. Al iniciar sesión **no tiene empresa activa**; con `POST /auth/active-company` elige una y recibe una sesión nueva cuya empresa activa es esa. Desde ahí todo funciona como para un admin de esa empresa y solo ve sus datos. Con `companyId: null` vuelve a quedar sin empresa activa. Si le quitan la empresa o la suspenden, su sesión en ella deja de servir de inmediato (`SESSION_REVOKED` o `COMPANY_SUSPENDED`) y no se puede renovar. Sin empresa activa, las rutas de empresa responden `403 COMPANY_REQUIRED`.

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

- El admin puede dejar que un empleado corrija **sus propias horas** (`allowSelfEdit` en `PATCH /company/employees/{id}`), con un último día opcional (`selfEditUntil`). Sin fecha, dura hasta que lo quite.
- Con el permiso, `PATCH /me/time-entries/{id}` cambia la entrada o la salida de un marcaje suyo, también para poner la salida que olvidó un día anterior. El motivo es obligatorio.
- Solo de los últimos días que elige la empresa (`selfEditDays` en `PATCH /company`, de 1 a 31, 7 por defecto) y nunca en un periodo cerrado (`409 SELF_EDIT_OUT_OF_RANGE`, `PERIOD_CLOSED`). La entrada abierta de hoy se termina con la salida (`409 SELF_EDIT_OPEN_TODAY`) y el cambio no puede pasar su límite diario (`409 SELF_EDIT_OVER_LIMIT`). Sin permiso o vencido: `403 SELF_EDIT_NOT_ALLOWED`.
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
- `PATCH /company/employees/{id}` — nombre, teléfono, fecha de ingreso, zona horaria, límite diario propio y el permiso para corregir sus horas (`allowSelfEdit`, `selfEditUntil`).
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
- `GET` y `PATCH /platform/companies/{id}` ven y editan una empresa (nombre, zona y límite de empleados).
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

### Índice de endpoints

**Sistema**

- [`GET /health`](#op-get-health) — Estado del servicio

**Autenticación**

- [`POST /auth/login`](#op-post-auth-login) — Iniciar sesión
- [`POST /auth/refresh`](#op-post-auth-refresh) — Renovar la sesión
- [`POST /auth/logout`](#op-post-auth-logout) — Cerrar sesión
- [`GET /auth/me`](#op-get-auth-me) — Perfil del usuario autenticado
- [`PATCH /auth/me`](#op-patch-auth-me) — Cambiar mi nombre
- [`POST /auth/active-company`](#op-post-auth-active-company) — Elegir la empresa con la que trabajo
- [`POST /auth/me/logout-all`](#op-post-auth-me-logout-all) — Cerrar todas mis sesiones
- [`PATCH /auth/me/password`](#op-patch-auth-me-password) — Cambiar mi contraseña

**Plataforma · Empresas**

- [`GET /platform/companies`](#op-get-platform-companies) — Listar empresas
- [`POST /platform/companies`](#op-post-platform-companies) — Crear una empresa con su administrador
- [`GET /platform/companies/{id}`](#op-get-platform-companies-id) — Detalle de una empresa
- [`PATCH /platform/companies/{id}`](#op-patch-platform-companies-id) — Editar una empresa
- [`PATCH /platform/companies/{id}/status`](#op-patch-platform-companies-id-status) — Suspender o reactivar una empresa
- [`POST /platform/companies/{id}/admin/reset-password`](#op-post-platform-companies-id-admin-reset-password) — Restablecer la contraseña del admin de una empresa

**Plataforma · Administradores multiempresa**

- [`GET /platform/multi-admins`](#op-get-platform-multi-admins) — Listar administradores multiempresa
- [`POST /platform/multi-admins`](#op-post-platform-multi-admins) — Crear un administrador multiempresa
- [`GET /platform/multi-admins/{id}`](#op-get-platform-multi-admins-id) — Detalle de un administrador multiempresa y sus empresas
- [`PATCH /platform/multi-admins/{id}`](#op-patch-platform-multi-admins-id) — Editar un administrador multiempresa
- [`PATCH /platform/multi-admins/{id}/status`](#op-patch-platform-multi-admins-id-status) — Desactivar o reactivar un administrador multiempresa
- [`POST /platform/multi-admins/{id}/reset-password`](#op-post-platform-multi-admins-id-reset-password) — Restablecer la contraseña de un administrador multiempresa
- [`POST /platform/multi-admins/{id}/companies`](#op-post-platform-multi-admins-id-companies) — Asignar una empresa existente a un administrador multiempresa
- [`DELETE /platform/multi-admins/{id}/companies/{companyId}`](#op-delete-platform-multi-admins-id-companies-companyid) — Quitar una empresa a un administrador multiempresa

**Admin multiempresa · Mis empresas**

- [`GET /portfolio/companies`](#op-get-portfolio-companies) — Mis empresas y lo que me queda de mi paquete
- [`POST /portfolio/companies`](#op-post-portfolio-companies) — Crear una empresa dentro de mi paquete

**Empresa · Configuración**

- [`GET /company`](#op-get-company) — Datos de mi empresa
- [`PATCH /company`](#op-patch-company) — Editar mi empresa
- [`GET /company/work-sites`](#op-get-company-work-sites) — Zonas de trabajo de mi empresa
- [`POST /company/work-sites`](#op-post-company-work-sites) — Crear una zona de trabajo
- [`PATCH /company/work-sites/{id}`](#op-patch-company-work-sites-id) — Editar o desactivar una zona de trabajo

**Empresa · Empleados**

- [`GET /company/employees`](#op-get-company-employees) — Listar empleados
- [`POST /company/employees`](#op-post-company-employees) — Dar de alta un empleado
- [`GET /company/employees/{id}`](#op-get-company-employees-id) — Detalle de un empleado
- [`PATCH /company/employees/{id}`](#op-patch-company-employees-id) — Editar un empleado
- [`DELETE /company/employees/{id}`](#op-delete-company-employees-id) — Eliminar un empleado
- [`PATCH /company/employees/{id}/status`](#op-patch-company-employees-id-status) — Activar o desactivar un empleado
- [`GET /company/employees/{id}/pay-rates`](#op-get-company-employees-id-pay-rates) — Sueldo de un empleado
- [`POST /company/employees/{id}/pay-rates`](#op-post-company-employees-id-pay-rates) — Cambiar el sueldo de un empleado
- [`DELETE /company/employees/{id}/pay-rates/{rateId}`](#op-delete-company-employees-id-pay-rates-rateid) — Quitar un cambio de sueldo
- [`POST /company/employees/{id}/revoke-sessions`](#op-post-company-employees-id-revoke-sessions) — Cerrar las sesiones de un empleado
- [`POST /company/employees/{id}/reset-password`](#op-post-company-employees-id-reset-password) — Restablecer la contraseña de un empleado

**Admin multiempresa · Todas mis empresas**

- [`GET /portfolio/employees`](#op-get-portfolio-employees) — Empleados de todas mis empresas
- [`GET /portfolio/summary`](#op-get-portfolio-summary) — Panel de todas mis empresas
- [`GET /portfolio/attendance/live`](#op-get-portfolio-attendance-live) — Quién está trabajando ahora en todas mis empresas, y desde dónde
- [`GET /portfolio/attendance/map`](#op-get-portfolio-attendance-map) — Dónde marcó la entrada cada empleado de todas mis empresas
- [`GET /portfolio/timesheet`](#op-get-portfolio-timesheet) — Horas de todos mis empleados
- [`GET /portfolio/timesheet/export`](#op-get-portfolio-timesheet-export) — Exportar las horas de todas mis empresas a CSV
- [`GET /portfolio/daily-reports`](#op-get-portfolio-daily-reports) — Reportes diarios de todas mis empresas
- [`GET /portfolio/daily-reports/export`](#op-get-portfolio-daily-reports-export) — Exportar los reportes de todas mis empresas a CSV
- [`GET /portfolio/payroll`](#op-get-portfolio-payroll) — Nómina de todas mis empresas
- [`GET /portfolio/payroll/export`](#op-get-portfolio-payroll-export) — Exportar la nómina de todas mis empresas a CSV

**Empleado · Asistencia**

- [`GET /me/clock-status`](#op-get-me-clock-status) — ¿Estoy trabajando?
- [`POST /me/clock-in`](#op-post-me-clock-in) — Marcar entrada
- [`POST /me/clock-out`](#op-post-me-clock-out) — Marcar salida
- [`PUT /me/daily-reports/{date}`](#op-put-me-daily-reports-date) — Escribir o corregir el reporte de un día
- [`GET /me/daily-reports/pending`](#op-get-me-daily-reports-pending) — Mis reportes pendientes
- [`GET /me/daily-reports`](#op-get-me-daily-reports) — Mis reportes del día
- [`GET /me/timesheet`](#op-get-me-timesheet) — Mi hoja de tiempo del periodo
- [`GET /me/time-entries`](#op-get-me-time-entries) — Mi historial de asistencia
- [`PATCH /me/time-entries/{id}`](#op-patch-me-time-entries-id) — Corregir mi marcaje

**Empresa · Asistencia**

- [`POST /company/employees/{id}/clock-in`](#op-post-company-employees-id-clock-in) — Marcar entrada a un empleado
- [`POST /company/employees/{id}/clock-out`](#op-post-company-employees-id-clock-out) — Marcar salida a un empleado
- [`GET /company/daily-reports/pending`](#op-get-company-daily-reports-pending) — Quién debe reportes del día
- [`GET /company/daily-reports`](#op-get-company-daily-reports) — Reportes del día de los empleados
- [`GET /company/daily-reports/export`](#op-get-company-daily-reports-export) — Exportar los reportes del día a CSV
- [`GET /company/daily-reports/{id}/revisions`](#op-get-company-daily-reports-id-revisions) — Versiones anteriores de un reporte
- [`GET /company/activity`](#op-get-company-activity) — Actividad del admin sobre la asistencia
- [`GET /company/attendance/summary`](#op-get-company-attendance-summary) — Resumen del día
- [`GET /company/attendance/map`](#op-get-company-attendance-map) — Dónde marcó la entrada cada empleado
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

**Empresa · Nómina**

- [`GET /company/payroll`](#op-get-company-payroll) — Nómina del periodo
- [`GET /company/payroll/export`](#op-get-company-payroll-export) — Exportar la nómina a CSV

**Empleado · Check-ins**

- [`GET /me/check-ins`](#op-get-me-check-ins) — Mis check-ins
- [`POST /me/check-ins`](#op-post-me-check-ins) — Registrar llegada (check-in)

**Empresa · Check-ins**

- [`GET /company/check-ins`](#op-get-company-check-ins) — Check-ins de los empleados
- [`POST /company/check-ins/{id}/void`](#op-post-company-check-ins-id-void) — Anular un check-in

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

<a id="op-post-auth-active-company"></a>
#### `POST /auth/active-company`

**Elegir la empresa con la que trabajo**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Solo para el admin multiempresa. Emite una sesión nueva cuya empresa activa es la elegida; desde ahí se trabaja como admin de esa empresa. Con `companyId: null` la sesión queda sin empresa activa. Las sesiones anteriores siguen válidas hasta cerrarlas.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) o null | sí | Empresa con la que quieres trabajar. null deja la sesión sin empresa activa, para ver el resumen de todas tus empresas. |

**Respuesta 200:** Sesión nueva

- `data`: [LoginResponse](#schema-loginresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `COMPANY_SUSPENDED` · `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` | La empresa está suspendida |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no está asignada a la cuenta |

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

### Plataforma · Administradores multiempresa

<a id="op-get-platform-multi-admins"></a>
#### `GET /platform/multi-admins`

**Listar administradores multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Del más reciente al más antiguo.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `search` | texto | no | Busca por correo o nombre (1 a 100 caracteres) |
| `status` | `active` \| `inactive` | no | — |

**Respuesta 200:** Página de administradores

- `data`: [MultiAdmin](#schema-multiadmin)[]

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

<a id="op-post-platform-multi-admins"></a>
#### `POST /platform/multi-admins`

**Crear un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Lo crea sin empresas, con su paquete: máximo de empresas y de empleados por empresa. Devuelve una contraseña temporal (se muestra una sola vez).

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `firstName` | texto | sí | (1 a 100 caracteres; ej. `"Laura"`) |
| `lastName` | texto | sí | (1 a 100 caracteres; ej. `"Gómez"`) |
| `maxCompanies` | entero | sí | Cuántas empresas puede tener asignadas o crear (de 1 a 1000; ej. `3`) |
| `maxEmployeesPerCompany` | entero | sí | Máximo de empleados de cada empresa que cree esa persona (de 1 a 100000; ej. `25`) |

**Respuesta 201:** Creado

- `data`: [CreateMultiAdminResponse](#schema-createmultiadminresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_MAX_COMPANIES` · `INVALID_MAX_EMPLOYEES` · `VALIDATION_ERROR` · `INVALID_JSON` | Límites inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `EMAIL_TAKEN` | El email ya está registrado |

<a id="op-get-platform-multi-admins-id"></a>
#### `GET /platform/multi-admins/{id}`

**Detalle de un administrador multiempresa y sus empresas**

**Acceso:** permiso `multi_admins.manage` (admin global).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Administrador y empresas

- `data`: [MultiAdminDetail](#schema-multiadmindetail)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` | El administrador multiempresa no existe |

<a id="op-patch-platform-multi-admins-id"></a>
#### `PATCH /platform/multi-admins/{id}`

**Editar un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Nombre y paquete. Solo se modifican los campos enviados.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | no | (1 a 100 caracteres) |
| `lastName` | texto | no | (1 a 100 caracteres) |
| `maxCompanies` | entero | no | Cuántas empresas puede tener asignadas o crear (de 1 a 1000; ej. `3`) |
| `maxEmployeesPerCompany` | entero | no | Máximo de empleados de cada empresa que cree esa persona (de 1 a 100000; ej. `25`) |

**Respuesta 200:** Actualizado

- `data`: [MultiAdmin](#schema-multiadmin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_MAX_COMPANIES` · `INVALID_MAX_EMPLOYEES` · `VALIDATION_ERROR` · `INVALID_JSON` | Límites inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` | El administrador multiempresa no existe |
| 409 | `MAX_COMPANIES_BELOW_ASSIGNED` | El máximo es menor a las empresas que ya tiene |

<a id="op-patch-platform-multi-admins-id-status"></a>
#### `PATCH /platform/multi-admins/{id}/status`

**Desactivar o reactivar un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Al desactivarlo pierde el acceso de inmediato. Sus empresas y datos se conservan.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `inactive` | sí | — |

**Respuesta 200:** Estado actualizado

- `data`: [MultiAdmin](#schema-multiadmin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` | El administrador multiempresa no existe |

<a id="op-post-platform-multi-admins-id-reset-password"></a>
#### `POST /platform/multi-admins/{id}/reset-password`

**Restablecer la contraseña de un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Genera una contraseña temporal (se muestra una sola vez), cierra todas sus sesiones y desbloquea su cuenta.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Contraseña restablecida

- `data`: [CreateMultiAdminResponse](#schema-createmultiadminresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` | El administrador multiempresa no existe |

<a id="op-post-platform-multi-admins-id-companies"></a>
#### `POST /platform/multi-admins/{id}/companies`

**Asignar una empresa existente a un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Le da acceso a la empresa, sin pasar de su máximo de empresas. La empresa conserva su propio admin de empresa.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) | sí | — |

**Respuesta 201:** Empresa asignada

- `data`: [MultiAdmin](#schema-multiadmin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` · `COMPANY_NOT_FOUND` | El administrador o la empresa no existen |
| 409 | `COMPANY_ALREADY_ASSIGNED` · `MAX_COMPANIES_REACHED` | Ya la tiene o llegó a su máximo de empresas |

<a id="op-delete-platform-multi-admins-id-companies-companyid"></a>
#### `DELETE /platform/multi-admins/{id}/companies/{companyId}`

**Quitar una empresa a un administrador multiempresa**

**Acceso:** permiso `multi_admins.manage` (admin global).

Pierde el acceso a esa empresa de inmediato. La empresa y sus datos no se tocan.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `companyId` | texto (uuid) | sí | — |

**Respuesta 200:** Empresa quitada

- `data`: [MultiAdmin](#schema-multiadmin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `MULTI_ADMIN_NOT_FOUND` · `MEMBERSHIP_NOT_FOUND` | El administrador no existe o no tenía esa empresa |

### Admin multiempresa · Mis empresas

<a id="op-get-portfolio-companies"></a>
#### `GET /portfolio/companies`

**Mis empresas y lo que me queda de mi paquete**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Las empresas a las que tiene acceso, por nombre, con su máximo de empresas y el de empleados por empresa que cree. Sirve para el selector de empresa.

**Respuesta 200:** Mis empresas

- `data`: [MyCompanies](#schema-mycompanies)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-portfolio-companies"></a>
#### `POST /portfolio/companies`

**Crear una empresa dentro de mi paquete**

**Acceso:** permiso `portfolio.companies.create` (multi_company_admin).

Crea la empresa con su admin y me la asigna. Su máximo de empleados es el que fijó el admin global para mi paquete. Devuelve la contraseña temporal del admin una sola vez.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (2 a 150 caracteres; ej. `"Sucursal Norte"`) |
| `timezone` | texto | no | Zona horaria IANA. Si se omite se usa America/Denver. (1 a 64 caracteres) |
| `admin` | objeto | sí | El admin de la nueva empresa. Recibe una contraseña temporal. |
| `admin.email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `admin.firstName` | texto | sí | (1 a 100 caracteres; ej. `"Juan"`) |
| `admin.lastName` | texto | sí | (1 a 100 caracteres; ej. `"Pérez"`) |

**Respuesta 201:** Empresa creada

- `data`: [CreateCompanyResponse](#schema-createcompanyresponse)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_COMPANY_NAME` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `MAX_COMPANIES_REACHED` · `EMAIL_TAKEN` | Llegó a su máximo de empresas o el email ya está registrado |

### Empresa · Configuración

<a id="op-get-company"></a>
#### `GET /company`

**Datos de mi empresa**

**Acceso:** permiso `company.settings.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `company.settings.manage` (admin de empresa, multi_company_admin).

Nombre y zona horaria. El límite de empleados y el estado solo los cambia el admin global.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (2 a 150 caracteres) |
| `timezone` | texto | no | (1 a 64 caracteres; ej. `"America/Denver"`) |
| `requireDailyReport` | booleano | no | true obliga al empleado a escribir el reporte de lo que hizo en el día al marcar salida (mínimo 10 caracteres). |
| `enforceWorkSites` | booleano | no | true exige que los empleados marquen su entrada dentro de una zona de trabajo. Requiere al menos una zona activa. |
| `allowCheckIns` | booleano | no | true deja que los empleados registren su llegada a un lugar (check-in) sin marcar entrada. No cuenta horas. |
| `selfEditDays` | entero | no | Cuántos días hacia atrás pueden corregir sus horas los empleados con permiso (1 a 31). Nunca dentro de un periodo cerrado. (de 1 a 31; ej. `7`) |
| `currency` | texto | no | Moneda en la que cobran los empleados, con el código ISO 4217 de 3 letras (USD, MXN...). Los periodos ya cerrados conservan la suya. (3 a 3 caracteres; ej. `"USD"`) |
| `dailyLimitMinutes` | entero o null | no | Límite diario para todos los empleados de la empresa. Al alcanzarlo se cierra la entrada abierta y no pueden volver a marcar ese día. `null` = sin límite. (de 1 a 1440; ej. `490`) |

**Respuesta 200:** Empresa actualizada

- `data`: [CompanySettings](#schema-companysettings)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIMEZONE` · `INVALID_COMPANY_NAME` · `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `WORK_SITES_REQUIRED` | Exigir zonas sin ninguna zona activa |

<a id="op-get-company-work-sites"></a>
#### `GET /company/work-sites`

**Zonas de trabajo de mi empresa**

**Acceso:** permiso `company.settings.manage` (admin de empresa, multi_company_admin).

Activas e inactivas, las activas primero.

**Respuesta 200:** Zonas

- `data`: [WorkSite](#schema-worksite)[]

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-post-company-work-sites"></a>
#### `POST /company/work-sites`

**Crear una zona de trabajo**

**Acceso:** permiso `company.settings.manage` (admin de empresa, multi_company_admin).

Un círculo (centro y radio en metros) donde se espera que el empleado marque su entrada. Al marcar se guarda si cayó dentro o fuera; con `enforceWorkSites` fuera de una zona no deja marcar.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (1 a 100 caracteres; ej. `"Oficina central"`) |
| `latitude` | número | sí | (de -90 a 90; ej. `40.7608`) |
| `longitude` | número | sí | (de -180 a 180; ej. `-111.891`) |
| `radiusMeters` | entero | sí | Radio de la zona en metros (10 a 60000) (de 10 a 60000; ej. `150`) |

**Respuesta 201:** Zona creada

- `data`: [WorkSite](#schema-worksite)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 409 | `WORK_SITE_LIMIT` | Demasiadas zonas |

<a id="op-patch-company-work-sites-id"></a>
#### `PATCH /company/work-sites/{id}`

**Editar o desactivar una zona de trabajo**

**Acceso:** permiso `company.settings.manage` (admin de empresa, multi_company_admin).

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (1 a 100 caracteres; ej. `"Oficina central"`) |
| `latitude` | número | no | (de -90 a 90; ej. `40.7608`) |
| `longitude` | número | no | (de -180 a 180; ej. `-111.891`) |
| `radiusMeters` | entero | no | Radio de la zona en metros (10 a 60000) (de 10 a 60000; ej. `150`) |
| `active` | booleano | no | false desactiva la zona sin borrarla; los marcajes pasados la conservan |

**Respuesta 200:** Zona actualizada

- `data`: [WorkSite](#schema-worksite)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `WORK_SITE_NOT_FOUND` | Zona inexistente |
| 409 | `WORK_SITES_REQUIRED` | Dejaría a la empresa sin zonas activas con la exigencia encendida |

### Empresa · Empleados

<a id="op-get-company-employees"></a>
#### `GET /company/employees`

**Listar empleados**

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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
| `allowCheckIns` | booleano o null | no | Registro de llegada (check-in) propio de este empleado. `true` lo permite y `false` lo prohíbe aunque la empresa diga lo contrario; `null` = usa el de la empresa. |
| `allowSelfEdit` | booleano | no | Permite que el empleado corrija la hora de entrada o salida de sus marcajes de los últimos días (los que diga la empresa), con motivo. Nunca en un periodo cerrado. |
| `selfEditUntil` | fecha AAAA-MM-DD o null | no | Último día en que puede corregir; `null` = sin vencimiento. (ej. `"2026-11-15"`) |

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

Desactivar le quita el acceso al instante y conserva su historial. Reactivar requiere lugar dentro del límite de la empresa.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `inactive` | sí | — |
| `effectiveOn` | fecha AAAA-MM-DD | no | Solo para el sueldo fijo. Al desactivar, el último día que se le paga; al reactivar, el primero. Por defecto hoy en la zona del empleado; no puede ser futuro ni caer en un periodo cerrado. El acceso cambia al momento. (ej. `"2026-10-30"`) |

**Respuesta 200:** Estado actualizado

- `data`: [Employee](#schema-employee)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_STATUS_DATE` · `VALIDATION_ERROR` · `INVALID_JSON` | Fecha inválida |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |
| 409 | `EMPLOYEE_LIMIT_REACHED` · `STATUS_DATE_IN_CLOSED_PERIOD` | Sin lugar para reactivar o la fecha cae en un periodo cerrado |

<a id="op-get-company-employees-id-pay-rates"></a>
#### `GET /company/employees/{id}/pay-rates`

**Sueldo de un empleado**

**Acceso:** permiso `pay.manage` (admin de empresa, multi_company_admin).

Historial de sueldo con la moneda de la empresa. Solo lo ven los admins; el empleado no.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Respuesta 200:** Historial de sueldo

- `data`: [EmployeePayRates](#schema-employeepayrates)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |

<a id="op-post-company-employees-id-pay-rates"></a>
#### `POST /company/employees/{id}/pay-rates`

**Cambiar el sueldo de un empleado**

**Acceso:** permiso `pay.manage` (admin de empresa, multi_company_admin).

Agrega un cambio que rige desde `effectiveFrom` hasta el siguiente. Si ya hay uno con esa fecha, lo reemplaza. Por hora paga horas × tarifa; el sueldo fijo se reparte entre los 14 días del periodo y solo cuenta los días activos. Queda en la auditoría.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `kind` | `hourly` \| `salary` | sí | `hourly`: el monto es lo que se paga por hora. `salary`: sueldo fijo de cada periodo de 14 días. |
| `amountCents` | entero | sí | En centavos de la moneda de la empresa: 1550 = 15.50. (de 0 a 1000000000; ej. `1550`) |
| `effectiveFrom` | fecha AAAA-MM-DD | sí | Día desde el que rige. Para aplicarlo a todo el periodo en curso, manda su primer día. No puede caer en un periodo cerrado. (ej. `"2026-10-19"`) |

**Respuesta 200:** Historial actualizado

- `data`: [EmployeePayRates](#schema-employeepayrates)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` · `INVALID_JSON` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | El empleado no existe en tu empresa |
| 409 | `PAY_RATE_IN_CLOSED_PERIOD` | La fecha cae en un periodo cerrado |

<a id="op-delete-company-employees-id-pay-rates-rateid"></a>
#### `DELETE /company/employees/{id}/pay-rates/{rateId}`

**Quitar un cambio de sueldo**

**Acceso:** permiso `pay.manage` (admin de empresa, multi_company_admin).

Para corregir un cambio equivocado, por ejemplo con la fecha mal puesta. No se puede quitar uno que rige en un periodo cerrado (`locked`). Queda en la auditoría con el monto que tenía.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `rateId` | texto (uuid) | sí | — |

**Respuesta 200:** Historial actualizado

- `data`: [EmployeePayRates](#schema-employeepayrates)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `PAY_RATE_NOT_FOUND` | El empleado o el cambio no existen en tu empresa |
| 409 | `PAY_RATE_IN_CLOSED_PERIOD` | Rige en un periodo cerrado |

<a id="op-post-company-employees-id-revoke-sessions"></a>
#### `POST /company/employees/{id}/revoke-sessions`

**Cerrar las sesiones de un empleado**

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `employees.manage` (admin de empresa, multi_company_admin).

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

### Admin multiempresa · Todas mis empresas

<a id="op-get-portfolio-employees"></a>
#### `GET /portfolio/employees`

**Empleados de todas mis empresas**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Por empresa, apellido y nombre, con la empresa de cada empleado. Solo cuenta las empresas activas. Solo lectura: para cambiar algo hay que elegir la empresa.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `status` | `active` \| `inactive` | no | — |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404 |

**Respuesta 200:** Empleados

- `data`: [PortfolioEmployee](#schema-portfolioemployee)[]

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
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-summary"></a>
#### `GET /portfolio/summary`

**Panel de todas mis empresas**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Empleados activos, IN y OUT, horas de hoy y del periodo, límites alcanzados y reportes pendientes, en total y por empresa. Solo cuenta las empresas activas; las suspendidas quedan fuera.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Resumen

- `data`: [PortfolioSummary](#schema-portfoliosummary)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-attendance-live"></a>
#### `GET /portfolio/attendance/live`

**Quién está trabajando ahora en todas mis empresas, y desde dónde**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Una fila por empleado con la entrada abierta, con su empresa y el punto donde marcó (`clockInLocation`, null si la registró un admin). Sirve para el mapa. Solo cuenta las empresas activas.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Quién trabaja ahora

- `data`: [PortfolioLive](#schema-portfoliolive)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-attendance-map"></a>
#### `GET /portfolio/attendance/map`

**Dónde marcó la entrada cada empleado de todas mis empresas**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Marcajes con ubicación en un rango de días laborales (`from`/`to`), los más recientes primero, con empresa, empleado, dentro o fuera de zona y si siguen abiertos. Devuelve hasta 500 puntos y `truncated` avisa si había más. Acota con `companyId` o `employeeId`. Solo cuenta las empresas activas.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `employeeId` | texto (uuid) | no | — |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Puntos del mapa

- `data`: [AttendanceMap](#schema-attendancemap)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-timesheet"></a>
#### `GET /portfolio/timesheet`

**Horas de todos mis empleados**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Periodo de pago de 14 días con una fila por empleado de todas mis empresas activas, con su empresa, y los totales de todos. Solo cuentan los marcajes cerrados. Sin `date` devuelve el periodo actual (el de la empresa más atrasada en el calendario).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Hoja de tiempo

- `data`: [PortfolioTimesheetRow](#schema-portfoliotimesheetrow)[]

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
| `totals` | objeto | — |
| `totals.hours` | número[] | — |
| `totals.totalHours` | número | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-timesheet-export"></a>
#### `GET /portfolio/timesheet/export`

**Exportar las horas de todas mis empresas a CSV**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

La misma tabla de `/portfolio/timesheet`, sin paginar, como archivo CSV (UTF-8, horas con 2 decimales) con la empresa de cada empleado en las primeras columnas.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Archivo CSV

Devuelve un archivo CSV (`text/csv`), no JSON.

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-daily-reports"></a>
#### `GET /portfolio/daily-reports`

**Reportes diarios de todas mis empresas**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Los más recientes primero, con la empresa y el empleado de cada uno. Filtra por día laboral (`from`/`to`) y por empresa.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Reportes

- `data`: [PortfolioDailyReport](#schema-portfoliodailyreport)[]

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
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-daily-reports-export"></a>
#### `GET /portfolio/daily-reports/export`

**Exportar los reportes de todas mis empresas a CSV**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

Los mismos reportes de `/portfolio/daily-reports`, sin paginar, como archivo CSV (UTF-8) con la empresa al inicio de cada fila. Con más de 5000 reportes hay que acotar el rango.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Archivo CSV

Devuelve un archivo CSV (`text/csv`), no JSON.

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `EXPORT_TOO_LARGE` · `VALIDATION_ERROR` | Rango inválido o demasiados reportes |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-payroll"></a>
#### `GET /portfolio/payroll`

**Nómina de todas mis empresas**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

La nómina de todos los empleados de mis empresas activas, con su empresa y su moneda, y un total por moneda en `meta.payTotals`: los montos de monedas distintas nunca se suman.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Nómina

- `data`: [PortfolioPayrollRow](#schema-portfoliopayrollrow)[]

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
| `totalHours` | número | Horas de las filas que coinciden con el filtro |
| `employeeCount` | entero | Empleados del filtro, con y sin sueldo; la tabla solo trae a los que tienen monto |
| `missingPay` | objeto[] | Empleados sin sueldo en el periodo, con su empresa |
| `missingPay[].company` | objeto | — |
| `missingPay[].company.id` | texto (uuid) | — |
| `missingPay[].company.name` | texto | — |
| `missingPay[].company.code` | texto | — |
| `missingPay[].employee` | objeto | — |
| `missingPay[].employee.id` | texto (uuid) | — |
| `missingPay[].employee.firstName` | texto | — |
| `missingPay[].employee.lastName` | texto | — |
| `missingPay[].employee.employeeCode` | texto o null | — |
| `missingPay[].employee.active` | booleano | — |
| `payTotals` | objeto[] | Total a pagar de cada moneda, de las filas del filtro: las empresas pueden pagar en monedas distintas y nunca se suman. |
| `payTotals[].currency` | texto | (ej. `"USD"`) |
| `payTotals[].totalCents` | entero | Suma de lo que se paga en el filtro |
| `payTotals[].hourlyCents` | entero | Parte del total de quienes cobran por hora (según su sueldo en su último día del periodo) |
| `payTotals[].salaryCents` | entero | Parte del total de quienes tienen sueldo fijo |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

<a id="op-get-portfolio-payroll-export"></a>
#### `GET /portfolio/payroll/export`

**Exportar la nómina de todas mis empresas a CSV**

**Acceso:** permiso `portfolio.read` (multi_company_admin).

La misma tabla de `/portfolio/payroll`, sin paginar, como CSV, con una fila de total por moneda.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |
| `companyId` | texto (uuid) | no | Solo una de tus empresas. Una que no es tuya responde 404, igual que una inexistente |

**Respuesta 200:** Archivo CSV

Devuelve un archivo CSV (`text/csv`), no JSON.

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `COMPANY_NOT_FOUND` | La empresa no existe o no es tuya |

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

La hora la registra el servidor (no se envía). Queda guardada la zona horaria del empleado y su día laboral local. Hay que mandar la ubicación del dispositivo (`latitude`, `longitude` y `accuracyMeters`); sin ella no se marca. Solo se guarda en la entrada, nunca de forma continua.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `latitude` | número | no | Grados, de -90 a 90 (ej. `40.7608`) |
| `longitude` | número | no | Grados, de -180 a 180 (ej. `-111.891`) |
| `accuracyMeters` | número | no | Precisión que reporta el dispositivo, en metros. Una baja no impide marcar (ej. `12`) |

**Respuesta 201:** Entrada registrada

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `LOCATION_REQUIRED` · `INVALID_LOCATION` · `VALIDATION_ERROR` · `INVALID_JSON` | Falta la ubicación o no es válida |
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

<a id="op-patch-me-time-entries-id"></a>
#### `PATCH /me/time-entries/{id}`

**Corregir mi marcaje**

**Acceso:** permiso `attendance.clock_own` (empleado).

Solo si el admin te dio permiso y no ha vencido (`selfEdit` en `/me/clock-status`). Cambia la entrada o la salida de un marcaje tuyo de los últimos días que permite la empresa, también para poner la salida que olvidaste un día anterior. La entrada abierta de hoy se termina con `POST /me/clock-out`. El motivo es obligatorio y el admin ve el cambio en su actividad.

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

**Respuesta 200:** Marcaje corregido

- `data`: [MyTimeEntry](#schema-mytimeentry)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_TIME_RANGE` · `TIME_IN_FUTURE` · `NO_CHANGES` · `INVALID_REASON` · `VALIDATION_ERROR` · `INVALID_JSON` | Corrección inválida |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `SELF_EDIT_NOT_ALLOWED` · `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sin permiso para corregir |
| 404 | `TIME_ENTRY_NOT_FOUND` · `EMPLOYEE_PROFILE_NOT_FOUND` | El marcaje no existe o no es tuyo |
| 409 | `SELF_EDIT_OUT_OF_RANGE` · `SELF_EDIT_OPEN_TODAY` · `SELF_EDIT_OVER_LIMIT` · `TIME_ENTRY_OVERLAP` · `TIME_ENTRY_CHANGED` · `TIME_ENTRY_VOIDED` · `PERIOD_CLOSED` | El cambio no se puede hacer |

### Empresa · Asistencia

<a id="op-post-company-employees-id-clock-in"></a>
#### `POST /company/employees/{id}/clock-in`

**Marcar entrada a un empleado**

**Acceso:** permiso `attendance.clock_employees` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.clock_employees` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

Quién marcó entrada o salida por un empleado, creó registros manuales, corrigió o anuló registros, y cuándo, con el motivo cuando lo hay. Lo más reciente primero. Filtra por empleado afectado, tipo y rango de instantes (`from` y `to`, UTC o local con desfase).

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `employeeId` | texto (uuid) | no | Solo lo que afectó a este empleado |
| `type` | `time_entry.clocked_in_by_admin` \| `time_entry.clocked_out_by_admin` \| `time_entry.created_by_admin` \| `time_entry.corrected_by_admin` \| `time_entry.corrected_by_employee` \| `time_entry.voided_by_admin` \| `check_in.voided_by_admin` \| `pay_period.closed` | no | — |
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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

Pantalla de inicio del admin: empleados activos, cuántos están IN y OUT, horas trabajadas hoy por todos (cada empleado en su día local), quiénes alcanzaron su límite diario y cuántos reportes están pendientes. El detalle de pendientes está en `GET /company/daily-reports/pending`.

**Respuesta 200:** Resumen

- `data`: [AttendanceSummary](#schema-attendancesummary)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-attendance-map"></a>
#### `GET /company/attendance/map`

**Dónde marcó la entrada cada empleado**

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

Marcajes con ubicación en un rango de días laborales (`from`/`to`), los más recientes primero, con el empleado, dentro o fuera de zona y si siguen abiertos. Devuelve hasta 500 puntos y `truncated` avisa si había más. Filtra por `employeeId`.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `employeeId` | texto (uuid) | no | — |

**Respuesta 200:** Puntos del mapa

- `data`: [AttendanceMap](#schema-attendancemap)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_DATE_RANGE` · `VALIDATION_ERROR` | Rango inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_NOT_FOUND` | Empleado inexistente |

<a id="op-get-company-attendance-roster"></a>
#### `GET /company/attendance/roster`

**Empleados con su estado IN / OUT**

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `time_entries.correct` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `periods.manage` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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
| `location` | `without` \| `outside` | no | without: solo los marcajes sin ubicación guardada; outside: solo los marcados fuera de una zona de trabajo |

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `time_entries.correct` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `time_entries.correct` (admin de empresa, multi_company_admin).

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

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

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

### Empresa · Nómina

<a id="op-get-company-payroll"></a>
#### `GET /company/payroll`

**Nómina del periodo**

**Acceso:** permiso `pay.manage` (admin de empresa, multi_company_admin).

Lo que se paga a cada empleado en un periodo de 14 días: tipo de pago, sueldo, horas, días con sueldo fijo y monto, más el total. En un periodo cerrado son los montos congelados al cerrar. Sin `date` devuelve el periodo actual.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `date` | fecha AAAA-MM-DD | no | Cualquier día dentro del periodo que quieres ver. Sin él se usa el periodo actual |
| `search` | texto | no | Busca en nombre, apellido, email o código (1 a 100 caracteres) |

**Respuesta 200:** Nómina

- `data`: [PayrollRow](#schema-payrollrow)[]

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
| `totalHours` | número | Horas de las filas que coinciden con el filtro |
| `employeeCount` | entero | Empleados del filtro, con y sin sueldo; la tabla solo trae a los que tienen monto |
| `closed` | [PeriodClosure](#schema-periodclosure) o null | Datos del cierre; null si sigue abierto |
| `pay` | objeto o null | null si el periodo se cerró antes de que hubiera sueldos |
| `missingPay` | objeto[] | Empleados sin sueldo en el periodo: no suman al total y no van en la tabla. Se cargan desde su ficha. |
| `missingPay[].id` | texto (uuid) | — |
| `missingPay[].firstName` | texto | — |
| `missingPay[].lastName` | texto | — |
| `missingPay[].employeeCode` | texto o null | — |
| `missingPay[].active` | booleano | — |

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Datos inválidos |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |

<a id="op-get-company-payroll-export"></a>
#### `GET /company/payroll/export`

**Exportar la nómina a CSV**

**Acceso:** permiso `pay.manage` (admin de empresa, multi_company_admin).

La misma tabla de `/company/payroll`, sin paginar, como archivo CSV (UTF-8).

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

### Empleado · Check-ins

<a id="op-get-me-check-ins"></a>
#### `GET /me/check-ins`

**Mis check-ins**

**Acceso:** permiso `attendance.read_own` (empleado).

Tus llegadas registradas, las más recientes primero. Filtra por día laboral con `from`/`to`. Los que anuló el administrador no aparecen.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |

**Respuesta 200:** Check-ins

- `data`: [MyCheckIn](#schema-mycheckin)[]

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

<a id="op-post-me-check-ins"></a>
#### `POST /me/check-ins`

**Registrar llegada (check-in)**

**Acceso:** permiso `attendance.clock_own` (empleado).

Deja constancia de que el empleado llegó a un lugar, con la hora del servidor y la ubicación del dispositivo (`latitude`, `longitude` y `accuracyMeters`, obligatorias) y una nota opcional. No marca entrada ni salida y no cuenta horas: funciona con o sin la entrada marcada. Se guarda si cayó dentro o fuera de una zona de trabajo, sin bloquear. La empresa debe tenerlo activado (`allowCheckIns`); hasta 50 por día.

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `latitude` | número | no | Grados, de -90 a 90 (ej. `40.7608`) |
| `longitude` | número | no | Grados, de -180 a 180 (ej. `-111.891`) |
| `accuracyMeters` | número | no | Precisión que reporta el dispositivo, en metros. Una baja no impide marcar (ej. `12`) |
| `note` | texto | no | Nota opcional, hasta 200 caracteres (0 a 200 caracteres; ej. `"Llegué con el cliente Pérez"`) |

**Respuesta 201:** Llegada registrada

- `data`: [MyCheckIn](#schema-mycheckin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `LOCATION_REQUIRED` · `INVALID_LOCATION` · `INVALID_CHECK_IN_NOTE` · `VALIDATION_ERROR` · `INVALID_JSON` | Falta la ubicación, no es válida o la nota es muy larga |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `EMPLOYEE_PROFILE_NOT_FOUND` | Tu usuario no tiene perfil de empleado |
| 409 | `CHECK_INS_DISABLED` · `CHECK_IN_LIMIT_REACHED` | La empresa no lo tiene activado o ya se llegó al máximo del día |

### Empresa · Check-ins

<a id="op-get-company-check-ins"></a>
#### `GET /company/check-ins`

**Check-ins de los empleados**

**Acceso:** permiso `attendance.read_all` (admin de empresa, multi_company_admin).

Llegadas registradas por los empleados, las más recientes primero, con ubicación, zona y nota. Filtra por `employeeId`, día laboral (`from`/`to`), `location=outside` y `status=voided` para ver los anulados.

**Parámetros de la URL (query):**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `page` | entero | no | (de 1 a ∞; por defecto `1`) |
| `limit` | entero | no | (de 1 a 100; por defecto `20`) |
| `from` | fecha AAAA-MM-DD | no | Día laboral inicial (inclusive) |
| `to` | fecha AAAA-MM-DD | no | Día laboral final (inclusive) |
| `employeeId` | texto (uuid) | no | — |
| `location` | `outside` | no | outside: solo los registrados fuera de toda zona de trabajo |
| `status` | `voided` | no | Sin estado no se incluyen los anulados; voided trae solo los anulados |

**Respuesta 200:** Check-ins

- `data`: [CompanyCheckIn](#schema-companycheckin)[]

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

<a id="op-post-company-check-ins-id-void"></a>
#### `POST /company/check-ins/{id}/void`

**Anular un check-in**

**Acceso:** permiso `time_entries.correct` (admin de empresa, multi_company_admin).

Para un check-in registrado por error. No se borra: queda con quién lo anuló, cuándo y por qué, deja de verse en listas y mapas y el empleado ya no lo ve. No se puede deshacer.

**Parámetros de la ruta:**

| Nombre | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |

**Cuerpo (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Lo registró por error en otro cliente"`) |

**Respuesta 200:** Check-in anulado

- `data`: [CompanyCheckIn](#schema-companycheckin)

**Errores:**

| HTTP | Códigos `error.code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_REASON` · `VALIDATION_ERROR` · `INVALID_JSON` | Motivo inválido |
| 401 | `MISSING_TOKEN` · `INVALID_TOKEN` · `TOKEN_EXPIRED` · `SESSION_REVOKED` | Sin sesión válida: inicia sesión o renueva el token |
| 403 | `FORBIDDEN` · `PASSWORD_CHANGE_REQUIRED` · `USER_INACTIVE` · `COMPANY_SUSPENDED` | Sesión válida pero sin acceso a esta acción |
| 404 | `CHECK_IN_NOT_FOUND` | El check-in no existe en tu empresa |
| 409 | `CHECK_IN_VOIDED` | Ya estaba anulado |

### Catálogo de códigos de error

| Código | HTTP | Dónde puede aparecer |
| --- | --- | --- |
| `ACCOUNT_LOCKED` | 429 | `PATCH /auth/me/password` |
| `ALREADY_CLOCKED_IN` | 409 | `POST /me/clock-in` |
| `CHECK_IN_LIMIT_REACHED` | 409 | `POST /me/check-ins` |
| `CHECK_IN_NOT_FOUND` | 404 | `POST /company/check-ins/{id}/void` |
| `CHECK_IN_VOIDED` | 409 | `POST /company/check-ins/{id}/void` |
| `CHECK_INS_DISABLED` | 409 | `POST /me/check-ins` |
| `COMPANY_ADMIN_NOT_FOUND` | 404 | `POST /platform/companies/{id}/admin/reset-password` |
| `COMPANY_ALREADY_ASSIGNED` | 409 | `POST /platform/multi-admins/{id}/companies` |
| `COMPANY_NOT_FOUND` | 404 | 16 endpoints |
| `COMPANY_SUSPENDED` | 403 | 86 endpoints |
| `DAILY_LIMIT_REACHED` | 409 | `POST /me/clock-in`, `POST /company/employees/{id}/clock-in` |
| `DAILY_REPORT_LOCKED` | 409 | `PUT /me/daily-reports/{date}` |
| `DAILY_REPORT_NOT_FOUND` | 404 | `GET /company/daily-reports/{id}/revisions` |
| `DAILY_REPORT_PENDING` | 409 | `POST /me/clock-in` |
| `DAILY_REPORT_REQUIRED` | 400 | `POST /me/clock-out` |
| `EMAIL_TAKEN` | 409 | 4 endpoints |
| `EMPLOYEE_ALREADY_CLOCKED_IN` | 409 | `POST /company/employees/{id}/clock-in` |
| `EMPLOYEE_HAS_HISTORY` | 409 | `DELETE /company/employees/{id}` |
| `EMPLOYEE_INACTIVE` | 409 | `POST /company/employees/{id}/clock-in` |
| `EMPLOYEE_LIMIT_REACHED` | 409 | `POST /company/employees`, `PATCH /company/employees/{id}/status` |
| `EMPLOYEE_NOT_CLOCKED_IN` | 409 | `POST /company/employees/{id}/clock-out` |
| `EMPLOYEE_NOT_FOUND` | 404 | 19 endpoints |
| `EMPLOYEE_PROFILE_NOT_FOUND` | 404 | 11 endpoints |
| `ERROR` | 503 | `GET /health` |
| `EXPORT_TOO_LARGE` | 400 | `GET /company/daily-reports/export`, `GET /portfolio/daily-reports/export` |
| `FORBIDDEN` | 403 | 80 endpoints |
| `INVALID_CHECK_IN_NOTE` | 400 | `POST /me/check-ins` |
| `INVALID_COMPANY_NAME` | 400 | 4 endpoints |
| `INVALID_CREDENTIALS` | 401 | `POST /auth/login` |
| `INVALID_CURRENT_PASSWORD` | 400 | `PATCH /auth/me/password` |
| `INVALID_DAILY_REPORT` | 400 | `POST /me/clock-out`, `PUT /me/daily-reports/{date}` |
| `INVALID_DATE_RANGE` | 400 | 12 endpoints |
| `INVALID_JSON` | 400 | 32 endpoints |
| `INVALID_LOCATION` | 400 | `POST /me/clock-in`, `POST /me/check-ins` |
| `INVALID_MAX_COMPANIES` | 400 | `POST /platform/multi-admins`, `PATCH /platform/multi-admins/{id}` |
| `INVALID_MAX_EMPLOYEES` | 400 | 4 endpoints |
| `INVALID_PHONE` | 400 | `POST /company/employees`, `PATCH /company/employees/{id}` |
| `INVALID_REASON` | 400 | 5 endpoints |
| `INVALID_REFRESH_TOKEN` | 401 | `POST /auth/refresh` |
| `INVALID_REPORT_DATE` | 400 | `PUT /me/daily-reports/{date}` |
| `INVALID_STATUS_DATE` | 400 | `PATCH /company/employees/{id}/status` |
| `INVALID_TIME_RANGE` | 400 | `PATCH /me/time-entries/{id}`, `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `INVALID_TIMEZONE` | 400 | 6 endpoints |
| `INVALID_TOKEN` | 401 | 84 endpoints |
| `LOCATION_REQUIRED` | 400 | `POST /me/clock-in`, `POST /me/check-ins` |
| `MANUAL_ENTRY_TOO_OLD` | 400 | `POST /company/employees/{id}/time-entries` |
| `MAX_COMPANIES_BELOW_ASSIGNED` | 409 | `PATCH /platform/multi-admins/{id}` |
| `MAX_COMPANIES_REACHED` | 409 | `POST /platform/multi-admins/{id}/companies`, `POST /portfolio/companies` |
| `MAX_EMPLOYEES_BELOW_ACTIVE` | 409 | `PATCH /platform/companies/{id}` |
| `MEMBERSHIP_NOT_FOUND` | 404 | `DELETE /platform/multi-admins/{id}/companies/{companyId}` |
| `MISSING_TOKEN` | 401 | 84 endpoints |
| `MULTI_ADMIN_NOT_FOUND` | 404 | 6 endpoints |
| `NO_CHANGES` | 400 | `PATCH /me/time-entries/{id}`, `PATCH /company/time-entries/{id}` |
| `NO_WORK_ON_DATE` | 400 | `PUT /me/daily-reports/{date}` |
| `NOT_CLOCKED_IN` | 409 | `POST /me/clock-out` |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 81 endpoints |
| `PASSWORD_REUSED` | 400 | `PATCH /auth/me/password` |
| `PAY_RATE_IN_CLOSED_PERIOD` | 409 | `POST /company/employees/{id}/pay-rates`, `DELETE /company/employees/{id}/pay-rates/{rateId}` |
| `PAY_RATE_NOT_FOUND` | 404 | `DELETE /company/employees/{id}/pay-rates/{rateId}` |
| `PERIOD_ALREADY_CLOSED` | 409 | `POST /company/periods/close` |
| `PERIOD_CLOSED` | 409 | 4 endpoints |
| `PERIOD_HAS_OPEN_ENTRIES` | 409 | `POST /company/periods/close` |
| `PERIOD_NOT_FINISHED` | 409 | `POST /company/periods/close` |
| `REFRESH_TOKEN_EXPIRED` | 401 | `POST /auth/refresh` |
| `REPORT_DATE_TOO_OLD` | 400 | `PUT /me/daily-reports/{date}` |
| `SELF_EDIT_NOT_ALLOWED` | 403 | `PATCH /me/time-entries/{id}` |
| `SELF_EDIT_OPEN_TODAY` | 409 | `PATCH /me/time-entries/{id}` |
| `SELF_EDIT_OUT_OF_RANGE` | 409 | `PATCH /me/time-entries/{id}` |
| `SELF_EDIT_OVER_LIMIT` | 409 | `PATCH /me/time-entries/{id}` |
| `SESSION_MAX_AGE_REACHED` | 401 | `POST /auth/refresh` |
| `SESSION_REVOKED` | 401 | 84 endpoints |
| `STATUS_DATE_IN_CLOSED_PERIOD` | 409 | `PATCH /company/employees/{id}/status` |
| `TEMPORARY_PASSWORD_EXPIRED` | 403 | `POST /auth/login` |
| `TIME_ENTRY_CHANGED` | 409 | `PATCH /me/time-entries/{id}`, `PATCH /company/time-entries/{id}` |
| `TIME_ENTRY_NOT_FOUND` | 404 | 5 endpoints |
| `TIME_ENTRY_OVERLAP` | 409 | `PATCH /me/time-entries/{id}`, `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `TIME_ENTRY_VOIDED` | 409 | `PATCH /me/time-entries/{id}`, `PATCH /company/time-entries/{id}`, `POST /company/time-entries/{id}/void` |
| `TIME_IN_FUTURE` | 400 | `PATCH /me/time-entries/{id}`, `POST /company/employees/{id}/time-entries`, `PATCH /company/time-entries/{id}` |
| `TOKEN_EXPIRED` | 401 | 84 endpoints |
| `USER_INACTIVE` | 403 | 86 endpoints |
| `VALIDATION_ERROR` | 400 | 78 endpoints |
| `WEAK_PASSWORD` | 400 | `PATCH /auth/me/password` |
| `WORK_SITE_LIMIT` | 409 | `POST /company/work-sites` |
| `WORK_SITE_NOT_FOUND` | 404 | `PATCH /company/work-sites/{id}` |
| `WORK_SITES_REQUIRED` | 409 | `PATCH /company`, `PATCH /company/work-sites/{id}` |

Además, **cualquier** endpoint puede responder `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `TOO_MANY_REQUESTS` (429) e `INTERNAL_ERROR` (500).

### Objetos que devuelve la API

<a id="schema-adminclockinrequest"></a>
#### AdminClockInRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `overrideDailyLimit` | booleano | no | true autoriza trabajar por encima del límite diario (horas extra): si el empleado ya lo alcanzó se le marca entrada igual y esa entrada no se cierra sola. Con false se respeta el límite (por defecto `false`) |

<a id="schema-assigncompanyrequest"></a>
#### AssignCompanyRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) | sí | — |

<a id="schema-attendanceactivity"></a>
#### AttendanceActivity

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `type` | `time_entry.clocked_in_by_admin` \| `time_entry.clocked_out_by_admin` \| `time_entry.created_by_admin` \| `time_entry.corrected_by_admin` \| `time_entry.corrected_by_employee` \| `time_entry.voided_by_admin` \| `check_in.voided_by_admin` \| `pay_period.closed` | sí | time_entry.clocked_in_by_admin, clocked_out_by_admin, created_by_admin, corrected_by_admin, corrected_by_employee (el empleado corrigió su propio marcaje con permiso), voided_by_admin, check_in.voided_by_admin o pay_period.closed |
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
| `details.checkInId` | texto (uuid) | no | — |
| `details.checkedInAt` | fecha y hora ISO 8601 | no | — |
| `details.reason` | texto | no | — |
| `details.clockInAt` | fecha y hora ISO 8601 | no | — |
| `details.clockOutAt` | fecha y hora ISO 8601 o null | no | — |
| `details.previousClockInAt` | fecha y hora ISO 8601 | no | — |
| `details.previousClockOutAt` | fecha y hora ISO 8601 o null | no | — |
| `details.overrideDailyLimit` | booleano | no | — |
| `details.periodStart` | fecha AAAA-MM-DD | no | (ej. `"2026-06-01"`) |
| `details.periodEnd` | fecha AAAA-MM-DD | no | (ej. `"2026-06-01"`) |
| `details.totalHours` | número | no | — |

<a id="schema-attendancemap"></a>
#### AttendanceMap

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `truncated` | booleano | sí | true si había más marcajes con ubicación que el tope y se devolvieron los más recientes |
| `points` | objeto[] | sí | — |
| `points[].id` | texto (uuid) | sí | — |
| `points[].company` | objeto | sí | — |
| `points[].company.id` | texto (uuid) | sí | — |
| `points[].company.name` | texto | sí | — |
| `points[].company.code` | texto | sí | — |
| `points[].employee` | objeto | sí | — |
| `points[].employee.id` | texto (uuid) | sí | — |
| `points[].employee.firstName` | texto | sí | — |
| `points[].employee.lastName` | texto | sí | — |
| `points[].employee.employeeCode` | texto o null | sí | — |
| `points[].workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `points[].clockInAt` | fecha y hora ISO 8601 | sí | — |
| `points[].timezone` | texto | sí | — |
| `points[].open` | booleano | sí | true mientras la entrada sigue abierta |
| `points[].clockInLocation` | [ClockLocation](#schema-clocklocation) | sí | — |
| `points[].clockInZone` | [ClockZone](#schema-clockzone) o null | sí | — |

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
| `clockedInLocation` | [ClockLocation](#schema-clocklocation) o null | sí | Dónde marcó la entrada abierta; null si no hay o la hizo un admin |
| `clockedInZone` | [ClockZone](#schema-clockzone) o null | sí | Si la entrada abierta cayó dentro o fuera de una zona de trabajo |
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
| `effectiveOn` | fecha AAAA-MM-DD | no | Solo para el sueldo fijo. Al desactivar, el último día que se le paga; al reactivar, el primero. Por defecto hoy en la zona del empleado; no puede ser futuro ni caer en un periodo cerrado. El acceso cambia al momento. (ej. `"2026-10-30"`) |

<a id="schema-changemultiadminstatusrequest"></a>
#### ChangeMultiAdminStatusRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `active` \| `inactive` | sí | — |

<a id="schema-changepasswordrequest"></a>
#### ChangePasswordRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `currentPassword` | texto | sí | (1 a 128 caracteres) |
| `newPassword` | texto | sí | Mínimo 12 caracteres; distinta de la actual y del email. (0 a 128 caracteres) |

<a id="schema-clockinrequest"></a>
#### ClockInRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `latitude` | número | no | Grados, de -90 a 90 (ej. `40.7608`) |
| `longitude` | número | no | Grados, de -180 a 180 (ej. `-111.891`) |
| `accuracyMeters` | número | no | Precisión que reporta el dispositivo, en metros. Una baja no impide marcar (ej. `12`) |

<a id="schema-clocklocation"></a>
#### ClockLocation

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `latitude` | número | sí | Grados, de -90 a 90 (ej. `40.7608`) |
| `longitude` | número | sí | Grados, de -180 a 180 (ej. `-111.891`) |
| `accuracyMeters` | número | sí | Precisión que reporta el dispositivo, en metros. Una baja no impide marcar (ej. `12`) |

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
| `canCheckIn` | booleano | sí | true si la empresa deja registrar llegadas (`POST /me/check-ins`), esté o no marcada la entrada |
| `selfEdit` | objeto o null | sí | Si hoy puede corregir sus marcajes (`PATCH /me/time-entries/{id}`); null si no tiene permiso o ya venció |
| `dailyReport` | objeto | sí | Reporte del día de la entrada abierta, o de hoy si no hay |
| `dailyReport.required` | booleano | sí | true: la empresa exige el reporte al marcar salida |
| `dailyReport.workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `dailyReport.content` | texto o null | sí | Reporte ya escrito ese día, para mostrarlo cargado al marcar salida. Es Markdown. |

<a id="schema-clockzone"></a>
#### ClockZone

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `status` | `inside` \| `outside` | sí | inside: dentro de una zona de trabajo; outside: fuera de todas |
| `site` | objeto | sí | La zona más cercana al punto donde marcó |
| `site.id` | texto (uuid) | sí | — |
| `site.name` | texto | sí | — |
| `distanceMeters` | entero | sí | Metros hasta el centro de esa zona |

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

<a id="schema-companycheckin"></a>
#### CompanyCheckIn

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `checkedInAt` | fecha y hora ISO 8601 | sí | Instante exacto en UTC |
| `checkedInLocal` | texto | sí | La misma hora en la zona horaria del empleado (ej. `"2026-06-01T10:15:00-06:00"`) |
| `timezone` | texto | sí | — |
| `workDate` | fecha AAAA-MM-DD | sí | Día laboral local del empleado (ej. `"2026-06-01"`) |
| `location` | [ClockLocation](#schema-clocklocation) | sí | — |
| `zone` | [ClockZone](#schema-clockzone) o null | sí | Dentro o fuera de la zona de trabajo más cercana; null si la empresa no tiene zonas |
| `note` | texto o null | sí | — |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `status` | `active` \| `voided` | sí | — |
| `voidedAt` | fecha y hora ISO 8601 o null | sí | — |
| `voidReason` | texto o null | sí | — |
| `voidedBy` | objeto o null | sí | — |
| `voidedBy.id` | texto (uuid) | sí | — |
| `voidedBy.firstName` | texto | sí | — |
| `voidedBy.lastName` | texto | sí | — |

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
| `enforceWorkSites` | booleano | sí | — |
| `allowCheckIns` | booleano | sí | — |
| `selfEditDays` | entero | sí | — |
| `currency` | texto | sí | (ej. `"USD"`) |
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

<a id="schema-createcheckinrequest"></a>
#### CreateCheckInRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `latitude` | número | no | Grados, de -90 a 90 (ej. `40.7608`) |
| `longitude` | número | no | Grados, de -180 a 180 (ej. `-111.891`) |
| `accuracyMeters` | número | no | Precisión que reporta el dispositivo, en metros. Una baja no impide marcar (ej. `12`) |
| `note` | texto | no | Nota opcional, hasta 200 caracteres (0 a 200 caracteres; ej. `"Llegué con el cliente Pérez"`) |

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

<a id="schema-createmultiadminrequest"></a>
#### CreateMultiAdminRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `firstName` | texto | sí | (1 a 100 caracteres; ej. `"Laura"`) |
| `lastName` | texto | sí | (1 a 100 caracteres; ej. `"Gómez"`) |
| `maxCompanies` | entero | sí | Cuántas empresas puede tener asignadas o crear (de 1 a 1000; ej. `3`) |
| `maxEmployeesPerCompany` | entero | sí | Máximo de empleados de cada empresa que cree esa persona (de 1 a 100000; ej. `25`) |

<a id="schema-createmultiadminresponse"></a>
#### CreateMultiAdminResponse

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `multiAdmin` | [MultiAdmin](#schema-multiadmin) | sí | — |
| `temporaryPassword` | texto | sí | Contraseña temporal. Se muestra UNA sola vez; entrégala de forma segura. |
| `temporaryPasswordExpiresAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-createowncompanyrequest"></a>
#### CreateOwnCompanyRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (2 a 150 caracteres; ej. `"Sucursal Norte"`) |
| `timezone` | texto | no | Zona horaria IANA. Si se omite se usa America/Denver. (1 a 64 caracteres) |
| `admin` | objeto | sí | El admin de la nueva empresa. Recibe una contraseña temporal. |
| `admin.email` | texto | sí | (ej. `"ana@empresa.com"`) |
| `admin.firstName` | texto | sí | (1 a 100 caracteres; ej. `"Juan"`) |
| `admin.lastName` | texto | sí | (1 a 100 caracteres; ej. `"Pérez"`) |

<a id="schema-createworksiterequest"></a>
#### CreateWorkSiteRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | sí | (1 a 100 caracteres; ej. `"Oficina central"`) |
| `latitude` | número | sí | (de -90 a 90; ej. `40.7608`) |
| `longitude` | número | sí | (de -180 a 180; ej. `-111.891`) |
| `radiusMeters` | entero | sí | Radio de la zona en metros (10 a 60000) (de 10 a 60000; ej. `150`) |

<a id="schema-currentuser"></a>
#### CurrentUser

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `email` | texto (email) | sí | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `role` | `platform_admin` \| `company_admin` \| `multi_company_admin` \| `employee` | sí | — |
| `mustChangePassword` | booleano | sí | — |
| `company` | objeto o null | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.code` | texto | sí | — |
| `company.name` | texto | sí | — |
| `company.timezone` | texto | sí | — |
| `employee` | objeto o null | sí | — |
| `permissions` | (`companies.manage` \| `multi_admins.manage` \| `portfolio.read` \| `portfolio.companies.create` \| `company.settings.manage` \| `employees.manage` \| `attendance.read_all` \| `time_entries.correct` \| `attendance.clock_employees` \| `periods.manage` \| `pay.manage` \| `attendance.clock_own` \| `attendance.read_own`)[] | sí | — |

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
| `allowCheckIns` | booleano o null | sí | Check-in propio: true o false lo fuerzan; null = hereda el de la empresa. |
| `effectiveAllowCheckIns` | booleano | sí | Si el empleado puede registrar llegadas, ya combinando el suyo con el de la empresa. |
| `allowSelfEdit` | booleano | sí | Si el admin le permite corregir sus propias horas. |
| `selfEditUntil` | fecha AAAA-MM-DD o null | sí | Último día del permiso; null = sin vencimiento. |
| `status` | `active` \| `inactive` | sí | — |
| `mustChangePassword` | booleano | sí | — |
| `lastLoginAt` | fecha y hora ISO 8601 o null | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-employeepayrates"></a>
#### EmployeePayRates

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `currency` | texto | sí | (ej. `"USD"`) |
| `rates` | [PayRate](#schema-payrate)[] | sí | — |
| `inactiveSpans` | objeto[] | sí | Bajas del empleado, de la más vieja a la más nueva: días en que no cobra sueldo fijo. `toDay` es null mientras sigue inactivo. |
| `inactiveSpans[].fromDay` | fecha AAAA-MM-DD | sí | — |
| `inactiveSpans[].toDay` | fecha AAAA-MM-DD o null | sí | — |

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

<a id="schema-multiadmin"></a>
#### MultiAdmin

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `email` | texto (email) | sí | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `status` | `active` \| `inactive` | sí | — |
| `lastLoginAt` | fecha y hora ISO 8601 o null | sí | — |
| `maxCompanies` | entero | sí | — |
| `maxEmployeesPerCompany` | entero | sí | — |
| `companyCount` | entero | sí | Empresas que tiene hoy |
| `createdAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-multiadmindetail"></a>
#### MultiAdminDetail

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `multiAdmin` | [MultiAdmin](#schema-multiadmin) | sí | — |
| `companies` | [Company](#schema-company)[] | sí | — |

<a id="schema-mycheckin"></a>
#### MyCheckIn

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `checkedInAt` | fecha y hora ISO 8601 | sí | Instante exacto en UTC |
| `checkedInLocal` | texto | sí | La misma hora en la zona horaria del empleado (ej. `"2026-06-01T10:15:00-06:00"`) |
| `timezone` | texto | sí | — |
| `workDate` | fecha AAAA-MM-DD | sí | Día laboral local del empleado (ej. `"2026-06-01"`) |
| `location` | [ClockLocation](#schema-clocklocation) | sí | — |
| `zone` | [ClockZone](#schema-clockzone) o null | sí | Dentro o fuera de la zona de trabajo más cercana; null si la empresa no tiene zonas |
| `note` | texto o null | sí | — |

<a id="schema-mycompanies"></a>
#### MyCompanies

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `limits` | objeto | sí | — |
| `limits.maxCompanies` | entero | sí | — |
| `limits.maxEmployeesPerCompany` | entero | sí | — |
| `limits.usedCompanies` | entero | sí | — |
| `companies` | [Company](#schema-company)[] | sí | — |

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
| `clockInLocation` | [ClockLocation](#schema-clocklocation) o null | sí | Dónde estaba el empleado al marcar su entrada. null si la registró un admin o es anterior a este dato |
| `clockInZone` | [ClockZone](#schema-clockzone) o null | sí | Si cayó dentro o fuera de una zona de trabajo al marcar. null si la empresa no tenía zonas o no hubo ubicación |
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

<a id="schema-payrate"></a>
#### PayRate

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `kind` | `hourly` \| `salary` | sí | `hourly`: el monto es lo que se paga por hora. `salary`: sueldo fijo de cada periodo de 14 días. |
| `amountCents` | entero | sí | — |
| `effectiveFrom` | fecha AAAA-MM-DD | sí | — |
| `changedById` | texto (uuid) | sí | — |
| `locked` | booleano | sí | Rige en un periodo cerrado: ya se pagó con él y no se puede quitar |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-payrollrow"></a>
#### PayrollRow

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `employee.active` | booleano | sí | — |
| `totalHours` | número | sí | — |
| `openEntries` | entero | sí | Marcajes aún abiertos: no suman horas ni pago hasta que se cierren |
| `pay` | objeto o null | sí | Por hora: horas × tarifa de cada día. Sueldo fijo: proporcional a los días activos. En un periodo cerrado es lo que se congeló al cerrar. null si el periodo se cerró antes de que hubiera sueldos. |

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

<a id="schema-portfoliodailyreport"></a>
#### PortfolioDailyReport

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `company` | objeto | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.name` | texto | sí | — |
| `company.code` | texto | sí | — |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `workDate` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `content` | texto | sí | Texto del reporte en Markdown |
| `revisions` | entero | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |

<a id="schema-portfolioemployee"></a>
#### PortfolioEmployee

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
| `allowCheckIns` | booleano o null | sí | Check-in propio: true o false lo fuerzan; null = hereda el de la empresa. |
| `effectiveAllowCheckIns` | booleano | sí | Si el empleado puede registrar llegadas, ya combinando el suyo con el de la empresa. |
| `allowSelfEdit` | booleano | sí | Si el admin le permite corregir sus propias horas. |
| `selfEditUntil` | fecha AAAA-MM-DD o null | sí | Último día del permiso; null = sin vencimiento. |
| `status` | `active` \| `inactive` | sí | — |
| `mustChangePassword` | booleano | sí | — |
| `lastLoginAt` | fecha y hora ISO 8601 o null | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |
| `company` | objeto | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.name` | texto | sí | — |
| `company.code` | texto | sí | — |

<a id="schema-portfoliolive"></a>
#### PortfolioLive

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `asOf` | fecha y hora ISO 8601 | sí | — |
| `working` | entero | sí | — |
| `entries` | objeto[] | sí | — |
| `entries[].company` | objeto | sí | — |
| `entries[].company.id` | texto (uuid) | sí | — |
| `entries[].company.name` | texto | sí | — |
| `entries[].company.code` | texto | sí | — |
| `entries[].employee` | objeto | sí | — |
| `entries[].employee.id` | texto (uuid) | sí | — |
| `entries[].employee.firstName` | texto | sí | — |
| `entries[].employee.lastName` | texto | sí | — |
| `entries[].employee.employeeCode` | texto o null | sí | — |
| `entries[].timezone` | texto | sí | — |
| `entries[].clockedInAt` | fecha y hora ISO 8601 | sí | — |
| `entries[].elapsedSeconds` | entero | sí | — |
| `entries[].clockInLocation` | objeto o null | sí | Dónde marcó la entrada; null si la registró un admin |
| `entries[].clockInZone` | [ClockZone](#schema-clockzone) o null | sí | Si cayó dentro o fuera de una zona de trabajo; null si no aplica |

<a id="schema-portfoliopayrollrow"></a>
#### PortfolioPayrollRow

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `company` | objeto | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.name` | texto | sí | — |
| `company.code` | texto | sí | — |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `employee.active` | booleano | sí | — |
| `totalHours` | número | sí | — |
| `openEntries` | entero | sí | — |
| `currency` | texto o null | sí | Moneda del pago: la de su empresa (ej. `"USD"`) |
| `pay` | objeto o null | sí | Por hora: horas × tarifa de cada día. Sueldo fijo: proporcional a los días activos. En un periodo cerrado es lo que se congeló al cerrar. null si el periodo se cerró antes de que hubiera sueldos. |

<a id="schema-portfoliosummary"></a>
#### PortfolioSummary

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `asOf` | fecha y hora ISO 8601 | sí | — |
| `period` | objeto | sí | Periodo de pago actual. No avanza hasta que todas las empresas terminaron el anterior |
| `period.start` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `period.end` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `days` | objeto[] | sí | — |
| `days[].date` | fecha AAAA-MM-DD | sí | (ej. `"2026-06-01"`) |
| `days[].weekday` | `monday` \| `tuesday` \| `wednesday` \| `thursday` \| `friday` \| `saturday` \| `sunday` | sí | — |
| `totals` | objeto | sí | — |
| `totals.companies` | entero | sí | Empresas activas incluidas |
| `totals.employees` | objeto | sí | — |
| `totals.employees.active` | entero | sí | — |
| `totals.employees.in` | entero | sí | Trabajando ahora |
| `totals.employees.out` | entero | sí | — |
| `totals.worked` | objeto | sí | Trabajado hoy por todos, incluidas las entradas abiertas |
| `totals.worked.seconds` | entero | sí | — |
| `totals.worked.hours` | número | sí | — |
| `totals.atLimitCount` | entero | sí | — |
| `totals.pendingReports` | objeto | sí | — |
| `totals.pendingReports.employees` | entero | sí | Empleados con reportes pendientes |
| `totals.pendingReports.days` | entero | sí | Reportes pendientes en total |
| `totals.pendingReports.companiesRequiring` | entero | sí | Empresas que exigen reporte diario |
| `totals.periodHours` | número | sí | Horas de todos en el periodo actual |
| `totals.dailyHours` | número[] | sí | Horas de todos por día del periodo, en el orden de `days` |
| `companies` | objeto[] | sí | — |
| `companies[].company` | objeto | sí | — |
| `companies[].company.id` | texto (uuid) | sí | — |
| `companies[].company.name` | texto | sí | — |
| `companies[].company.code` | texto | sí | — |
| `companies[].employees` | objeto | sí | — |
| `companies[].employees.active` | entero | sí | — |
| `companies[].employees.in` | entero | sí | Trabajando ahora |
| `companies[].employees.out` | entero | sí | — |
| `companies[].worked` | objeto | sí | — |
| `companies[].worked.seconds` | entero | sí | — |
| `companies[].worked.hours` | número | sí | — |
| `companies[].atLimitCount` | entero | sí | — |
| `companies[].pendingReports` | objeto | sí | — |
| `companies[].pendingReports.employees` | entero | sí | Empleados con reportes pendientes |
| `companies[].pendingReports.days` | entero | sí | Reportes pendientes en total |
| `companies[].pendingReports.required` | booleano | sí | — |
| `companies[].periodHours` | número | sí | — |

<a id="schema-portfoliotimesheetrow"></a>
#### PortfolioTimesheetRow

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `company` | objeto | sí | — |
| `company.id` | texto (uuid) | sí | — |
| `company.name` | texto | sí | — |
| `company.code` | texto | sí | — |
| `employee` | objeto | sí | — |
| `employee.id` | texto (uuid) | sí | — |
| `employee.firstName` | texto | sí | — |
| `employee.lastName` | texto | sí | — |
| `employee.employeeCode` | texto o null | sí | — |
| `employee.active` | booleano | sí | — |
| `hours` | número[] | sí | Horas decimales de cada día del periodo, en el mismo orden que meta.days |
| `totalHours` | número | sí | — |
| `openEntries` | entero | sí | — |

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

<a id="schema-setpayraterequest"></a>
#### SetPayRateRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `kind` | `hourly` \| `salary` | sí | `hourly`: el monto es lo que se paga por hora. `salary`: sueldo fijo de cada periodo de 14 días. |
| `amountCents` | entero | sí | En centavos de la moneda de la empresa: 1550 = 15.50. (de 0 a 1000000000; ej. `1550`) |
| `effectiveFrom` | fecha AAAA-MM-DD | sí | Día desde el que rige. Para aplicarlo a todo el periodo en curso, manda su primer día. No puede caer en un periodo cerrado. (ej. `"2026-10-19"`) |

<a id="schema-switchcompanyrequest"></a>
#### SwitchCompanyRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `companyId` | texto (uuid) o null | sí | Empresa con la que quieres trabajar. null deja la sesión sin empresa activa, para ver el resumen de todas tus empresas. |

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
| `clockInLocation` | [ClockLocation](#schema-clocklocation) o null | sí | Dónde estaba el empleado al marcar su entrada. null si la registró un admin o es anterior a este dato |
| `clockInZone` | [ClockZone](#schema-clockzone) o null | sí | Si cayó dentro o fuera de una zona de trabajo al marcar. null si la empresa no tenía zonas o no hubo ubicación |
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
| `enforceWorkSites` | booleano | no | true exige que los empleados marquen su entrada dentro de una zona de trabajo. Requiere al menos una zona activa. |
| `allowCheckIns` | booleano | no | true deja que los empleados registren su llegada a un lugar (check-in) sin marcar entrada. No cuenta horas. |
| `selfEditDays` | entero | no | Cuántos días hacia atrás pueden corregir sus horas los empleados con permiso (1 a 31). Nunca dentro de un periodo cerrado. (de 1 a 31; ej. `7`) |
| `currency` | texto | no | Moneda en la que cobran los empleados, con el código ISO 4217 de 3 letras (USD, MXN...). Los periodos ya cerrados conservan la suya. (3 a 3 caracteres; ej. `"USD"`) |
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
| `allowCheckIns` | booleano o null | no | Registro de llegada (check-in) propio de este empleado. `true` lo permite y `false` lo prohíbe aunque la empresa diga lo contrario; `null` = usa el de la empresa. |
| `allowSelfEdit` | booleano | no | Permite que el empleado corrija la hora de entrada o salida de sus marcajes de los últimos días (los que diga la empresa), con motivo. Nunca en un periodo cerrado. |
| `selfEditUntil` | fecha AAAA-MM-DD o null | no | Último día en que puede corregir; `null` = sin vencimiento. (ej. `"2026-11-15"`) |

<a id="schema-updatemultiadminrequest"></a>
#### UpdateMultiAdminRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | no | (1 a 100 caracteres) |
| `lastName` | texto | no | (1 a 100 caracteres) |
| `maxCompanies` | entero | no | Cuántas empresas puede tener asignadas o crear (de 1 a 1000; ej. `3`) |
| `maxEmployeesPerCompany` | entero | no | Máximo de empleados de cada empresa que cree esa persona (de 1 a 100000; ej. `25`) |

<a id="schema-updateprofilerequest"></a>
#### UpdateProfileRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `firstName` | texto | sí | (1 a 100 caracteres) |
| `lastName` | texto | sí | (1 a 100 caracteres) |

<a id="schema-updateworksiterequest"></a>
#### UpdateWorkSiteRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `name` | texto | no | (1 a 100 caracteres; ej. `"Oficina central"`) |
| `latitude` | número | no | (de -90 a 90; ej. `40.7608`) |
| `longitude` | número | no | (de -180 a 180; ej. `-111.891`) |
| `radiusMeters` | entero | no | Radio de la zona en metros (10 a 60000) (de 10 a 60000; ej. `150`) |
| `active` | booleano | no | false desactiva la zona sin borrarla; los marcajes pasados la conservan |

<a id="schema-voidcheckinrequest"></a>
#### VoidCheckInRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Lo registró por error en otro cliente"`) |

<a id="schema-voidtimeentryrequest"></a>
#### VoidTimeEntryRequest

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `reason` | texto | sí | (5 a 500 caracteres; ej. `"Se creó por duplicado"`) |

<a id="schema-worksite"></a>
#### WorkSite

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `id` | texto (uuid) | sí | — |
| `name` | texto | sí | — |
| `latitude` | número | sí | — |
| `longitude` | número | sí | — |
| `radiusMeters` | entero | sí | — |
| `active` | booleano | sí | — |
| `createdAt` | fecha y hora ISO 8601 | sí | — |
| `updatedAt` | fecha y hora ISO 8601 | sí | — |
