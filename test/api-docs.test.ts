import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modules } from '#modules/index.js';
import { buildOpenApiDocument } from '#shared/http/openapi.js';
import {
  OUTPUT_PATH,
  readGuide,
  renderApiDoc,
  type OpenApiSpec,
} from '../scripts/build-api-docs.js';
import { createTestApp } from './helpers/test-app.js';

const { container } = createTestApp();
const routes = modules.flatMap((module) => [...(module.routes?.(container) ?? [])]);
const spec = buildOpenApiDocument(routes) as OpenApiSpec;

// eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del proyecto
const published = readFileSync(OUTPUT_PATH, 'utf8');

describe('API.md', () => {
  it('está actualizado: si cambió una ruta, ejecuta `npm run docs:api`', () => {
    expect(published).toBe(renderApiDoc(spec, readGuide()));
  });

  it('documenta cada ruta de la API', () => {
    expect(routes.length).toBeGreaterThan(40);
    for (const route of routes) {
      expect(published, `${route.method.toUpperCase()} ${route.path}`).toContain(
        `#### \`${route.method.toUpperCase()} ${route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}\``,
      );
    }
  });

  it('todas las rutas tienen resumen y descripción de sus respuestas', () => {
    for (const route of routes) {
      expect(route.summary.length, route.path).toBeGreaterThan(3);
      for (const [status, response] of Object.entries(route.responses)) {
        expect(response.description.length, `${route.path} ${status}`).toBeGreaterThan(2);
      }
    }
  });

  it('cada código de error que una ruta anuncia existe de verdad en el código', () => {
    const sources = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => !file.endsWith('.routes.ts') && !file.includes('generated'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- recorre el codigo del proyecto
      .map((file) => readFileSync(join('src', file), 'utf8'))
      .join('\n');

    const declared = routes.flatMap((route) =>
      Object.values(route.responses).flatMap((response) => response.errorCodes ?? []),
    );
    expect(declared.length).toBeGreaterThan(50);
    for (const code of new Set(declared)) {
      expect(sources, `el código ${code} está documentado pero nada lo lanza`).toContain(
        `'${code}'`,
      );
    }
  });

  it('no deja marcas sin reemplazar', () => {
    expect(published).not.toContain('{{REFERENCE}}');
  });
});
