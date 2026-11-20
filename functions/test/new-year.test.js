const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TABLE_IDS,
  MAX_CAPACITY,
  createNewYearEvent,
  changeNewYearBooking,
  changeNewYearConfiguration
} = require('../new-year');

const actor = { uid: 'operator-1', name: 'Operador', role: 'admin' };
const now = new Date('2026-11-18T20:00:00Z');

function fields(overrides = {}) {
  return {
    name: 'Cliente de prueba', contact: 'cliente@example.com', adults: 2, children: 0, status: 'pending',
    paymentAmount: null, paymentCurrency: 'USD', allergies: '', notes: '', ...overrides
  };
}

function save(event, previous, overrides = {}, extra = {}) {
  return changeNewYearBooking(event, previous, 'saveBooking', { fields: fields(overrides), ...extra }, actor, now);
}

test('el plano contiene 44 mesas de cuatro lugares con las cuatro filas corregidas', () => {
  assert.equal(MAX_CAPACITY, 176);
  assert.deepEqual(TABLE_IDS.filter((id) => id >= 40 && id < 50), [40, 41, 42, 43, 44, 45]);
  for (const row of [10, 20, 30]) {
    assert.deepEqual(TABLE_IDS.filter((id) => id >= row && id < row + 10), Array.from({ length: 7 }, (_, index) => row + index));
  }
});

test('los pendientes se registran sin descontar cupo y confirmar el pago actualiza ambos contadores', () => {
  const pending = save(createNewYearEvent('hrc'), null);
  assert.equal(pending.event.pendingPeople, 2);
  assert.equal(pending.event.paidPeople, 0);
  assert.deepEqual(pending.booking.placements, []);
  const paid = changeNewYearBooking(pending.event, pending.booking, 'setStatus', { status: 'paid' }, actor, now);
  assert.equal(paid.event.pendingPeople, 0);
  assert.equal(paid.event.paidPeople, 2);
  assert.equal(paid.booking.paymentVerifiedBy, actor.uid);
});

test('el cupo se verifica sobre el estado actual del evento', () => {
  const event = { ...createNewYearEvent('hrc'), capacity: 3 };
  const first = save(event, null, { status: 'paid' });
  assert.throws(() => save(first.event, null, { status: 'paid' }), /supera el tope/);
  assert.equal(first.event.paidPeople, 2);
});

test('una reserva pendiente no puede recibir lugares ni marcar llegada', () => {
  const pending = save(createNewYearEvent('hrc'), null);
  assert.throws(() => changeNewYearBooking(pending.event, pending.booking, 'assign', { tableId: 11, count: 1 }, actor, now), /Verificá el pago/);
  assert.throws(() => changeNewYearBooking(pending.event, pending.booking, 'checkIn', { arrived: true }, actor, now), /pago verificado/);
});

test('distintos grupos pueden compartir una mesa hasta cuatro personas', () => {
  const first = save(createNewYearEvent('hrc'), null, { status: 'paid' }, { tableId: 11 });
  const second = save(first.event, null, { name: 'Otro cliente', status: 'paid' }, { tableId: 11 });
  assert.equal(second.event.tableOccupancy[11], 4);
  assert.throws(() => save(second.event, null, { adults: 1, status: 'paid' }, { tableId: 11 }), /suficientes lugares/);
});

test('combinar 51 y 52 permite ocho lugares y descombinar conserva los asientos y pagos', () => {
  const combined = changeNewYearConfiguration(createNewYearEvent('hrc'), 'combine', { tableIds: [51, 52] }, actor);
  const saved = save(combined, null, { adults: 6, status: 'paid' }, { tableId: 52 });
  assert.deepEqual(saved.booking.placements, [{ tableId: 51, count: 4 }, { tableId: 52, count: 2 }]);
  const separated = changeNewYearConfiguration(saved.event, 'uncombine', { tableId: 52 }, actor);
  assert.deepEqual(separated.merges, []);
  assert.equal(separated.tableOccupancy[51], 4);
  assert.equal(separated.tableOccupancy[52], 2);
  assert.equal(separated.paidPeople, 6);
});

test('los grupos combinables respetan los sectores 50, 60 y 11/21/31/41', () => {
  for (const ids of [[60, 61], [11, 21, 31, 41]]) {
    const event = changeNewYearConfiguration(createNewYearEvent('hrc'), 'combine', { tableIds: ids }, actor);
    assert.deepEqual(event.merges, [ids]);
  }
  for (const ids of [[51, 61], [41, 42], [70, 71], [51, 51]]) {
    assert.throws(() => changeNewYearConfiguration(createNewYearEvent('hrc'), 'combine', { tableIds: ids }, actor));
  }
});

test('extender una combinación conserva el grupo existente completo', () => {
  const first = changeNewYearConfiguration(createNewYearEvent('hrc'), 'combine', { tableIds: [51, 52] }, actor);
  const expanded = changeNewYearConfiguration(first, 'combine', { tableIds: [52, 53] }, actor);
  assert.deepEqual(expanded.merges, [[51, 52, 53]]);
});

test('liberar una ubicación conserva el pago y habilita una nueva asignación', () => {
  const first = save(createNewYearEvent('hrc'), null, { status: 'paid' }, { tableId: 11 });
  const released = changeNewYearBooking(first.event, first.booking, 'release', { tableId: 11 }, actor, now);
  assert.equal(released.event.tableOccupancy[11], 0);
  assert.equal(released.event.paidPeople, 2);
  const assigned = changeNewYearBooking(released.event, released.booking, 'assign', { tableId: 21, count: 2 }, actor, now);
  assert.equal(assigned.event.tableOccupancy[21], 2);
});

test('cancelar libera cupo y ubicación y conserva el registro del pago', () => {
  const paid = save(createNewYearEvent('hrc'), null, { status: 'paid', paymentAmount: 250 }, { tableId: 11 });
  paid.booking.paymentReference = 'Referencia histórica';
  const cancelled = changeNewYearBooking(paid.event, paid.booking, 'setStatus', { status: 'cancelled' }, actor, now);
  assert.equal(cancelled.event.paidPeople, 0);
  assert.equal(cancelled.event.tableOccupancy[11], 0);
  assert.equal(cancelled.booking.paymentStatus, 'paid');
  assert.equal(cancelled.booking.paymentAmount, 250);
  assert.equal(cancelled.booking.paymentReference, 'Referencia histórica');
});

test('editar un cliente preserva autor y fecha de creación y protege asientos ya asignados', () => {
  const first = save(createNewYearEvent('hrc'), null, { status: 'paid' }, { tableId: 11 });
  const other = { uid: 'operator-2', name: 'Otro operador', role: 'user' };
  const updated = changeNewYearBooking(first.event, first.booking, 'saveBooking', { fields: fields({ status: 'paid', notes: 'Actualizado' }) }, other, new Date('2026-11-19T15:00:00Z'));
  assert.equal(updated.booking.createdBy, actor.uid);
  assert.equal(updated.booking.createdAt, now);
  assert.equal(updated.booking.updatedBy, other.uid);
  assert.equal(updated.booking.paymentVerifiedBy, actor.uid);
  assert.throws(() => save(first.event, first.booking, { status: 'paid', adults: 1 }), /Liberá los lugares/);
});

test('los datos y los platos por persona se validan al crear y editar', () => {
  const event = createNewYearEvent('hrc');
  for (const invalid of [{ adults: 0 }, { adults: -1 }, { adults: 1.5 }, { name: ' ' }, { mainCourses: ['bondiola', 'peceto', 'ojo-de-bife'] }, { mainCourses: ['otro'] }, { mainCourses: [null] }, { mainCourses: 'bondiola' }, { allergies: 'x'.repeat(1001) }, { paymentAmount: -1 }]) {
    assert.throws(() => save(event, null, invalid));
  }
  const first = save(event, null);
  assert.throws(() => save(first.event, first.booking, { mainCourses: ['otro'] }));
});

test('guarda los cinco platos por persona y completa elecciones pendientes sin inventar platos', () => {
  const courses = ['bondiola', 'peceto', 'ojo-de-bife', 'lasana-berenjenas', 'canelones-verdura'];
  const saved = save(createNewYearEvent('hrc'), null, { adults: 5, mainCourses: courses });
  assert.deepEqual(saved.booking.mainCourses, courses);
  const updated = save(saved.event, saved.booking, { adults: 6 });
  assert.deepEqual(updated.booking.mainCourses, [...courses, '']);
  assert.deepEqual(save(createNewYearEvent('hrc'), null).booking.mainCourses, ['', '']);
});

test('los registros anteriores sin platos se pueden editar, pagar y ubicar sin perder datos históricos', () => {
  const legacy = save(createNewYearEvent('hrc'), null);
  delete legacy.booking.mainCourses;
  legacy.booking.paymentReference = 'Referencia histórica';
  legacy.booking.drinksA = 2;
  const updated = save(legacy.event, legacy.booking, { status: 'paid' }, {});
  assert.deepEqual(updated.booking.mainCourses, ['', '']);
  assert.equal(updated.booking.paymentReference, 'Referencia histórica');
  assert.equal(updated.booking.drinksA, 2);
  const assigned = changeNewYearBooking(updated.event, updated.booking, 'assign', { tableId: 25, count: 2 }, actor, now);
  assert.equal(assigned.event.tableOccupancy[25], 2);
  assert.deepEqual(assigned.booking.mainCourses, ['', '']);
});

test('dos personas en una mesa de cuatro rechazan tres más y permiten asignar dos y repartir el resto', () => {
  const first = save(createNewYearEvent('hrc'), null, { status: 'paid' }, { tableId: 25 });
  const second = save(first.event, null, { adults: 3, status: 'paid' });
  const before = structuredClone(second);
  assert.throws(() => changeNewYearBooking(second.event, second.booking, 'assign', { tableId: 25, count: 3 }, actor, now), /quedan 2/);
  assert.deepEqual(second, before);
  const split = changeNewYearBooking(second.event, second.booking, 'assign', { tableId: 25, count: 2 }, actor, now);
  const rest = changeNewYearBooking(split.event, split.booking, 'assign', { tableId: 26, count: 1 }, actor, now);
  assert.equal(rest.event.tableOccupancy[25], 4);
  assert.equal(rest.event.tableOccupancy[26], 1);
});

test('nueve personas requieren más que una combinación de ocho y pueden distribuirse sin exceder capacidades', () => {
  const combined = changeNewYearConfiguration(createNewYearEvent('hrc'), 'combine', { tableIds: [51, 52] }, actor);
  const saved = save(combined, null, { adults: 9, status: 'paid' });
  assert.throws(() => changeNewYearBooking(saved.event, saved.booking, 'assign', { tableId: 51, count: 9 }, actor, now), /quedan 8/);
  const eight = changeNewYearBooking(saved.event, saved.booking, 'assign', { tableId: 51, count: 8 }, actor, now);
  const one = changeNewYearBooking(eight.event, eight.booking, 'assign', { tableId: 53, count: 1 }, actor, now);
  assert.deepEqual(one.booking.placements, [{tableId:51,count:4},{tableId:52,count:4},{tableId:53,count:1}]);
});

test('solo un administrador modifica el tope y nunca por debajo de lo pagado', () => {
  const paid = save(createNewYearEvent('hrc'), null, { status: 'paid' });
  assert.throws(() => changeNewYearConfiguration(paid.event, 'setCapacity', { capacity: 1 }, actor), /cubrir los lugares/);
  assert.throws(() => changeNewYearConfiguration(paid.event, 'setCapacity', { capacity: 176 }, { ...actor, role: 'user' }), /administrador/);
  assert.throws(() => changeNewYearConfiguration(paid.event, 'setCapacity', { capacity: 177 }, actor));
});
