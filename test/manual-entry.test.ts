import type { Express } from 'express';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '#shared/domain/permissions.js';
import type { FakeClock } from './helpers/fake-clock.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { createCompany, createEmployee, createUser, DEFAULT_PASSWORD } from './helpers/fixtures.js';
import { api, bearer, createTestApp, login } from './helpers/test-app.js';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

const NOW = '2026-10-07T18:00:00Z';

function setTime(clock: FakeClock, iso: string) {
  clock.advance(new Date(iso).getTime() - clock.now().getTime());
}

async function setup() {
  const { app, clock } = createTestApp();
  setTime(clock, NOW);
  const company = await createCompany(prisma);
  const admin = await createUser(prisma, { role: Role.COMPANY_ADMIN, companyId: company.id });
  const { user, employee } = await createEmployee(prisma, company.id);
  const asAdmin = bearer((await login(app, admin.email, DEFAULT_PASSWORD)).accessToken);
  const asEmployee = bearer((await login(app, user.email, DEFAULT_PASSWORD)).accessToken);
  return { app, clock, company, admin, employee, user, asAdmin, asEmployee };
}

const manual = (app: Express, auth: Record<string, string>, employeeId: string, body: object) =>
  request(app)
    .post(api(`/company/employees/${employeeId}/time-entries`))
    .set(auth)
    .send(body);

const valid = {
  clockInAt: '2026-10-06T08:00:00-06:00',
  clockOutAt: '2026-10-06T16:30:00-06:00',
  reason: 'Olvidó marcar; confirmado con su supervisor',
};

describe('POST /company/employees/{id}/time-entries', () => {
  it('crea un registro cerrado, de origen admin, que suma en la hoja del empleado', async () => {
    const { app, employee, asAdmin, asEmployee } = await setup();

    const res = await manual(app, asAdmin, employee.id, valid);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'closed',
      source: 'admin',
      closedBy: 'admin',
      workDate: '2026-10-06',
      durationHours: 8.5,
      timezone: 'America/Denver',
      employee: { id: employee.id },
    });

    const sheet = await request(app).get(api('/me/timesheet')).set(asEmployee);
    expect(sheet.body.data.totalHours).toBe(8.5);
    const days = sheet.body.data.days as { date: string; hours: number }[];
    expect(days.find((d) => d.date === '2026-10-06')?.hours).toBe(8.5);
  });

  it('queda auditado con quién lo creó y el motivo', async () => {
    const { app, employee, admin, asAdmin } = await setup();
    const res = await manual(app, asAdmin, employee.id, valid);

    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { type: 'time_entry.created_by_admin' },
    });
    expect(event.userId).toBe(admin.id);
    expect(event.metadata).toMatchObject({
      employeeId: employee.id,
      timeEntryId: res.body.data.id,
      reason: valid.reason,
    });
  });

  it('acepta registros pegados uno con otro y rechaza los que se cruzan', async () => {
    const { app, employee, asAdmin } = await setup();
    await manual(app, asAdmin, employee.id, valid);

    const adjacent = await manual(app, asAdmin, employee.id, {
      ...valid,
      clockInAt: '2026-10-06T16:30:00-06:00',
      clockOutAt: '2026-10-06T18:00:00-06:00',
    });
    expect(adjacent.status).toBe(201);

    const overlapping = await manual(app, asAdmin, employee.id, {
      ...valid,
      clockInAt: '2026-10-06T15:00:00-06:00',
      clockOutAt: '2026-10-06T17:00:00-06:00',
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('TIME_ENTRY_OVERLAP');
  });

  it('rechaza un registro que se cruza con una entrada abierta', async () => {
    const { app, company, employee, asAdmin } = await setup();
    await prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        companyId: company.id,
        employeeId: employee.id,
        clockInAt: new Date('2026-10-07T08:00:00-06:00'),
        timezone: 'America/Denver',
        workDate: new Date('2026-10-07T00:00:00.000Z'),
        source: 'web',
      },
    });

    const res = await manual(app, asAdmin, employee.id, {
      ...valid,
      clockInAt: '2026-10-07T09:00:00-06:00',
      clockOutAt: '2026-10-07T10:00:00-06:00',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_ENTRY_OVERLAP');
  });

  it('rechaza horas futuras, rangos invertidos y fechas de más de 14 días', async () => {
    const { app, employee, asAdmin } = await setup();
    const cases: [object, string][] = [
      [
        { clockInAt: '2026-10-07T11:00:00-06:00', clockOutAt: '2026-10-07T13:00:00-06:00' },
        'TIME_IN_FUTURE',
      ],
      [
        { clockInAt: '2026-10-06T16:00:00-06:00', clockOutAt: '2026-10-06T08:00:00-06:00' },
        'INVALID_TIME_RANGE',
      ],
      [
        { clockInAt: '2026-10-06T08:00:00-06:00', clockOutAt: '2026-10-06T08:00:00-06:00' },
        'INVALID_TIME_RANGE',
      ],
      [
        { clockInAt: '2026-09-22T08:00:00-06:00', clockOutAt: '2026-09-22T16:00:00-06:00' },
        'MANUAL_ENTRY_TOO_OLD',
      ],
    ];
    for (const [times, code] of cases) {
      const res = await manual(app, asAdmin, employee.id, { ...valid, ...times });
      expect(res.status, code).toBe(400);
      expect(res.body.error.code).toBe(code);
    }

    const edge = await manual(app, asAdmin, employee.id, {
      ...valid,
      clockInAt: '2026-09-23T08:00:00-06:00',
      clockOutAt: '2026-09-23T16:00:00-06:00',
    });
    expect(edge.status).toBe(201);
  });

  it('valida el motivo y no acepta campos extra ni horas sin desfase', async () => {
    const { app, employee, asAdmin } = await setup();
    const bad: object[] = [
      { ...valid, reason: 'no' },
      { ...valid, reason: undefined },
      { ...valid, clockInAt: undefined },
      { ...valid, clockOutAt: '2026-10-06T16:30:00' },
      { ...valid, source: 'web' },
    ];
    for (const body of bad) {
      expect((await manual(app, asAdmin, employee.id, body)).status).toBe(400);
    }
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it('funciona con un empleado desactivado', async () => {
    const { app, employee, user, asAdmin } = await setup();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'inactive' } });
    expect((await manual(app, asAdmin, employee.id, valid)).status).toBe(201);
  });

  it('un empleado inexistente o de otra empresa responde 404', async () => {
    const { app, asAdmin } = await setup();
    const other = await createCompany(prisma, { name: 'Otra' });
    const { employee: foreign } = await createEmployee(prisma, other.id);

    const res = await manual(app, asAdmin, foreign.id, valid);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it('el empleado no puede crear registros', async () => {
    const { app, employee, asEmployee } = await setup();
    const res = await manual(app, asEmployee, employee.id, valid);
    expect(res.status).toBe(403);
  });
});
