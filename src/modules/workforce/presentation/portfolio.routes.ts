import { Permission } from '#shared/domain/permissions.js';
import { defineRoute, paginated, type AnyRoute } from '#shared/http/route.js';
import { pageResponse, paginationQuery, uuidSchema } from '#shared/http/schemas.js';
import { z } from '#shared/http/zod.js';
import type { ListPortfolioEmployeesUseCase } from '../application/list-portfolio-employees.use-case.js';
import type { PortfolioEmployeeView } from '../application/ports/portfolio-employee.reader.js';
import { employeeSchema, toEmployeeDto } from './workforce.schemas.js';

interface Deps {
  listPortfolioEmployees: ListPortfolioEmployeesUseCase;
}

const TAGS = ['Admin multiempresa · Todas mis empresas'];

const portfolioEmployeesQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: 'Busca en nombre, apellido, email o código' }),
  status: z.enum(['active', 'inactive']).optional(),
  companyId: uuidSchema.optional().openapi({
    description: 'Solo una de tus empresas. Una que no es tuya responde 404',
  }),
});

const portfolioEmployeeSchema = employeeSchema
  .extend({ company: z.object({ id: z.uuid(), name: z.string(), code: z.string() }) })
  .openapi('PortfolioEmployee');

function toPortfolioEmployeeDto(employee: PortfolioEmployeeView) {
  return { ...toEmployeeDto(employee), company: employee.company };
}

export function portfolioEmployeeRoutes(deps: Deps): AnyRoute[] {
  return [
    defineRoute({
      method: 'get',
      path: '/portfolio/employees',
      summary: 'Empleados de todas mis empresas',
      description:
        'Por empresa, apellido y nombre, con la empresa de cada empleado. Solo cuenta las ' +
        'empresas activas. Solo lectura: para cambiar algo hay que elegir la empresa.',
      tags: TAGS,
      auth: Permission.PORTFOLIO_READ,
      rateLimit: 'heavyRead',
      request: { query: portfolioEmployeesQuery },
      responses: {
        200: { description: 'Empleados', schema: pageResponse(portfolioEmployeeSchema) },
        404: {
          description: 'La empresa no existe o no es tuya',
          errorCodes: ['COMPANY_NOT_FOUND'],
        },
      },
      handler: async ({ actor, query }) => {
        const { page, limit, ...filter } = query;
        const result = await deps.listPortfolioEmployees.execute({
          actor,
          filter,
          page: { page, limit },
        });
        return paginated(result.items.map(toPortfolioEmployeeDto), result);
      },
    }),
  ];
}
