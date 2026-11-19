const test = require('node:test');
const assert = require('node:assert/strict');
const { getFirestore } = require('firebase-admin/firestore');
const { updateNewYearEvent } = require('../index');
const { createNewYearEvent } = require('../new-year');

const db = getFirestore();
const eventPath = 'companies/hrc/newYearEvents/new-year-2026';

function setup(t) {
  const records = new Map([
    ['users/admin', { companyId: 'hrc', role: 'admin', displayName: 'Admin' }],
    ['users/operator', { companyId: 'hrc', role: 'user', displayName: 'Equipo' }],
    ['users/bot', { companyId: 'hrc', role: 'bot', displayName: 'Bot' }],
    ['users/other', { companyId: 'other-company', role: 'user', displayName: 'Otro equipo' }]
  ]);
  const snapshot = (path) => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const reference = (path) => ({
    path,
    doc: (id) => reference(`${path}/${id}`),
    collection: (id) => reference(`${path}/${id}`),
    get: async () => snapshot(path)
  });
  let queue = Promise.resolve();
  t.mock.method(db, 'collection', (path) => reference(path));
  t.mock.method(db, 'runTransaction', (handler) => {
    const operation = queue.then(async () => {
      const writes = [];
      const result = await handler({
        get: async (ref) => snapshot(ref.path),
        set: (ref, data) => writes.push([ref.path, structuredClone(data)])
      });
      writes.forEach(([path, data]) => records.set(path, data));
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  });
  const call = (data, uid = 'admin') => updateNewYearEvent.run({ auth: uid ? { uid } : null, data });
  return { records, call };
}

function createPayload(id, overrides = {}) {
  return {
    action: 'saveBooking', bookingId: id, requestId: `request-${id}`, expectedVersion: 0,
    fields: {
      name: 'Cliente', adults: 2, children: 0, status: 'paid', paymentCurrency: 'USD',
      contact: '', veggieCount: 0, drinksA: 0, drinksB: 0, allergies: '', notes: '', ...overrides
    }
  };
}

test('la callable requiere autenticación y un rol humano del equipo', async (t) => {
  const { call, records } = setup(t);
  await assert.rejects(call(createPayload('one'), null), { code: 'unauthenticated' });
  await assert.rejects(call(createPayload('one'), 'bot'), { code: 'permission-denied' });
  assert.equal(records.has(eventPath), false);
});

test('la empresa se obtiene del perfil autenticado y descarta una empresa enviada por el cliente', async (t) => {
  const { call, records } = setup(t);
  await call({ ...createPayload('one'), companyId: 'hrc' }, 'other');
  assert.equal(records.has(eventPath), false);
  assert.equal(records.has('companies/other-company/newYearEvents/new-year-2026/bookings/one'), true);
});

test('reintentar una misma solicitud no duplica la reserva ni el contador', async (t) => {
  const { call, records } = setup(t);
  const payload = createPayload('one');
  const first = await call(payload);
  const repeated = await call(payload);
  assert.equal(first.bookingVersion, 1);
  assert.equal(repeated.bookingVersion, 1);
  assert.equal(records.get(eventPath).paidPeople, 2);
  assert.equal(records.get(eventPath).revision, 1);
});

test('una edición con versión anterior se rechaza sin cambios parciales', async (t) => {
  const { call, records } = setup(t);
  await call(createPayload('one'));
  const before = structuredClone(records.get(eventPath));
  await assert.rejects(call({ action: 'assign', requestId: 'assign-stale', bookingId: 'one', expectedVersion: 0, tableId: 11, count: 2 }), { code: 'failed-precondition' });
  assert.deepEqual(records.get(eventPath), before);
  assert.deepEqual(records.get(`${eventPath}/bookings/one`).placements, []);
});

test('confirmaciones concurrentes vuelven a verificar el cupo dentro de la transacción', async (t) => {
  const { call, records } = setup(t);
  records.set(eventPath, { ...createNewYearEvent('hrc'), capacity: 3 });
  const results = await Promise.allSettled([call(createPayload('one')), call(createPayload('two'))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'resource-exhausted');
  assert.equal(records.get(eventPath).paidPeople, 2);
  assert.equal([...records.keys()].filter((path) => path.startsWith(`${eventPath}/bookings/`)).length, 1);
});

test('la configuración rechaza revisiones anteriores y el equipo no modifica el cupo administrativo', async (t) => {
  const { call } = setup(t);
  await call(createPayload('one'));
  await assert.rejects(call({ action: 'combine', requestId: 'combine-stale', expectedRevision: 0, tableIds: [51, 52] }), { code: 'failed-precondition' });
  await assert.rejects(call({ action: 'setCapacity', requestId: 'capacity-user', expectedRevision: 1, capacity: 10 }, 'operator'), { code: 'permission-denied' });
});

test('la callable vence exactamente el 2 de enero a las 00:00 de Ushuaia', async (t) => {
  const { call, records } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-02T03:00:00Z') });
  await assert.rejects(call(createPayload('one')), { code: 'failed-precondition' });
  assert.equal(records.has(eventPath), false);
});
