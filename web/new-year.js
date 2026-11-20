import { collection, doc, onSnapshot, orderBy, query } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const EVENT_ID = 'new-year-2026';
const EXPIRES_AT = new Date('2027-01-02T03:00:00.000Z').getTime();
const POSITIONS = [
  [40, 120, 130], [41, 335, 130], [42, 510, 185], [43, 663, 185], [44, 510, 55], [45, 663, 55],
  [30, 120, 337], [31, 335, 337], [32, 510, 340], [33, 663, 340], [34, 816, 340], [35, 970, 340], [36, 1123, 340],
  [20, 120, 540], [21, 335, 540], [22, 510, 545], [23, 663, 545], [24, 816, 545], [25, 970, 545], [26, 1123, 545],
  [10, 120, 745], [11, 335, 745], [12, 510, 745], [13, 663, 745], [14, 816, 745], [15, 970, 745], [16, 1123, 745],
  [50, 1287, 145], [51, 1287, 314], [52, 1287, 483], [53, 1287, 652], [54, 1287, 821],
  [60, 1417, 245], [61, 1417, 414], [62, 1417, 583], [63, 1417, 752], [64, 1417, 921],
  [70, 1550, 112], [71, 1550, 252], [72, 1550, 393], [73, 1550, 535], [74, 1550, 677], [75, 1550, 819], [76, 1550, 961]
];
const FAMILIES = [[50, 51, 52, 53, 54], [60, 61, 62, 63, 64], [11, 21, 31, 41]];
const MAX_CAPACITY = POSITIONS.length * 4;
const STATUS_LABELS = { pending: 'Pendiente de pago', paid: 'Pagado', cancelled: 'Cancelado' };
const MAIN_COURSES = [
  ['bondiola', 'Bondiola'], ['peceto', 'Peceto Relleno'], ['ojo-de-bife', 'Ojo de Bife'],
  ['lasana-berenjenas', 'Lasaña de Berenjenas (Veggie)'], ['canelones-verdura', 'Canelones de Verdura (Veggie)']
];
const courseLabel = (id) => MAIN_COURSES.find(([value]) => value === id)?.[1] || 'Por confirmar';
const bookingCourses = (booking) => Array.from({ length: booking.peopleCount }, (_, index) => booking.mainCourses?.[index] || '');

// Keep native select options alive across snapshots and selection changes.
function syncOptions(select, entries, value) {
  const wanted = new Set(entries.map(([key]) => key));
  for (const option of [...select.options]) if (!wanted.has(option.value)) option.remove();
  entries.forEach(([key, label], index) => {
    let option = [...select.options].find((item) => item.value === key);
    if (!option) option = new Option(label, key);
    if (option.textContent !== label) option.textContent = label;
    if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null);
  });
  if (select.value !== String(value)) select.value = value;
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function groupLabel(members) {
  return `${members.length > 1 ? 'Mesas' : 'Mesa'} ${members.join(' + ')}`;
}

function assignedPlaces(booking) {
  return (booking.placements || []).reduce((sum, placement) => sum + placement.count, 0);
}

function dateLabel(value) {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Ushuaia', dateStyle: 'short', timeStyle: 'short'
  }).format(date);
}

function csvCell(value) {
  let content = String(value ?? '');
  if (/^\s*[=+@-]/.test(content)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

export function createNewYearController({ db, functions, notify, onExpire }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('newYearBookingDialog');
  const updateEvent = httpsCallable(functions, 'updateNewYearEvent');
  const tables = POSITIONS.map(([id, x, y]) => ({ id, x, y, buttons: [] })).sort((a, b) => a.id - b.id);
  const state = {
    user: null,
    active: false,
    event: defaultEvent(),
    bookings: [],
    selectedTable: 41,
    selectedBooking: '',
    assignmentMessage: '',
    assignmentError: false,
    assigning: false,
    mealDraft: [],
    search: '',
    mergeMode: false,
    picked: new Set(),
    eventLoaded: false,
    bookingsLoaded: false,
    error: '',
    busy: false,
    editing: null,
    creatingAt: null,
    generation: 0,
    expiryTimer: null,
    unsubscribers: []
  };

  function defaultEvent() {
    return { capacity: MAX_CAPACITY, paidPeople: 0, pendingPeople: 0, tableOccupancy: {}, merges: [], revision: 0 };
  }

  function available() {
    return ['admin', 'user'].includes(state.user?.role) && Date.now() < EXPIRES_AT;
  }

  function ready() {
    return state.eventLoaded && state.bookingsLoaded && !state.error;
  }

  function groupFor(id) {
    return state.event.merges.find((members) => members.includes(id)) || [id];
  }

  function occupied(id) {
    return state.event.tableOccupancy[id] || 0;
  }

  function groupOccupancy(members) {
    return members.reduce((sum, id) => sum + occupied(id), 0);
  }

  function familyFor(id) {
    return FAMILIES.findIndex((family) => family.includes(id));
  }

  function matches(booking) {
    return normalized(`${booking.name} ${booking.contact}`).includes(normalized(state.search));
  }

  function message(value = '', error = false) {
    $('newYearMessage').textContent = value;
    $('newYearMessage').classList.toggle('hidden', !value);
    $('newYearMessage').classList.toggle('form-message--error', error);
  }

  function stopSubscriptions() {
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];
  }

  function checkExpiry() {
    clearTimeout(state.expiryTimer);
    const isAvailable = available();
    $('newYearNav').classList.toggle('hidden', !isAvailable);
    $('newYearNav').parentElement.classList.toggle('primary-nav--event', isAvailable);
    if (!isAvailable) {
      stopSubscriptions();
      if (dialog.open) dialog.close();
      if (state.active) {
        state.active = false;
        onExpire();
      }
      return;
    }
    state.expiryTimer = setTimeout(checkExpiry, Math.min(EXPIRES_AT - Date.now() + 20, 2147483647));
  }

  function subscribe() {
    if (!available()) return;
    stopSubscriptions();
    state.eventLoaded = false;
    state.bookingsLoaded = false;
    state.error = '';
    const generation = state.generation;
    const path = `companies/${state.user.companyId}/newYearEvents/${EVENT_ID}`;
    const fail = (error) => {
      if (generation !== state.generation) return;
      state.error = error.message || 'No se pudo cargar Año Nuevo. Volvé a intentar.';
      render();
    };
    state.unsubscribers.push(onSnapshot(doc(db, path), (snapshot) => {
      if (generation !== state.generation) return;
      state.event = { ...defaultEvent(), ...(snapshot.exists() ? snapshot.data() : {}) };
      state.eventLoaded = true;
      render();
    }, fail));
    state.unsubscribers.push(onSnapshot(query(collection(db, `${path}/bookings`), orderBy('createdAt', 'desc')), (snapshot) => {
      if (generation !== state.generation) return;
      state.bookings = snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
      state.bookingsLoaded = true;
      render();
    }, fail));
    render();
  }

  async function mutate(action, payload = {}, booking = null) {
    if (state.busy || !available() || !ready()) return null;
    const generation = state.generation;
    state.busy = true;
    message();
    render();
    try {
      const response = await updateEvent({
        action,
        ...payload,
        requestId: payload.requestId || crypto.randomUUID(),
        expectedVersion: booking?.version || 0,
        expectedRevision: state.event.revision
      });
      if (generation !== state.generation) return null;
      message('Cambio guardado.');
      return response.data;
    } catch (error) {
      if (generation === state.generation) {
        message(error.message || 'No se pudo guardar el cambio. Volvé a intentar.', true);
      }
      throw error;
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        render();
      }
    }
  }

  async function perform(action, payload, booking) {
    try {
      return await mutate(action, payload, booking);
    } catch (error) {
      notify(error.message || 'No se pudo completar la operación.', 'error');
      return null;
    }
  }

  function selectTable(id) {
    if (state.busy) return;
    const members = groupFor(id);
    if (state.mergeMode) {
      const family = familyFor(id);
      const first = [...state.picked][0];
      if (family < 0 || (first !== undefined && family !== familyFor(first))) {
        message('Elegí mesas del mismo grupo combinable: 50, 60 o 11/21/31/41.', true);
        return;
      }
      const remove = members.every((member) => state.picked.has(member));
      members.forEach((member) => remove ? state.picked.delete(member) : state.picked.add(member));
    } else {
      state.assignmentMessage = '';
      state.selectedTable = members[0];
    }
    render();
  }

  function tableButton(table, mobile = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `new-year-table${mobile ? ' new-year-table--mobile' : ''}`;
    button.textContent = table.id;
    button.dataset.table = table.id;
    if (!mobile) {
      button.style.left = `${table.x / 16}%`;
      button.style.top = `${table.y / 11.31}%`;
    }
    button.addEventListener('click', () => selectTable(table.id));
    table.buttons.push(button);
    return button;
  }

  for (const table of tables) $('newYearFloor').appendChild(tableButton(table));
  for (const sector of [10, 20, 30, 40, 50, 60, 70]) {
    const section = document.createElement('div');
    section.className = 'new-year-mobile-sector';
    const label = document.createElement('p');
    label.textContent = `Sector ${sector}`;
    const buttons = document.createElement('div');
    buttons.className = 'new-year-mobile-tables';
    tables.filter((table) => Math.floor(table.id / 10) * 10 === sector).forEach((table) => buttons.appendChild(tableButton(table, true)));
    section.append(label, buttons);
    $('newYearMobileFloor').appendChild(section);
  }

  function renderFloor() {
    const selected = groupFor(state.selectedTable);
    const matching = new Set(state.bookings.filter(matches).flatMap((booking) => (booking.placements || []).map((placement) => placement.tableId)));
    const pickedFamily = state.picked.size ? familyFor([...state.picked][0]) : -1;
    for (const table of tables) {
      const members = groupFor(table.id);
      const count = groupOccupancy(members);
      for (const button of table.buttons) {
        button.disabled = state.busy;
        button.dataset.occupancy = count === 0 ? 'free' : count === members.length * 4 ? 'full' : 'partial';
        button.dataset.selected = !state.mergeMode && selected.includes(table.id);
        button.dataset.picked = state.mergeMode && state.picked.has(table.id);
        button.dataset.linked = members.length > 1;
        button.dataset.match = !normalized(state.search) || members.some((id) => matching.has(id));
        button.dataset.ineligible = state.mergeMode && (familyFor(table.id) < 0 || (pickedFamily >= 0 && familyFor(table.id) !== pickedFamily));
        button.setAttribute('aria-pressed', String(state.mergeMode ? state.picked.has(table.id) : selected.includes(table.id)));
        button.setAttribute('aria-label', `Mesa ${table.id}, ${count} de ${members.length * 4} lugares asignados${members.length > 1 ? `, combinada con ${members.filter((id) => id !== table.id).join(', ')}` : ''}`);
      }
    }
    $('newYearFloorLinks').replaceChildren();
    for (const members of state.event.merges) {
      const ordered = members.map((id) => tables.find((table) => table.id === id)).sort((a, b) => a.y - b.y);
      for (let index = 1; index < ordered.length; index++) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        const line = document.createElement('div');
        line.className = 'new-year-floor-link';
        line.style.left = `${previous.x / 16}%`;
        line.style.top = `${previous.y / 11.31}%`;
        line.style.width = `${Math.hypot(current.x - previous.x, current.y - previous.y) / 16}%`;
        line.style.transform = `rotate(${Math.atan2(current.y - previous.y, current.x - previous.x)}rad)`;
        $('newYearFloorLinks').appendChild(line);
      }
    }
  }

  function renderAssignment() {
    const members = groupFor(state.selectedTable);
    const count = groupOccupancy(members);
    const tableOptions = [];
    for (const table of tables) {
      const group = groupFor(table.id);
      if (group[0] === table.id) tableOptions.push([String(table.id), `${groupLabel(group)} · ${groupOccupancy(group)}/${group.length * 4}`]);
    }
    syncOptions($('newYearTable'), tableOptions, members[0]);
    $('newYearTable').disabled = state.busy || state.mergeMode;
    $('newYearSelectedTable').textContent = groupLabel(members);
    $('newYearTableOccupancy').textContent = `${count} de ${members.length * 4} lugares asignados`;
    $('newYearUnmerge').disabled = members.length < 2 || state.busy;
    $('newYearUnmerge').textContent = members.length > 1 ? `Descombinar ${members.join(' + ')}` : 'Descombinar mesas';
    const unassigned = state.bookings.filter((booking) => booking.status === 'paid' && assignedPlaces(booking) < booking.peopleCount);
    if (!unassigned.some((booking) => booking.id === state.selectedBooking)) state.selectedBooking = '';
    const bookingOptions = [['', unassigned.length ? 'Elegí un cliente' : 'Sin pagados por ubicar'], ...unassigned.map((booking) => [booking.id, `${booking.name} · ${booking.peopleCount - assignedPlaces(booking)} por ubicar`])];
    syncOptions($('newYearAssignBooking'), bookingOptions, state.selectedBooking);
    $('newYearAssignBooking').disabled = state.busy || state.mergeMode || !unassigned.length;
    const booking = unassigned.find((item) => item.id === state.selectedBooking);
    const maximum = booking ? Math.min(booking.peopleCount - assignedPlaces(booking), members.length * 4 - count) : 0;
    $('newYearAssignCount').max = Math.max(1, maximum);
    $('newYearAssignCount').disabled = !booking || state.busy || state.mergeMode;
    $('newYearAssign').disabled = !maximum || state.busy || state.mergeMode;
    $('newYearAssign').textContent = state.assigning ? 'Asignando…' : 'Asignar lugares';
    const pending = state.bookings.filter((item) => item.status === 'pending').length;
    $('newYearAssignHint').textContent = maximum ? `Quedan ${members.length * 4 - count} lugares libres. Este cliente tiene ${booking.peopleCount - assignedPlaces(booking)} por ubicar. Podés distribuir el grupo entre varias mesas o combinarlas.` : count === members.length * 4 ? 'Mesa completa. Elegí otra mesa o combiná mesas del mismo sector.' : unassigned.length ? 'Elegí un cliente con pago verificado para asignar sus lugares.' : pending ? `Hay ${pending} clientes pendientes de pago. Para ubicarlos, editá su estado en Clientes del evento cuando el equipo haya verificado el pago.` : 'Sin lugares confirmados pendientes de ubicación.';
    $('newYearAssignMessage').textContent = state.assignmentMessage;
    $('newYearAssignMessage').classList.toggle('hidden', !state.assignmentMessage);
    $('newYearAssignMessage').classList.toggle('form-message--error', state.assignmentError);
    $('newYearOccupants').replaceChildren();
    for (const occupant of state.bookings) {
      const places = (occupant.placements || []).filter((placement) => members.includes(placement.tableId)).reduce((sum, placement) => sum + placement.count, 0);
      if (!places) continue;
      const row = document.createElement('div');
      row.className = 'new-year-occupant';
      const name = document.createElement('p');
      name.textContent = `${occupant.name} · ${places} lugares`;
      const release = actionButton('Liberar ubicación', () => perform('release', { bookingId: occupant.id, tableId: members[0] }, occupant));
      row.append(name, release);
      $('newYearOccupants').appendChild(row);
    }
  }

  function actionButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--secondary button--compact';
    button.textContent = label;
    button.disabled = state.busy;
    button.addEventListener('click', action);
    return button;
  }

  function renderBookings() {
    const visible = state.bookings.filter(matches).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    $('newYearResults').textContent = `${visible.length} de ${state.bookings.length} clientes`;
    $('newYearEmpty').classList.toggle('hidden', visible.length > 0);
    $('newYearBookings').replaceChildren();
    for (const booking of visible) {
      const row = document.createElement('article');
      row.className = 'new-year-client';
      const information = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = `${booking.name} · ${booking.peopleCount} personas`;
      const contact = document.createElement('p');
      contact.className = 'panel-copy';
      contact.textContent = booking.contact || 'Contacto sin registrar';
      const status = document.createElement('span');
      status.className = `status-badge new-year-status--${booking.status}`;
      status.textContent = STATUS_LABELS[booking.status] || booking.status;
      const locations = document.createElement('div');
      locations.className = 'new-year-location-list';
      const groups = new Map();
      for (const placement of booking.placements || []) {
        const members = groupFor(placement.tableId);
        const existing = groups.get(members[0]) || { members, count: 0 };
        existing.count += placement.count;
        groups.set(members[0], existing);
      }
      for (const { members, count } of groups.values()) {
        locations.appendChild(actionButton(`${groupLabel(members)} · ${count} lugares`, () => {
          state.mergeMode = false;
          state.picked.clear();
          state.assignmentMessage = '';
          state.selectedTable = members[0];
          render();
          $('newYearFloorTitle').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        }));
      }
      if (!groups.size) {
        const unassigned = document.createElement('span');
        unassigned.className = 'panel-copy';
        unassigned.textContent = booking.status === 'cancelled' ? 'Solicitud cancelada' : 'Ubicación pendiente';
        locations.appendChild(unassigned);
      }
      information.append(name, contact, status, locations);
      const actions = document.createElement('div');
      actions.className = 'new-year-actions';
      actions.appendChild(actionButton('Editar', () => openBooking(booking)));
      if (booking.status === 'paid') actions.appendChild(actionButton(booking.arrived ? 'Marcar pendiente de llegada' : 'Llegó', () => perform('checkIn', { bookingId: booking.id, arrived: !booking.arrived }, booking)));
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Menú, alergias, pago y observaciones';
      details.appendChild(summary);
      const lines = [
        `${booking.adults} adultos · ${booking.children} menores.`,
        ...bookingCourses(booking).map((course, index) => `Persona ${index + 1}: ${courseLabel(course)}.`),
        `Alergias informadas: ${booking.allergies || 'Sin información registrada.'}`,
        `Observaciones: ${booking.notes || 'Sin observaciones.'}`
      ];
      if (booking.paymentAmount !== null && booking.paymentAmount !== undefined) lines.push(`Importe registrado: ${booking.paymentCurrency} ${booking.paymentAmount}.`);
      if (booking.paymentVerifiedAt) lines.push(`Pago verificado por ${booking.paymentVerifiedByName || 'el equipo'} el ${dateLabel(booking.paymentVerifiedAt)}.`);
      if (booking.status === 'cancelled' && booking.paymentStatus === 'paid') lines.push('Tiene un pago registrado.');
      lines.push(`Último cambio por ${booking.updatedByName || 'el equipo'} el ${dateLabel(booking.updatedAt)}.`);
      for (const line of lines) {
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        details.appendChild(paragraph);
      }
      row.append(information, actions, details);
      $('newYearBookings').appendChild(row);
    }
  }

  function render() {
    const loaded = ready();
    $('newYearLoading').classList.toggle('hidden', loaded || !!state.error);
    $('newYearError').classList.toggle('hidden', !state.error);
    $('newYearErrorText').textContent = state.error;
    $('newYearWorkspace').classList.toggle('hidden', !loaded);
    $('newYearNewBooking').disabled = !loaded || state.busy;
    $('newYearExport').disabled = !loaded || !state.bookings.length || state.busy;
    $('newYearSaveBooking').disabled = state.busy;
    $('newYearSaveBooking').textContent = state.busy ? 'Guardando…' : 'Guardar cliente';
    $('newYearCapacityForm').classList.toggle('hidden', state.user?.role !== 'admin' || !loaded);
    $('newYearCapacityForm').querySelector('button').disabled = state.busy;
    $('newYearPaid').textContent = loaded ? state.event.paidPeople : '—';
    $('newYearPending').textContent = loaded ? state.event.pendingPeople : '—';
    $('newYearAvailable').textContent = loaded ? state.event.capacity - state.event.paidPeople : '—';
    $('newYearCapacityLabel').textContent = loaded ? `de ${state.event.capacity} cubiertos` : 'cupo del evento';
    if (document.activeElement !== $('newYearCapacity')) $('newYearCapacity').value = state.event.capacity;
    if (!loaded) return;
    const unassignedCount = Math.max(0, state.event.paidPeople - state.bookings.reduce((sum, booking) => sum + assignedPlaces(booking), 0));
    $('newYearUnassigned').textContent = `${unassignedCount} lugares confirmados por ubicar`;
    $('newYearMergeMode').disabled = state.busy;
    $('newYearMergeMode').setAttribute('aria-pressed', String(state.mergeMode));
    $('newYearMergePanel').classList.toggle('hidden', !state.mergeMode);
    const members = [...state.picked].sort((a, b) => a - b);
    $('newYearMergeSelection').textContent = members.length ? `${groupLabel(members)} · ${members.length * 4} lugares` : 'Seleccioná mesas del grupo 50, del 60 o de 11/21/31/41.';
    $('newYearConfirmMerge').disabled = members.length < 2 || state.busy;
    $('newYearCancelMerge').disabled = state.busy;
    $('newYearCreateAtTable').disabled = state.busy;
    renderFloor();
    renderAssignment();
    renderBookings();
    renderKitchen();
  }

  function renderKitchen() {
    const scope = $('newYearKitchenScope').value;
    const bookings = state.bookings.filter((booking) => scope === 'active' ? booking.status === 'paid' || booking.status === 'pending' : booking.status === scope);
    const counts = new Map(MAIN_COURSES.map(([id]) => [id, 0]));
    let missing = 0;
    for (const booking of bookings) for (const course of bookingCourses(booking)) {
      if (counts.has(course)) counts.set(course, counts.get(course) + 1);
      else missing += 1;
    }
    const portions = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const scopeLabel = $('newYearKitchenScope').selectedOptions[0].textContent;
    $('newYearKitchenSummary').textContent = `${scopeLabel}: ${portions} platos elegidos · ${missing} personas con plato por confirmar. Las reservas canceladas quedan excluidas.`;
    const maximum = Math.max(1, ...counts.values());
    $('newYearKitchenChart').replaceChildren();
    for (const [id, label] of [...MAIN_COURSES].sort((a, b) => counts.get(b[0]) - counts.get(a[0]))) {
      const row = document.createElement('div');
      row.className = 'new-year-dish-row';
      row.dataset.course = id;
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('div');
      track.className = 'new-year-dish-track';
      track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('div');
      bar.className = 'new-year-dish-bar';
      bar.style.width = `${counts.get(id) / maximum * 100}%`;
      track.appendChild(bar);
      const count = document.createElement('strong');
      count.textContent = counts.get(id);
      row.append(name, track, count);
      $('newYearKitchenChart').appendChild(row);
    }
  }

  function renderMealFields() {
    const people = Math.min(MAX_CAPACITY, Math.max(0, (Number($('nyAdults').value) || 0) + (Number($('nyChildren').value) || 0)));
    const container = $('nyMainCourses');
    while (container.children.length > people) container.lastElementChild.remove();
    for (let index = 0; index < people; index += 1) {
      if (container.children[index]) continue;
      const label = document.createElement('label');
      label.className = 'field';
      const name = document.createElement('span');
      name.textContent = `Persona ${index + 1}`;
      const select = document.createElement('select');
      select.dataset.person = index;
      select.setAttribute('aria-label', `Plato principal · Persona ${index + 1}`);
      select.add(new Option('Por confirmar', ''));
      MAIN_COURSES.forEach(([id, title]) => select.add(new Option(title, id)));
      select.value = state.mealDraft[index] || '';
      select.addEventListener('change', () => { state.mealDraft[index] = select.value; });
      label.append(name, select);
      container.appendChild(label);
    }
  }

  function openBooking(booking = null, atTable = null) {
    if (!available() || !ready() || state.busy) return;
    const path = `companies/${state.user.companyId}/newYearEvents/${EVENT_ID}/bookings`;
    state.editing = booking ? { ...booking } : { id: doc(collection(db, path)).id, version: 0 };
    state.editing.requestId = crypto.randomUUID();
    state.editing.payloadFingerprint = '';
    state.creatingAt = atTable;
    $('newYearBookingForm').reset();
    $('newYearBookingTitle').textContent = booking ? 'Editar cliente' : 'Nuevo cliente';
    const fields = {
      nyName: 'name', nyContact: 'contact', nyAdults: 'adults', nyChildren: 'children', nyStatus: 'status',
      nyPaymentAmount: 'paymentAmount', nyPaymentCurrency: 'paymentCurrency', nyAllergies: 'allergies', nyNotes: 'notes'
    };
    if (booking) Object.entries(fields).forEach(([id, key]) => { $(id).value = booking[key] ?? ''; });
    state.mealDraft = booking ? bookingCourses(booking) : [];
    $('nyMainCourses').replaceChildren();
    renderMealFields();
    $('newYearFormError').classList.add('hidden');
    $('newYearDialogPlacement').classList.toggle('hidden', atTable === null);
    $('newYearDialogPlacement').textContent = atTable === null ? '' : `Al marcar Pagado, los lugares se asignarán a ${groupLabel(groupFor(atTable)).toLowerCase()}. Los clientes pendientes quedan en seguimiento.`;
    dialog.showModal();
    $('nyName').focus();
  }

  $('newYearNewBooking').addEventListener('click', () => openBooking());
  $('newYearCreateAtTable').addEventListener('click', () => openBooking(null, state.selectedTable));
  $('newYearCloseDialog').addEventListener('click', () => { if (!state.busy) dialog.close(); });
  $('newYearCancelDialog').addEventListener('click', () => { if (!state.busy) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
  $('newYearBookingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const editing = state.editing;
    const generation = state.generation;
    const payload = {
      bookingId: editing.id,
      requestId: editing.requestId,
      fields: {
        name: $('nyName').value.trim(), contact: $('nyContact').value.trim(), adults: Number($('nyAdults').value),
        children: Number($('nyChildren').value), status: $('nyStatus').value,
        paymentAmount: $('nyPaymentAmount').value === '' ? null : Number($('nyPaymentAmount').value),
        paymentCurrency: $('nyPaymentCurrency').value,
        mainCourses: [...$('nyMainCourses').querySelectorAll('select')].map((select) => select.value),
        allergies: $('nyAllergies').value.trim(), notes: $('nyNotes').value.trim()
      }
    };
    if (state.creatingAt !== null) payload.tableId = state.creatingAt;
    const fingerprint = JSON.stringify({ fields: payload.fields, tableId: payload.tableId });
    if (fingerprint !== editing.payloadFingerprint) {
      editing.payloadFingerprint = fingerprint;
      editing.requestId = crypto.randomUUID();
      payload.requestId = editing.requestId;
    }
    $('newYearFormError').classList.add('hidden');
    try {
      const result = await mutate('saveBooking', payload, editing);
      if (result && generation === state.generation) dialog.close();
    } catch (error) {
      if (generation !== state.generation) return;
      $('newYearFormError').textContent = error.message || 'No se pudo guardar el cliente.';
      $('newYearFormError').classList.remove('hidden');
    }
  });
  $('newYearSearch').addEventListener('input', () => { state.search = $('newYearSearch').value; renderFloor(); renderBookings(); });
  $('nyAdults').addEventListener('input', renderMealFields);
  $('nyChildren').addEventListener('input', renderMealFields);
  $('newYearKitchenScope').addEventListener('change', renderKitchen);
  $('newYearTable').addEventListener('change', () => { state.assignmentMessage = ''; state.selectedTable = Number($('newYearTable').value); render(); });
  $('newYearAssignBooking').addEventListener('change', () => {
    state.assignmentMessage = '';
    state.selectedBooking = $('newYearAssignBooking').value;
    const booking = state.bookings.find((item) => item.id === state.selectedBooking);
    $('newYearAssignCount').value = booking ? booking.peopleCount - assignedPlaces(booking) : 1;
    renderAssignment();
  });
  $('newYearAssignCount').addEventListener('input', () => { state.assignmentMessage = ''; renderAssignment(); });
  $('newYearAssign').addEventListener('click', async () => {
    const booking = state.bookings.find((item) => item.id === state.selectedBooking);
    if (!booking || state.busy) return;
    const count = Number($('newYearAssignCount').value);
    const members = groupFor(state.selectedTable);
    const free = members.length * 4 - groupOccupancy(members);
    const remaining = booking.peopleCount - assignedPlaces(booking);
    state.assignmentError = true;
    if (!Number.isInteger(count) || count < 1 || count > remaining) {
      state.assignmentMessage = `Ingresá una cantidad entera entre 1 y ${remaining}.`;
      renderAssignment();
      return;
    }
    if (count > free) {
      state.assignmentMessage = `Quedan ${free} lugares libres y querés asignar ${count}. Combiná mesas o asigná parte del grupo y ubicá el resto en otra mesa.`;
      renderAssignment();
      return;
    }
    state.assigning = true;
    state.assignmentError = false;
    state.assignmentMessage = 'Asignando lugares…';
    const generation = state.generation;
    try {
      const result = await mutate('assign', { bookingId: booking.id, tableId: state.selectedTable, count }, booking);
      if (result && generation === state.generation) state.assignmentMessage = `${count} lugares asignados a ${booking.name}.`;
    } catch (error) {
      if (generation === state.generation) {
        state.assignmentError = true;
        state.assignmentMessage = error.message || 'No se pudo asignar. Volvé a intentar.';
      }
    } finally {
      if (generation === state.generation) {
        state.assigning = false;
        renderAssignment();
      }
    }
  });
  $('newYearMergeMode').addEventListener('click', () => {
    state.mergeMode = !state.mergeMode;
    state.picked.clear();
    if (state.mergeMode && familyFor(state.selectedTable) >= 0) groupFor(state.selectedTable).forEach((id) => state.picked.add(id));
    message();
    render();
  });
  $('newYearCancelMerge').addEventListener('click', () => { state.mergeMode = false; state.picked.clear(); render(); });
  $('newYearConfirmMerge').addEventListener('click', async () => {
    const result = await perform('combine', { tableIds: [...state.picked] });
    if (result) {
      state.selectedTable = Math.min(...state.picked);
      state.mergeMode = false;
      state.picked.clear();
      render();
    }
  });
  $('newYearUnmerge').addEventListener('click', async () => {
    const result = await perform('uncombine', { tableId: state.selectedTable });
    if (result) {
      state.mergeMode = false;
      state.picked.clear();
      render();
    }
  });
  $('newYearCapacityForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await perform('setCapacity', { capacity: Number($('newYearCapacity').value) });
  });
  $('newYearRetry').addEventListener('click', subscribe);
  $('newYearExport').addEventListener('click', () => {
    const header = ['Titular', 'Contacto', 'Adultos', 'Menores', 'Lugares', 'Estado', 'Estado del pago', 'Importe', 'Moneda', 'Mesas y lugares', 'Llegó', 'Plato por persona', ...MAIN_COURSES.map(([, label]) => label), 'Platos por confirmar', 'Alergias', 'Observaciones', 'Pago verificado por', 'Verificado el', 'Actualizado por'];
    const rows = state.bookings.map((booking) => [
      booking.name, booking.contact, booking.adults, booking.children, booking.peopleCount, STATUS_LABELS[booking.status],
      booking.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente', booking.paymentAmount, booking.paymentCurrency,
      (booking.placements || []).map((placement) => `${placement.tableId}: ${placement.count}`).join(' / '), booking.arrived ? 'Sí' : 'No',
      bookingCourses(booking).map((course, index) => `Persona ${index + 1}: ${courseLabel(course)}`).join(' / '),
      ...MAIN_COURSES.map(([id]) => bookingCourses(booking).filter((course) => course === id).length),
      bookingCourses(booking).filter((course) => !course).length, booking.allergies, booking.notes, booking.paymentVerifiedByName,
      dateLabel(booking.paymentVerifiedAt), booking.updatedByName
    ]);
    const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ano-nuevo-2026-clientes.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('visibilitychange', checkExpiry);

  return {
    available,
    setUser(user) {
      stopSubscriptions();
      state.generation += 1;
      state.user = user;
      state.active = false;
      state.event = defaultEvent();
      state.bookings = [];
      state.eventLoaded = false;
      state.bookingsLoaded = false;
      state.error = '';
      state.busy = false;
      state.mergeMode = false;
      state.picked.clear();
      state.search = '';
      state.editing = null;
      state.selectedTable = 41;
      state.selectedBooking = '';
      state.assignmentMessage = '';
      state.assignmentError = false;
      state.assigning = false;
      state.mealDraft = [];
      $('newYearSearch').value = '';
      $('newYearBookings').replaceChildren();
      $('newYearOccupants').replaceChildren();
      $('nyMainCourses').replaceChildren();
      $('newYearKitchenChart').replaceChildren();
      $('newYearKitchenSummary').textContent = '';
      $('newYearKitchenScope').value = 'paid';
      $('newYearAssignMessage').textContent = '';
      $('newYearAssignMessage').classList.add('hidden');
      $('newYearTable').replaceChildren();
      $('newYearAssignBooking').replaceChildren();
      $('newYearBookingForm').reset();
      if (dialog.open) dialog.close();
      message();
      render();
      checkExpiry();
    },
    setActive(active) {
      state.active = active;
      if (active && available()) subscribe();
      else stopSubscriptions();
    }
  };
}
