const NEW_YEAR_EVENT_ID = 'new-year-2026';
const NEW_YEAR_EXPIRES_AT = new Date('2027-01-02T03:00:00.000Z');
const TABLE_IDS = [
  ...Array.from({ length: 7 }, (_, index) => 10 + index),
  ...Array.from({ length: 7 }, (_, index) => 20 + index),
  ...Array.from({ length: 7 }, (_, index) => 30 + index),
  ...Array.from({ length: 6 }, (_, index) => 40 + index),
  ...Array.from({ length: 5 }, (_, index) => 50 + index),
  ...Array.from({ length: 5 }, (_, index) => 60 + index),
  ...Array.from({ length: 7 }, (_, index) => 70 + index)
];
const MERGE_FAMILIES = [[50, 51, 52, 53, 54], [60, 61, 62, 63, 64], [11, 21, 31, 41]];
const MAX_CAPACITY = TABLE_IDS.length * 4;
const MAIN_COURSE_IDS = ['bondiola', 'peceto', 'ojo-de-bife', 'lasana-berenjenas', 'canelones-verdura'];

class NewYearError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireCondition(condition, message, code = 'invalid-argument') {
  if (!condition) throw new NewYearError(code, message);
}

function integer(value, label, maximum = MAX_CAPACITY) {
  requireCondition(Number.isInteger(value) && value >= 0 && value <= maximum, `${label} debe ser un número entero entre 0 y ${maximum}.`);
  return value;
}

function text(value, label, maximum, required = false) {
  const result = value ?? '';
  requireCondition(typeof result === 'string' && result.length <= maximum, `${label} admite hasta ${maximum} caracteres.`);
  requireCondition(!required || result.trim().length > 0, `Completá ${label.toLowerCase()}.`);
  return result.trim();
}

function tableGroup(event, tableId) {
  requireCondition(TABLE_IDS.includes(tableId), 'La mesa seleccionada no existe.');
  return event.merges.find((group) => group.includes(tableId)) || [tableId];
}

function createNewYearEvent(companyId) {
  return {
    companyId,
    eventId: NEW_YEAR_EVENT_ID,
    date: '2026-12-31',
    expiresAt: NEW_YEAR_EXPIRES_AT,
    capacity: MAX_CAPACITY,
    paidPeople: 0,
    pendingPeople: 0,
    tableOccupancy: {},
    merges: [],
    revision: 0
  };
}

function bookingPeople(booking, status) {
  return booking?.status === status ? booking.peopleCount : 0;
}

function sanitizeBooking(fields, previous) {
  requireCondition(fields && typeof fields === 'object', 'Faltan los datos del cliente.');
  const adults = integer(fields.adults, 'Adultos');
  const children = integer(fields.children, 'Menores');
  const peopleCount = adults + children;
  requireCondition(peopleCount >= 1 && peopleCount <= MAX_CAPACITY, `La reserva debe tener entre 1 y ${MAX_CAPACITY} personas.`);
  requireCondition(['pending', 'paid', 'cancelled'].includes(fields.status), 'El estado del cliente no es válido.');
  const courses = fields.mainCourses === undefined ? (previous?.mainCourses || []).slice(0, peopleCount) : fields.mainCourses;
  requireCondition(Array.isArray(courses) && courses.length <= peopleCount, 'Indicá como máximo un plato principal por persona.');
  const mainCourses = Array.from({ length: peopleCount }, (_, index) => {
    const course = index < courses.length ? courses[index] : '';
    requireCondition(course === '' || MAIN_COURSE_IDS.includes(course), 'El plato principal seleccionado no es válido.');
    return course;
  });
  const paymentAmount = fields.paymentAmount ?? null;
  requireCondition(paymentAmount === null || (Number.isFinite(paymentAmount) && paymentAmount >= 0 && paymentAmount <= 1e12), 'El importe recibido no es válido.');
  requireCondition(['USD', 'ARS', 'EUR', 'BRL'].includes(fields.paymentCurrency), 'La moneda del pago no es válida.');
  return {
    name: text(fields.name, 'Nombre del titular', 120, true),
    contact: text(fields.contact, 'Contacto', 160),
    adults,
    children,
    peopleCount,
    status: fields.status,
    paymentAmount,
    paymentCurrency: fields.paymentCurrency,
    mainCourses,
    allergies: text(fields.allergies, 'Alergias', 1000),
    notes: text(fields.notes, 'Observaciones', 2000)
  };
}

function assignPlaces(event, booking, tableId, count) {
  requireCondition(booking.status === 'paid', 'Verificá el pago antes de asignar lugares.', 'failed-precondition');
  integer(count, 'Lugares a asignar');
  const assigned = booking.placements.reduce((sum, placement) => sum + placement.count, 0);
  requireCondition(count > 0 && count <= booking.peopleCount - assigned, 'La cantidad supera los lugares del cliente pendientes de ubicación.');
  const members = tableGroup(event, tableId);
  const available = members.reduce((sum, id) => sum + 4 - (event.tableOccupancy[id] || 0), 0);
  requireCondition(count <= available, `La mesa no tiene suficientes lugares libres: quedan ${available} y querés asignar ${count}. Combiná mesas o distribuí el grupo en más de una mesa.`, 'resource-exhausted');
  const placements = booking.placements.map((placement) => ({ ...placement }));
  let remaining = count;
  for (const id of members) {
    const added = Math.min(remaining, 4 - (event.tableOccupancy[id] || 0));
    if (added === 0) continue;
    const existing = placements.find((placement) => placement.tableId === id);
    if (existing) existing.count += added;
    else placements.push({ tableId: id, count: added });
    remaining -= added;
  }
  return placements;
}

function updateCounters(event, previous, booking) {
  const tableOccupancy = { ...event.tableOccupancy };
  for (const placement of previous?.placements || []) {
    const count = (tableOccupancy[placement.tableId] || 0) - placement.count;
    requireCondition(count >= 0, 'La ocupación de la mesa necesita ser revisada.', 'failed-precondition');
    tableOccupancy[placement.tableId] = count;
  }
  for (const placement of booking.placements) {
    requireCondition(TABLE_IDS.includes(placement.tableId), 'La mesa asignada no existe.');
    integer(placement.count, 'Lugares de la mesa', 4);
    const count = (tableOccupancy[placement.tableId] || 0) + placement.count;
    requireCondition(count <= 4, 'La asignación supera los cuatro lugares de una mesa.', 'resource-exhausted');
    tableOccupancy[placement.tableId] = count;
  }
  const paidPeople = event.paidPeople - bookingPeople(previous, 'paid') + bookingPeople(booking, 'paid');
  const pendingPeople = event.pendingPeople - bookingPeople(previous, 'pending') + bookingPeople(booking, 'pending');
  requireCondition(paidPeople >= 0 && pendingPeople >= 0, 'Los contadores del evento necesitan revisión.', 'failed-precondition');
  requireCondition(paidPeople <= event.capacity, 'La confirmación supera el tope de cubiertos del evento.', 'resource-exhausted');
  return { ...event, paidPeople, pendingPeople, tableOccupancy, revision: event.revision + 1 };
}

function changeNewYearBooking(event, previous, action, payload, actor, now) {
  requireCondition(action === 'saveBooking' || previous, 'El cliente ya no está disponible. Volvé a cargar el evento.', 'not-found');
  let booking = {
    ...previous,
    placements: (previous?.placements || []).map((placement) => ({ ...placement }))
  };
  if (action === 'saveBooking') {
    booking = { ...booking, ...sanitizeBooking(payload.fields, previous) };
  } else if (action === 'setStatus') {
    requireCondition(['pending', 'paid', 'cancelled'].includes(payload.status), 'El estado no es válido.');
    booking.status = payload.status;
  } else if (action === 'assign') {
    booking.placements = assignPlaces(event, booking, payload.tableId, payload.count);
  } else if (action === 'release') {
    const members = tableGroup(event, payload.tableId);
    booking.placements = booking.placements.filter((placement) => !members.includes(placement.tableId));
  } else if (action === 'checkIn') {
    requireCondition(typeof payload.arrived === 'boolean', 'El estado de llegada no es válido.');
    requireCondition(!payload.arrived || booking.status === 'paid', 'La llegada requiere una reserva con pago verificado.', 'failed-precondition');
    booking.arrived = payload.arrived;
  } else {
    throw new NewYearError('invalid-argument', 'La operación del cliente no es válida.');
  }

  if (booking.status === 'paid') {
    booking.paymentStatus = 'paid';
    if (previous?.status !== 'paid') {
      booking.paymentVerifiedAt = now;
      booking.paymentVerifiedBy = actor.uid;
      booking.paymentVerifiedByName = actor.name;
    }
  } else {
    booking.placements = [];
    booking.arrived = false;
    booking.paymentStatus = booking.status === 'cancelled' ? previous?.paymentStatus || 'pending' : 'pending';
  }
  booking.arrived = booking.arrived === true;
  requireCondition(booking.placements.reduce((sum, placement) => sum + placement.count, 0) <= booking.peopleCount, 'Liberá los lugares sobrantes antes de reducir la cantidad de personas.', 'failed-precondition');

  if (action === 'saveBooking' && !previous && payload.tableId !== undefined && booking.status === 'paid') {
    booking.placements = assignPlaces(event, booking, payload.tableId, booking.peopleCount);
  }
  booking.version = (previous?.version || 0) + 1;
  booking.companyId = event.companyId;
  booking.eventId = NEW_YEAR_EVENT_ID;
  booking.updatedAt = now;
  booking.updatedBy = actor.uid;
  booking.updatedByName = actor.name;
  booking.createdAt = previous?.createdAt || now;
  booking.createdBy = previous?.createdBy || actor.uid;
  return { event: updateCounters(event, previous, booking), booking };
}

function changeNewYearConfiguration(event, action, payload, actor) {
  let result = { ...event, merges: event.merges.map((group) => [...group]) };
  if (action === 'setCapacity') {
    requireCondition(actor.role === 'admin', 'Solo un administrador puede modificar el tope.', 'permission-denied');
    integer(payload.capacity, 'Tope de cubiertos');
    requireCondition(payload.capacity >= Math.max(1, event.paidPeople), 'El tope debe cubrir los lugares ya confirmados.', 'failed-precondition');
    result.capacity = payload.capacity;
  } else if (action === 'combine') {
    requireCondition(Array.isArray(payload.tableIds) && payload.tableIds.length >= 2 && payload.tableIds.length <= 5, 'Seleccioná al menos dos mesas combinables.');
    const members = [...new Set(payload.tableIds.flatMap((id) => tableGroup(event, id)))].sort((a, b) => a - b);
    requireCondition(MERGE_FAMILIES.some((family) => members.every((id) => family.includes(id))), 'Las mesas deben pertenecer al grupo 50, al 60 o a 11/21/31/41.');
    requireCondition(members.length >= 2, 'Seleccioná al menos dos mesas.');
    result.merges = result.merges.filter((group) => !group.some((id) => members.includes(id)));
    result.merges.push(members);
  } else if (action === 'uncombine') {
    tableGroup(event, payload.tableId);
    result.merges = result.merges.filter((group) => !group.includes(payload.tableId));
  } else {
    throw new NewYearError('invalid-argument', 'La configuración solicitada no es válida.');
  }
  result.revision = event.revision + 1;
  return result;
}

module.exports = {
  NEW_YEAR_EVENT_ID,
  NEW_YEAR_EXPIRES_AT,
  TABLE_IDS,
  MAX_CAPACITY,
  NewYearError,
  createNewYearEvent,
  changeNewYearBooking,
  changeNewYearConfiguration
};
