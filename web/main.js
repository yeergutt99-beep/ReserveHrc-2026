import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAtyahCY20oeKmsLcCqf7bZR3WznrdZdOY',
  authDomain: 'hrc-reserve.firebaseapp.com',
  projectId: 'hrc-reserve'
};

const RESTAURANT_TIME_ZONE = 'America/Argentina/Ushuaia';
const RESTAURANT_UTC_OFFSET = '-03:00';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1');

const state = {
  userMeta: null,
  reservations: [],
  shows: [],
  alerts: [],
  sofiaEnabled: true,
  editingReservation: null,
  editingShow: null,
  pendingDelete: null,
  unsubscribeReservations: null,
  unsubscribeShows: null,
  unsubscribeAlerts: null,
  unsubscribeSofia: null,
  toastTimer: null
};

const $ = (id) => document.getElementById(id);
const loginView = $('loginView');
const appView = $('appView');
const loginForm = $('loginForm');
const reservationForm = $('reservationForm');
const showForm = $('showForm');
const reservationModal = $('reservationModal');
const showModal = $('showModal');
const deleteModal = $('deleteModal');

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatDate(dateValue, options = {}) {
  if (!dateValue) return 'Sin fecha';
  const date = new Date(`${dateValue}T12:00:00${RESTAURANT_UTC_OFFSET}`);
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: RESTAURANT_TIME_ZONE,
    day: '2-digit',
    month: options.short ? 'short' : 'long',
    year: options.includeYear ? 'numeric' : undefined
  }).format(date);
}

function formatTimestamp(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: RESTAURANT_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatLongToday() {
  const formatted = new Intl.DateTimeFormat('es-AR', {
    timeZone: RESTAURANT_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date());
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function reservationExpiry(date, time) {
  const reservationDate = new Date(`${date}T${time}:00${RESTAURANT_UTC_OFFSET}`);
  if (Number.isNaN(reservationDate.getTime())) {
    throw new Error('La fecha o la hora no son válidas.');
  }
  return new Date(reservationDate.getTime() + 24 * 60 * 60 * 1000);
}

function suggestedTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + (30 - (now.getMinutes() % 30 || 30)));
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function setButtonBusy(button, busy, busyText) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent.trim();
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.defaultText;
}

function showFormError(element, message = '') {
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function showToast(message, type = 'success') {
  const toast = $('toast');
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.remove('hidden', 'toast--error');
  if (type === 'error') toast.classList.add('toast--error');
  state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function translateAuthError(error) {
  const messages = {
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/invalid-email': 'Ingresá un correo electrónico válido.',
    'auth/too-many-requests': 'Hubo demasiados intentos. Esperá unos minutos y volvé a intentar.',
    'auth/network-request-failed': 'No hay conexión. Revisá Internet e intentá nuevamente.'
  };
  return messages[error.code] || 'No se pudo iniciar sesión. Intentá nuevamente.';
}

function setModalLock() {
  const anyOpen = [reservationModal, showModal, deleteModal]
    .some((modal) => !modal.classList.contains('hidden'));
  document.body.style.overflow = anyOpen ? 'hidden' : '';
}

function setActiveView(view) {
  document.querySelectorAll('.workspace-view').forEach((element) => {
    element.classList.toggle('hidden', element.id !== `view${view[0].toUpperCase()}${view.slice(1)}`);
  });
  document.querySelectorAll('.workspace-tab').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function openReservationModal(reservation = null) {
  state.editingReservation = reservation;
  reservationForm.reset();
  showFormError($('reservationError'));
  if (reservation) {
    $('reservationModalEyebrow').textContent = 'Editar reserva';
    $('reservationModalTitle').textContent = reservation.name;
    $('saveReservationBtn').textContent = 'Guardar cambios';
    $('resName').value = reservation.name || '';
    $('resDate').value = reservation.date || '';
    $('resTime').value = reservation.time || '';
    $('resPeople').value = reservation.peopleCount || 1;
    $('resContact').value = reservation.contact || '';
    $('resComments').value = reservation.comments || '';
  } else {
    $('reservationModalEyebrow').textContent = 'Nueva reserva';
    $('reservationModalTitle').textContent = 'Agregar a la agenda';
    $('saveReservationBtn').textContent = 'Guardar reserva';
    $('resDate').value = $('filterDate').value || todayValue();
    $('resTime').value = suggestedTime();
    $('resPeople').value = 2;
  }
  reservationModal.classList.remove('hidden');
  setModalLock();
  setTimeout(() => $('resName').focus(), 50);
}

function closeReservationModal() {
  reservationModal.classList.add('hidden');
  state.editingReservation = null;
  setModalLock();
}

function openShowModal(show = null) {
  state.editingShow = show;
  showForm.reset();
  showFormError($('showError'));
  if (show) {
    $('showModalEyebrow').textContent = 'Editar show';
    $('showModalTitle').textContent = show.name;
    $('saveShowBtn').textContent = 'Guardar cambios';
    $('showDate').value = show.date || '';
    $('showTime').value = show.time || '';
    $('showName').value = show.name || '';
    $('showMusicStyle').value = show.musicStyle || '';
    $('showNotes').value = show.notes || '';
  } else {
    $('showModalEyebrow').textContent = 'Nuevo show';
    $('showModalTitle').textContent = 'Agregar a la agenda musical';
    $('saveShowBtn').textContent = 'Guardar show';
    $('showDate').value = todayValue();
    $('showTime').value = '21:00';
  }
  showModal.classList.remove('hidden');
  setModalLock();
  setTimeout(() => $('showName').focus(), 50);
}

function closeShowModal() {
  showModal.classList.add('hidden');
  state.editingShow = null;
  setModalLock();
}

function openDeleteModal(kind, item) {
  state.pendingDelete = { kind, item };
  const eyebrow = deleteModal.querySelector('.eyebrow');
  if (kind === 'reservation') {
    eyebrow.textContent = 'Eliminar reserva';
    $('deleteMessage').textContent = `Vas a eliminar la reserva de ${item.name}, para ${item.peopleCount} personas, el ${formatDate(item.date, { includeYear: true })} a las ${item.time}.`;
  } else {
    eyebrow.textContent = 'Eliminar show';
    $('deleteMessage').textContent = `Vas a eliminar ${item.name}, programado para el ${formatDate(item.date, { includeYear: true })} a las ${item.time}. Sofía dejará de informarlo.`;
  }
  deleteModal.classList.remove('hidden');
  setModalLock();
}

function closeDeleteModal() {
  deleteModal.classList.add('hidden');
  state.pendingDelete = null;
  setModalLock();
}

function createCell(className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  return cell;
}

function sourceLabel(source) {
  return source === 'whatsapp' || source === 'sofia' ? 'Sofía · WhatsApp' : 'Manual';
}

function reservationCode(reservation) {
  return reservation.reservationCode || `HRC-${reservation.id.slice(0, 8).toUpperCase()}`;
}

function renderReservations() {
  const search = $('searchInput').value.trim().toLocaleLowerCase('es');
  const visible = state.reservations.filter((reservation) => {
    if (!search) return true;
    return [reservation.name, reservation.contact, reservation.comments, reservationCode(reservation)]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('es').includes(search));
  });
  const body = $('reservationsBody');
  body.replaceChildren();

  visible.forEach((reservation) => {
    const row = document.createElement('tr');
    const timeCell = createCell('time-cell');
    const time = document.createElement('strong');
    time.textContent = reservation.time || '--:--';
    const date = document.createElement('span');
    date.textContent = formatDate(reservation.date, { short: true });
    timeCell.append(time, date);

    const nameCell = createCell('reservation-name');
    const name = document.createElement('strong');
    name.textContent = reservation.name || 'Sin nombre';
    const detail = document.createElement('span');
    detail.textContent = reservationCode(reservation);
    nameCell.append(name, detail);

    const peopleCell = createCell();
    const people = document.createElement('span');
    people.className = `people-badge${reservation.peopleCount > 15 ? ' people-badge--large' : ''}`;
    people.textContent = `${reservation.peopleCount} pax`;
    peopleCell.appendChild(people);

    const contactCell = createCell(reservation.contact ? '' : 'muted-cell');
    contactCell.textContent = reservation.contact || 'Sin contacto';
    const commentsCell = createCell(reservation.comments ? '' : 'muted-cell');
    commentsCell.textContent = reservation.comments || 'Sin observaciones';
    if (reservation.comments) commentsCell.title = reservation.comments;

    const sourceCell = createCell();
    const source = document.createElement('span');
    const isWhatsApp = reservation.source === 'whatsapp' || reservation.source === 'sofia';
    source.className = `source-badge${isWhatsApp ? ' source-badge--whatsapp' : ''}`;
    source.textContent = sourceLabel(reservation.source);
    sourceCell.appendChild(source);

    const actionsCell = createCell('actions-column');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'action-button';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => openReservationModal(reservation));
    actions.appendChild(editButton);
    if (state.userMeta?.role === 'admin') {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'action-button action-button--delete';
      deleteButton.textContent = 'Eliminar';
      deleteButton.addEventListener('click', () => openDeleteModal('reservation', reservation));
      actions.appendChild(deleteButton);
    }
    actionsCell.appendChild(actions);
    row.append(timeCell, nameCell, peopleCell, contactCell, commentsCell, sourceCell, actionsCell);
    body.appendChild(row);
  });

  const totalPeople = visible.reduce((total, item) => total + Number(item.peopleCount || 0), 0);
  const largeGroups = visible.filter((item) => item.peopleCount > 15).length;
  $('reservationCount').textContent = String(visible.length);
  $('peopleCount').textContent = String(totalPeople);
  $('largeGroupCount').textContent = String(largeGroups);
  const selectedDate = $('filterDate').value;
  $('resultSummary').textContent = selectedDate
    ? `${visible.length} reserva${visible.length === 1 ? '' : 's'} para el ${formatDate(selectedDate, { includeYear: true })}`
    : `${visible.length} próxima${visible.length === 1 ? '' : 's'} reserva${visible.length === 1 ? '' : 's'}`;
  $('loadingState').classList.add('hidden');
  $('emptyState').classList.toggle('hidden', visible.length > 0);
  $('reservationsTableWrap').classList.toggle('hidden', visible.length === 0);
}

function renderShows() {
  const body = $('showsBody');
  body.replaceChildren();
  state.shows.forEach((show) => {
    const row = document.createElement('tr');
    const dateCell = createCell('time-cell');
    const date = document.createElement('strong');
    date.textContent = formatDate(show.date, { includeYear: true });
    dateCell.appendChild(date);
    const nameCell = createCell('reservation-name');
    const name = document.createElement('strong');
    name.textContent = show.name;
    nameCell.appendChild(name);
    const timeCell = createCell();
    timeCell.textContent = show.time || '--:--';
    const styleCell = createCell(show.musicStyle ? '' : 'muted-cell');
    styleCell.textContent = show.musicStyle || 'Sin estilo informado';
    const notesCell = createCell(show.notes ? '' : 'muted-cell');
    notesCell.textContent = show.notes || 'Sin observaciones';
    const actionsCell = createCell('actions-column');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'action-button';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => openShowModal(show));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'action-button action-button--delete';
    deleteButton.textContent = 'Eliminar';
    deleteButton.addEventListener('click', () => openDeleteModal('show', show));
    actions.append(editButton, deleteButton);
    actionsCell.appendChild(actions);
    row.append(dateCell, nameCell, timeCell, styleCell, notesCell, actionsCell);
    body.appendChild(row);
  });
  $('showsSummary').textContent = `${state.shows.length} show${state.shows.length === 1 ? '' : 's'} próximo${state.shows.length === 1 ? '' : 's'}`;
  $('showsLoadingState').classList.add('hidden');
  $('showsEmptyState').classList.toggle('hidden', state.shows.length > 0);
  $('showsTableWrap').classList.toggle('hidden', state.shows.length === 0);
}

function alertStatusLabel(status) {
  return {
    pending: 'Pendiente',
    in_progress: 'En atención',
    resolved: 'Resuelta'
  }[status] || 'Pendiente';
}

async function changeAlertStatus(alert, status, button) {
  setButtonBusy(button, true, status === 'resolved' ? 'Resolviendo…' : 'Tomando…');
  try {
    const updateHumanAlertStatus = httpsCallable(functions, 'updateHumanAlertStatus');
    await updateHumanAlertStatus({ alertId: alert.id, status });
    showToast(status === 'resolved' ? 'Alerta resuelta. Sofía fue reactivada para ese cliente.' : 'Alerta tomada.');
  } catch (error) {
    console.error('No se pudo actualizar la alerta.', error);
    showToast('No se pudo actualizar la alerta.', 'error');
    setButtonBusy(button, false);
  }
}

function renderAlerts() {
  const body = $('alertsBody');
  body.replaceChildren();
  const openAlerts = state.alerts.filter((alert) => alert.status !== 'resolved');
  state.alerts.forEach((alert) => {
    const row = document.createElement('tr');
    const createdCell = createCell('time-cell');
    const created = document.createElement('strong');
    created.textContent = formatTimestamp(alert.createdAt);
    if (alert.reminderSent) {
      const reminder = document.createElement('span');
      reminder.textContent = 'Recordatorio enviado';
      createdCell.append(created, reminder);
    } else {
      createdCell.appendChild(created);
    }
    const customerCell = createCell('reservation-name');
    const customer = document.createElement('strong');
    customer.textContent = alert.customerName || 'Sin nombre confirmado';
    const phone = document.createElement('span');
    phone.textContent = alert.phone || alert.senderId || 'Sin contacto';
    customerCell.append(customer, phone);
    const reasonCell = createCell();
    reasonCell.textContent = alert.reason || 'Sin motivo';
    const summaryCell = createCell();
    summaryCell.textContent = alert.summary || 'Sin resumen';
    summaryCell.className = 'summary-cell';
    const statusCell = createCell();
    const status = document.createElement('span');
    status.className = `status-badge status-badge--${alert.status || 'pending'}`;
    status.textContent = alertStatusLabel(alert.status);
    statusCell.appendChild(status);
    const actionsCell = createCell('actions-column');
    if (alert.status !== 'resolved') {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = alert.status === 'in_progress'
        ? 'action-button action-button--resolve'
        : 'action-button';
      actionButton.textContent = alert.status === 'in_progress' ? 'Resolver' : 'Tomar';
      actionButton.addEventListener('click', () => {
        changeAlertStatus(alert, alert.status === 'in_progress' ? 'resolved' : 'in_progress', actionButton);
      });
      actionsCell.appendChild(actionButton);
    }
    row.append(createdCell, customerCell, reasonCell, summaryCell, statusCell, actionsCell);
    body.appendChild(row);
  });
  $('alertsSummary').textContent = `${openAlerts.length} pendiente${openAlerts.length === 1 ? '' : 's'} · ${state.alerts.length} total`;
  $('alertNavCount').textContent = String(openAlerts.length);
  $('alertNavCount').classList.toggle('hidden', openAlerts.length === 0);
  $('alertsLoadingState').classList.add('hidden');
  $('alertsEmptyState').classList.toggle('hidden', state.alerts.length > 0);
  $('alertsTableWrap').classList.toggle('hidden', state.alerts.length === 0);
}

function renderSofiaControl() {
  const badge = $('sofiaStatusBadge');
  badge.textContent = state.sofiaEnabled ? 'Sofía activa' : 'Sofía apagada';
  badge.className = `status-badge status-badge--${state.sofiaEnabled ? 'active' : 'disabled'}`;
  const button = $('sofiaToggleBtn');
  button.classList.toggle('hidden', state.userMeta?.role !== 'admin');
  button.textContent = state.sofiaEnabled ? 'Apagar Sofía' : 'Encender Sofía';
  button.className = `button ${state.sofiaEnabled ? 'button--danger' : 'button--secondary'}${state.userMeta?.role !== 'admin' ? ' hidden' : ''}`;
  delete button.dataset.defaultText;
}

function subscribeToReservations() {
  if (!state.userMeta) return;
  if (state.unsubscribeReservations) state.unsubscribeReservations();
  $('loadingState').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('reservationsTableWrap').classList.add('hidden');
  const reservationsRef = collection(db, `companies/${state.userMeta.companyId}/reservations`);
  const selectedDate = $('filterDate').value;
  const reservationsQuery = selectedDate
    ? query(reservationsRef, where('date', '==', selectedDate), orderBy('time'))
    : query(reservationsRef, where('date', '>=', todayValue()), orderBy('date'), orderBy('time'));
  state.unsubscribeReservations = onSnapshot(
    reservationsQuery,
    (snapshot) => {
      state.reservations = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      renderReservations();
    },
    (error) => {
      console.error('No se pudieron cargar las reservas.', error);
      $('loadingState').classList.add('hidden');
      showToast('No se pudieron cargar las reservas.', 'error');
    }
  );
}

function subscribeToShows() {
  if (!state.userMeta) return;
  if (state.unsubscribeShows) state.unsubscribeShows();
  const showsRef = collection(db, `companies/${state.userMeta.companyId}/shows`);
  const showsQuery = query(showsRef, where('date', '>=', todayValue()), orderBy('date'), orderBy('time'));
  state.unsubscribeShows = onSnapshot(
    showsQuery,
    (snapshot) => {
      state.shows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      renderShows();
    },
    (error) => {
      console.error('No se pudieron cargar los shows.', error);
      $('showsLoadingState').classList.add('hidden');
      showToast('No se pudieron cargar los shows.', 'error');
    }
  );
}

function subscribeToAlerts() {
  if (!state.userMeta) return;
  if (state.unsubscribeAlerts) state.unsubscribeAlerts();
  const alertsRef = collection(db, `companies/${state.userMeta.companyId}/humanAlerts`);
  state.unsubscribeAlerts = onSnapshot(
    query(alertsRef, orderBy('createdAt', 'desc')),
    (snapshot) => {
      state.alerts = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      renderAlerts();
    },
    (error) => {
      console.error('No se pudieron cargar las alertas.', error);
      $('alertsLoadingState').classList.add('hidden');
      showToast('No se pudieron cargar las alertas.', 'error');
    }
  );
}

function subscribeToSofiaSettings() {
  if (!state.userMeta) return;
  if (state.unsubscribeSofia) state.unsubscribeSofia();
  const settingsRef = doc(db, `companies/${state.userMeta.companyId}/settings/sofia`);
  state.unsubscribeSofia = onSnapshot(settingsRef, (snapshot) => {
    state.sofiaEnabled = snapshot.exists() ? snapshot.data().enabled !== false : true;
    renderSofiaControl();
  });
}

function changeSelectedDate(days) {
  const current = $('filterDate').value || todayValue();
  const date = new Date(`${current}T12:00:00`);
  date.setDate(date.getDate() + days);
  $('filterDate').value = dateToInputValue(date);
  subscribeToReservations();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError($('loginError'));
  setButtonBusy($('loginBtn'), true, 'Ingresando…');
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    loginForm.reset();
  } catch (error) {
    showFormError($('loginError'), translateAuthError(error));
  } finally {
    setButtonBusy($('loginBtn'), false);
  }
});

$('logoutBtn').addEventListener('click', async () => signOut(auth));
document.querySelectorAll('.workspace-tab').forEach((button) => {
  button.addEventListener('click', () => setActiveView(button.dataset.view));
});
$('newReservationBtn').addEventListener('click', () => openReservationModal());
$('newShowBtn').addEventListener('click', () => openShowModal());
$('previousDayBtn').addEventListener('click', () => changeSelectedDate(-1));
$('nextDayBtn').addEventListener('click', () => changeSelectedDate(1));
$('todayBtn').addEventListener('click', () => {
  $('filterDate').value = todayValue();
  subscribeToReservations();
});
$('clearDateBtn').addEventListener('click', () => {
  $('filterDate').value = '';
  subscribeToReservations();
});
$('filterDate').addEventListener('change', subscribeToReservations);
$('searchInput').addEventListener('input', renderReservations);
document.querySelectorAll('[data-close-modal]').forEach((element) => element.addEventListener('click', closeReservationModal));
document.querySelectorAll('[data-close-show]').forEach((element) => element.addEventListener('click', closeShowModal));
document.querySelectorAll('[data-close-delete]').forEach((element) => element.addEventListener('click', closeDeleteModal));

reservationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError($('reservationError'));
  const name = $('resName').value.trim();
  const date = $('resDate').value;
  const time = $('resTime').value;
  const peopleCount = Number($('resPeople').value);
  const contact = $('resContact').value.trim();
  const comments = $('resComments').value.trim();
  if (!name || !date || !time || !Number.isInteger(peopleCount) || peopleCount < 1) {
    showFormError($('reservationError'), 'Completá nombre, fecha, hora y cantidad de personas.');
    return;
  }
  setButtonBusy($('saveReservationBtn'), true, 'Guardando…');
  try {
    const baseData = {
      companyId: state.userMeta.companyId,
      name,
      date,
      time,
      peopleCount,
      contact,
      comments,
      expiresAt: Timestamp.fromDate(reservationExpiry(date, time)),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    };
    if (state.editingReservation) {
      await updateDoc(doc(db, `companies/${state.userMeta.companyId}/reservations/${state.editingReservation.id}`), baseData);
      closeReservationModal();
      showToast('Reserva actualizada correctamente.');
    } else {
      const reservationRef = doc(collection(db, `companies/${state.userMeta.companyId}/reservations`));
      await setDoc(reservationRef, {
        ...baseData,
        reservationCode: `HRC-${reservationRef.id.slice(0, 8).toUpperCase()}`,
        source: 'manual',
        status: 'confirmed',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid
      });
      closeReservationModal();
      showToast('Reserva creada correctamente.');
    }
  } catch (error) {
    console.error('No se pudo guardar la reserva.', error);
    showFormError($('reservationError'), 'No se pudo guardar. Revisá los datos e intentá nuevamente.');
  } finally {
    setButtonBusy($('saveReservationBtn'), false);
  }
});

showForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError($('showError'));
  const data = {
    companyId: state.userMeta.companyId,
    date: $('showDate').value,
    time: $('showTime').value,
    name: $('showName').value.trim(),
    musicStyle: $('showMusicStyle').value.trim(),
    notes: $('showNotes').value.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid
  };
  if (!data.date || !data.time || !data.name) {
    showFormError($('showError'), 'Completá fecha, hora y nombre del show.');
    return;
  }
  setButtonBusy($('saveShowBtn'), true, 'Guardando…');
  try {
    if (state.editingShow) {
      await updateDoc(doc(db, `companies/${state.userMeta.companyId}/shows/${state.editingShow.id}`), data);
      showToast('Show actualizado. Sofía ya ve los cambios.');
    } else {
      const showRef = doc(collection(db, `companies/${state.userMeta.companyId}/shows`));
      await setDoc(showRef, { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid });
      showToast('Show agregado. Sofía ya puede informarlo.');
    }
    closeShowModal();
  } catch (error) {
    console.error('No se pudo guardar el show.', error);
    showFormError($('showError'), 'No se pudo guardar el show. Intentá nuevamente.');
  } finally {
    setButtonBusy($('saveShowBtn'), false);
  }
});

$('confirmDeleteBtn').addEventListener('click', async () => {
  if (!state.pendingDelete) return;
  const { kind, item } = state.pendingDelete;
  if (kind === 'reservation' && state.userMeta?.role !== 'admin') return;
  setButtonBusy($('confirmDeleteBtn'), true, 'Eliminando…');
  try {
    const collectionName = kind === 'reservation' ? 'reservations' : 'shows';
    await deleteDoc(doc(db, `companies/${state.userMeta.companyId}/${collectionName}/${item.id}`));
    closeDeleteModal();
    showToast(kind === 'reservation' ? 'Reserva eliminada.' : 'Show eliminado de la agenda de Sofía.');
  } catch (error) {
    console.error('No se pudo eliminar.', error);
    showToast('No se pudo eliminar el registro.', 'error');
  } finally {
    setButtonBusy($('confirmDeleteBtn'), false);
  }
});

$('sofiaToggleBtn').addEventListener('click', async () => {
  if (state.userMeta?.role !== 'admin') return;
  const button = $('sofiaToggleBtn');
  const nextEnabled = !state.sofiaEnabled;
  setButtonBusy(button, true, nextEnabled ? 'Encendiendo…' : 'Apagando…');
  try {
    const setSofiaEnabled = httpsCallable(functions, 'setSofiaEnabled');
    await setSofiaEnabled({ enabled: nextEnabled });
    showToast(nextEnabled ? 'Sofía fue encendida.' : 'Sofía fue apagada para todos los clientes.');
  } catch (error) {
    console.error('No se pudo cambiar el estado de Sofía.', error);
    showToast('No se pudo cambiar el estado de Sofía.', 'error');
    setButtonBusy(button, false);
  }
});

$('createUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setButtonBusy($('createUserBtn'), true, 'Creando…');
  try {
    const createUserByAdmin = httpsCallable(functions, 'createUserByAdmin');
    await createUserByAdmin({
      email: $('newUserEmail').value.trim(),
      password: $('newUserPassword').value,
      displayName: $('newUserName').value.trim(),
      role: $('newUserRole').value
    });
    $('createUserForm').reset();
    showToast('Usuario creado correctamente.');
  } catch (error) {
    console.error('No se pudo crear el usuario.', error);
    showToast(error.message || 'No se pudo crear el usuario.', 'error');
  } finally {
    setButtonBusy($('createUserBtn'), false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!deleteModal.classList.contains('hidden')) closeDeleteModal();
  else if (!showModal.classList.contains('hidden')) closeShowModal();
  else if (!reservationModal.classList.contains('hidden')) closeReservationModal();
});

function unsubscribeAll() {
  ['unsubscribeReservations', 'unsubscribeShows', 'unsubscribeAlerts', 'unsubscribeSofia']
    .forEach((key) => {
      if (state[key]) state[key]();
      state[key] = null;
    });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    unsubscribeAll();
    state.userMeta = null;
    state.reservations = [];
    state.shows = [];
    state.alerts = [];
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
    return;
  }
  try {
    const metaSnapshot = await getDoc(doc(db, `users/${user.uid}`));
    if (!metaSnapshot.exists()) throw new Error('Tu usuario no tiene una empresa asignada.');
    state.userMeta = metaSnapshot.data();
    $('userName').textContent = state.userMeta.displayName || user.displayName || user.email;
    $('userRole').textContent = state.userMeta.role === 'admin' ? 'Administrador' : 'Equipo';
    $('adminSection').classList.toggle('hidden', state.userMeta.role !== 'admin');
    $('todayLabel').textContent = formatLongToday();
    $('filterDate').value = todayValue();
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    renderSofiaControl();
    subscribeToReservations();
    subscribeToShows();
    subscribeToAlerts();
    subscribeToSofiaSettings();
  } catch (error) {
    console.error('No se pudo cargar el perfil.', error);
    await signOut(auth);
    showFormError($('loginError'), 'Tu usuario no está configurado correctamente. Contactá al administrador.');
  }
});
