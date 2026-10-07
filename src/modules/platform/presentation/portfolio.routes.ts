import { Permission } from '#shared/domain/permissions.js';
import { created, defineRoute, ok, type AnyRoute } from '#shared/http/route.js';
import { dataResponse } from '#shared/http/schemas.js';
import type { CreateOwnCompanyUseCase } from '../application/create-own-company.use-case.js';
import type { ListMyCompaniesUseCase } from '../application/list-my-companies.use-case.js';
import { createOwnCompanyBody, myCompaniesSchema, toMyCompaniesDto } from './portfolio.schemas.js';
import { createCompanyResponse, toCompanyDto } from './platform.schemas.js';

interface Deps {
  listMyCompanies: ListMyCompaniesUseCase;
  createOwnCompany: CreateOwnCompanyUseCase;
}

const TAGS = ['Admin multiempresa · Mis empresas'];

// Rutas del admin multiempresa sobre el conjunto de sus empresas, sin empresa activa
export function portfolioRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/portfolio/companies',
      summary: 'Mis empresas y lo que me queda de mi paquete',
      description:
        'Las empresas a las que tiene acceso, por nombre, con su máximo de empresas y el de ' +
        'empleados por empresa que cree. Sirve para el selector de empresa.',
      tags: TAGS,
      auth: Permission.PORTFOLIO_READ,
      responses: { 200: { description: 'Mis empresas', schema: dataResponse(myCompaniesSchema) } },
      handler: async ({ actor }) => ok(toMyCompaniesDto(await deps.listMyCompanies.execute(actor))),
    }),

    defineRoute({
      method: 'post',
      path: '/portfolio/companies',
      summary: 'Crear una empresa dentro de mi paquete',
      description:
        'Crea la empresa con su admin y me la asigna. Su máximo de empleados es el que fijó el ' +
        'admin global para mi paquete. Devuelve la contraseña temporal del admin una sola vez.',
      tags: TAGS,
      auth: Permission.PORTFOLIO_COMPANIES_CREATE,
      rateLimit: 'sensitive',
      request: { body: createOwnCompanyBody },
      responses: {
        201: { description: 'Empresa creada', schema: dataResponse(createCompanyResponse) },
        400: {
          description: 'Datos inválidos',
          errorCodes: ['INVALID_TIMEZONE', 'INVALID_COMPANY_NAME'],
        },
        409: {
          description: 'Llegó a su máximo de empresas o el email ya está registrado',
          errorCodes: ['MAX_COMPANIES_REACHED', 'EMAIL_TAKEN'],
        },
      },
      handler: async ({ actor, body, request }) => {
        const result = await deps.createOwnCompany.execute({ actor, client: request, ...body });
        return created({
          company: toCompanyDto(result.company),
          temporaryPassword: result.temporaryPassword,
          temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt.toISOString(),
        });
      },
    }),
  ];
}
