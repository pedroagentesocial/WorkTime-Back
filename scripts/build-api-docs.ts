import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Role, permissionsOf } from '#shared/domain/permissions.js';

// Genera API.md con la guia de docs/api-guide.md mas la referencia de cada endpoint
// Se ejecuta con: npm run docs:api

export const REFERENCE_PLACEHOLDER = '{{REFERENCE}}';

interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  example?: unknown;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
}

interface Response {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
}

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  'x-permission'?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses: Record<string, Response>;
}

export interface OpenApiSpec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

const API_PREFIX = '/api/v1';
const GLOBAL_ERROR_CODES = new Set([
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
]);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const ROLE_NAMES: Record<string, string> = {
  platform_admin: 'admin global',
  company_admin: 'admin de empresa',
  employee: 'empleado',
};

const escapeCell = (text: string): string =>
  text
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const refName = (ref: string): string => ref.split('/').pop() ?? ref;
const schemaAnchor = (name: string): string => `schema-${slug(name)}`;
const operationAnchor = (method: string, path: string): string => `op-${slug(`${method} ${path}`)}`;

function resolve(spec: OpenApiSpec, schema: Schema): Schema {
  if (schema.$ref) {
    const target = spec.components.schemas[refName(schema.$ref)];
    return target ? resolve(spec, target) : schema;
  }
  if (schema.allOf) {
    const parts = schema.allOf.map((part) => resolve(spec, part));
    return {
      ...schema,
      properties: Object.assign({}, ...parts.map((part) => part.properties ?? {})) as Record<
        string,
        Schema
      >,
      required: parts.flatMap((part) => part.required ?? []),
    };
  }
  return schema;
}

interface TypeInfo {
  text: string;
  nullable: boolean;
}

const isNullType = (schema: Schema): boolean =>
  schema.type === 'null' ||
  (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null');

function typeOf(spec: OpenApiSpec, schema: Schema): TypeInfo {
  if (schema.$ref) {
    const name = refName(schema.$ref);
    return { text: `[${name}](#${schemaAnchor(name)})`, nullable: false };
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    const parts = union.filter((part) => !isNullType(part));
    const nullable = parts.length !== union.length;
    const infos = parts.map((part) => typeOf(spec, part));
    return {
      text: infos.map((info) => info.text).join(' \\| '),
      nullable: nullable || infos.some((info) => info.nullable),
    };
  }
  if (schema.allOf) {
    const infos = schema.allOf.map((part) => typeOf(spec, part));
    return { text: infos.map((info) => info.text).join(' + '), nullable: false };
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nullable = types.includes('null');
  const main = types.find((type) => type !== 'null');

  if (schema.enum) {
    const values = schema.enum
      .filter((value) => value !== null)
      .map((value) => (typeof value === 'string' ? `\`${value}\`` : JSON.stringify(value)));
    return { text: values.join(' \\| '), nullable: nullable || schema.enum.includes(null) };
  }
  if (schema.const !== undefined) return { text: `\`${JSON.stringify(schema.const)}\``, nullable };

  switch (main) {
    case 'array': {
      const item = schema.items ? typeOf(spec, schema.items) : { text: 'any', nullable: false };
      const wrapped = item.text.includes('\\|') ? `(${item.text})` : item.text;
      return { text: `${wrapped}[]`, nullable };
    }
    case 'object':
      return { text: 'objeto', nullable };
    case 'string':
      return { text: stringType(schema.format), nullable };
    case 'integer':
      return { text: 'entero', nullable };
    case 'number':
      return { text: 'número', nullable };
    case 'boolean':
      return { text: 'booleano', nullable };
    default:
      return { text: main ?? 'cualquiera', nullable };
  }
}

function stringType(format: string | undefined): string {
  switch (format) {
    case 'uuid':
      return 'texto (uuid)';
    case 'date-time':
      return 'fecha y hora ISO 8601';
    case 'date':
      return 'fecha AAAA-MM-DD';
    case 'email':
      return 'texto (email)';
    default:
      return 'texto';
  }
}

function constraintsOf(schema: Schema): string[] {
  const notes: string[] = [];
  if (schema.minLength !== undefined || schema.maxLength !== undefined) {
    notes.push(`${String(schema.minLength ?? 0)} a ${String(schema.maxLength ?? '∞')} caracteres`);
  }
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    notes.push(`de ${String(schema.minimum ?? '−∞')} a ${String(schema.maximum ?? '∞')}`);
  }
  if (schema.default !== undefined) notes.push(`por defecto \`${JSON.stringify(schema.default)}\``);
  return notes;
}

interface Row {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function flatten(spec: OpenApiSpec, schema: Schema, prefix = '', depth = 0): Row[] {
  const resolved = resolve(spec, schema);
  const required = new Set(resolved.required ?? []);
  const rows: Row[] = [];

  for (const [key, property] of Object.entries(resolved.properties ?? {})) {
    const info = typeOf(spec, property);
    const target = property.$ref ? undefined : property;
    const notes = [
      ...(target ? constraintsOf(target) : []),
      ...(target?.example !== undefined ? [`ej. \`${JSON.stringify(target.example)}\``] : []),
    ];
    const description = [
      target?.description,
      notes.length > 0 ? `(${notes.join('; ')})` : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    rows.push({
      name: `${prefix}${key}`,
      type: info.nullable ? `${info.text} o null` : info.text,
      required: required.has(key),
      description: escapeCell(description),
    });

    if (depth < 3 && target) {
      const inner =
        target.type === 'array' && target.items && !target.items.$ref ? target.items : target;
      const marker = target.type === 'array' ? `${prefix}${key}[].` : `${prefix}${key}.`;
      if (inner.properties) rows.push(...flatten(spec, inner, marker, depth + 1));
    }
  }
  return rows;
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  return [head, ...rows.map((cells) => `| ${cells.join(' | ')} |`)].join('\n');
}

function fieldsTable(rows: Row[], withRequired: boolean): string {
  return table(
    withRequired
      ? ['Campo', 'Tipo', 'Obligatorio', 'Descripción']
      : ['Campo', 'Tipo', 'Descripción'],
    rows.map((row) =>
      withRequired
        ? [`\`${row.name}\``, row.type, row.required ? 'sí' : 'no', row.description || '—']
        : [`\`${row.name}\``, row.type, row.description || '—'],
    ),
  );
}

const jsonSchemaOf = (response: Response | undefined): Schema | undefined =>
  response?.content?.['application/json']?.schema;

function describeAccess(operation: Operation): string {
  if (!operation.security || operation.security.length === 0)
    return '**Acceso:** público (no lleva token).';
  const permission = operation['x-permission'];
  if (!permission) return '**Acceso:** cualquier usuario autenticado.';
  const roles = Object.values(Role)
    .filter((role) => permissionsOf(role).includes(permission as never))
    .map((role) => ROLE_NAMES[role] ?? role);
  return `**Acceso:** permiso \`${permission}\` (${roles.join(', ')}).`;
}

function renderSuccess(spec: OpenApiSpec, status: string, response: Response): string[] {
  const lines = [`**Respuesta ${status}:** ${response.description ?? ''}`.trim()];
  const csv = response.content?.['text/csv'];
  if (csv) {
    lines.push('', 'Devuelve un archivo CSV (`text/csv`), no JSON.');
    return lines;
  }
  const schema = jsonSchemaOf(response);
  if (!schema?.properties) return lines;

  const data = schema.properties.data;
  const meta = schema.properties.meta;
  if (data) {
    const info = typeOf(spec, data);
    lines.push('', `- \`data\`: ${info.text}${info.nullable ? ' o null' : ''}`);
    const inline = data.type === 'array' && data.items && !data.items.$ref ? data.items : data;
    if (!data.$ref && inline.properties) lines.push('', fieldsTable(flatten(spec, inline), false));
  }
  if (meta) {
    lines.push(
      '',
      '- `meta` (datos adicionales de la respuesta):',
      '',
      fieldsTable(flatten(spec, meta), false),
    );
  }
  return lines;
}

function renderErrors(responses: Record<string, Response>): string[] {
  const rows: string[][] = [];
  for (const [status, response] of Object.entries(responses)) {
    if (Number(status) < 400) continue;
    const codes = (jsonSchemaOf(response)?.properties?.error?.properties?.code?.enum ?? [])
      .map(String)
      .filter((code) => !GLOBAL_ERROR_CODES.has(code));
    if (codes.length === 0) continue;
    const description = (response.description ?? '').split(' — ')[0] ?? '';
    rows.push([status, codes.map((code) => `\`${code}\``).join(' · '), escapeCell(description)]);
  }
  return rows.length > 0
    ? ['**Errores:**', '', table(['HTTP', 'Códigos `error.code`', 'Cuándo'], rows)]
    : [];
}

function renderOperation(
  spec: OpenApiSpec,
  method: string,
  path: string,
  operation: Operation,
): string {
  const displayPath = path.slice(API_PREFIX.length);
  const lines: string[] = [
    `<a id="${operationAnchor(method, displayPath)}"></a>`,
    `#### \`${method.toUpperCase()} ${displayPath}\``,
    '',
    `**${operation.summary ?? ''}**`,
    '',
    describeAccess(operation),
  ];
  if (operation.description) lines.push('', operation.description);

  const parameters = operation.parameters ?? [];
  const pathParams = parameters.filter((parameter) => parameter.in === 'path');
  const queryParams = parameters.filter((parameter) => parameter.in === 'query');
  const parameterRows = (list: Parameter[]): string[][] =>
    list.map((parameter) => {
      const schema = parameter.schema ?? {};
      const info = typeOf(spec, schema);
      const notes = constraintsOf(schema);
      const description = [
        parameter.description ?? schema.description,
        notes.length > 0 ? `(${notes.join('; ')})` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return [
        `\`${parameter.name}\``,
        info.text,
        parameter.required ? 'sí' : 'no',
        escapeCell(description) || '—',
      ];
    });

  if (pathParams.length > 0) {
    lines.push(
      '',
      '**Parámetros de la ruta:**',
      '',
      table(['Nombre', 'Tipo', 'Obligatorio', 'Descripción'], parameterRows(pathParams)),
    );
  }
  if (queryParams.length > 0) {
    lines.push(
      '',
      '**Parámetros de la URL (query):**',
      '',
      table(['Nombre', 'Tipo', 'Obligatorio', 'Descripción'], parameterRows(queryParams)),
    );
  }

  const body = operation.requestBody?.content?.['application/json']?.schema;
  if (body) {
    const rows = flatten(spec, body);
    lines.push('', '**Cuerpo (JSON):**', '');
    lines.push(rows.length > 0 ? fieldsTable(rows, true) : 'Sin campos.');
  }

  for (const [status, response] of Object.entries(operation.responses)) {
    if (Number(status) < 400) lines.push('', ...renderSuccess(spec, status, response));
  }
  const errors = renderErrors(operation.responses);
  if (errors.length > 0) lines.push('', ...errors);
  return lines.join('\n');
}

function renderIndex(spec: OpenApiSpec): {
  tags: string[];
  byTag: Map<string, [string, string, Operation][]>;
} {
  const byTag = new Map<string, [string, string, Operation][]>();
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = operations[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'Otros';
      byTag.set(tag, [...(byTag.get(tag) ?? []), [method, path, operation]]);
    }
  }
  return { tags: [...byTag.keys()], byTag };
}

function renderErrorCatalog(spec: OpenApiSpec): string {
  const catalog = new Map<string, { statuses: Set<string>; endpoints: Set<string> }>();
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = operations[method];
      if (!operation) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;
        for (const code of jsonSchemaOf(response)?.properties?.error?.properties?.code?.enum ??
          []) {
          if (GLOBAL_ERROR_CODES.has(String(code))) continue;
          const entry = catalog.get(String(code)) ?? {
            statuses: new Set<string>(),
            endpoints: new Set<string>(),
          };
          entry.statuses.add(status);
          entry.endpoints.add(`${method.toUpperCase()} ${path.slice(API_PREFIX.length)}`);
          catalog.set(String(code), entry);
        }
      }
    }
  }
  const rows = [...catalog.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => {
      const endpoints = [...entry.endpoints];
      const where =
        endpoints.length <= 3
          ? endpoints.map((e) => `\`${e}\``).join(', ')
          : `${String(endpoints.length)} endpoints`;
      return [`\`${code}\``, [...entry.statuses].sort().join(', '), where];
    });
  return table(['Código', 'HTTP', 'Dónde puede aparecer'], rows);
}

function renderSchemas(spec: OpenApiSpec): string {
  const names = Object.keys(spec.components.schemas).sort((a, b) => a.localeCompare(b));
  return names
    .map((name) => {
      const schema = spec.components.schemas[name] ?? {};
      const lines = [`<a id="${schemaAnchor(name)}"></a>`, `#### ${name}`, ''];
      const rows = flatten(spec, schema);
      if (rows.length > 0) lines.push(fieldsTable(rows, true));
      else lines.push(`Tipo: ${typeOf(spec, schema).text}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function renderReference(spec: OpenApiSpec): string {
  const { tags, byTag } = renderIndex(spec);
  const out: string[] = [];

  out.push('### Índice de endpoints', '');
  for (const tag of tags) {
    out.push(`**${tag}**`, '');
    for (const [method, path, operation] of byTag.get(tag) ?? []) {
      const display = path.slice(API_PREFIX.length);
      out.push(
        `- [\`${method.toUpperCase()} ${display}\`](#${operationAnchor(method, display)}) — ${operation.summary ?? ''}`,
      );
    }
    out.push('');
  }

  out.push('### Detalle de cada endpoint', '');
  for (const tag of tags) {
    out.push(`### ${tag}`, '');
    for (const [method, path, operation] of byTag.get(tag) ?? []) {
      out.push(renderOperation(spec, method, path, operation), '');
    }
  }

  out.push(
    '### Catálogo de códigos de error',
    '',
    renderErrorCatalog(spec),
    '',
    'Además, **cualquier** endpoint puede responder `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `TOO_MANY_REQUESTS` (429) e `INTERNAL_ERROR` (500).',
    '',
  );
  out.push('### Objetos que devuelve la API', '', renderSchemas(spec), '');
  return out.join('\n');
}

const HEADER = [
  '<!-- Archivo generado. No lo edites a mano: cambia docs/api-guide.md y ejecuta `npm run docs:api`. -->',
  '',
].join('\n');

export function renderApiDoc(spec: OpenApiSpec, guide: string): string {
  if (!guide.includes(REFERENCE_PLACEHOLDER)) {
    throw new Error(`docs/api-guide.md debe contener ${REFERENCE_PLACEHOLDER}`);
  }
  return HEADER + guide.replace(REFERENCE_PLACEHOLDER, renderReference(spec).trimEnd());
}

export const GUIDE_PATH = fileURLToPath(new URL('../docs/api-guide.md', import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL('../API.md', import.meta.url));

export function readGuide(): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del proyecto
  return readFileSync(GUIDE_PATH, 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadEnv } = await import('#config/env.js');
  const { bootstrap } = await import('../src/bootstrap.js');
  const { modules } = await import('#modules/index.js');
  const { buildOpenApiDocument } = await import('#shared/http/openapi.js');

  const { container } = bootstrap(loadEnv(), modules);
  const routes = modules.flatMap((module) => [...(module.routes?.(container) ?? [])]);
  const spec = buildOpenApiDocument(routes) as OpenApiSpec;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del proyecto
  writeFileSync(OUTPUT_PATH, renderApiDoc(spec, readGuide()));
  await container.dispose();
  console.log(`Documentación escrita en ${OUTPUT_PATH}`);
}
