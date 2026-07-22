import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
  editingReservation: null,
  pendingDelete: null,
  unsubscribeReservations: null,
  toastTimer: null
};

const $ = (id) => document.getElementById(id);

const loginView = $('loginView');
const appView = $('appView');
const loginForm = $('loginForm');
const reservationForm = $('reservationForm');
const reservationModal = $('reservationModal');
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
  const anyOpen = !reservationModal.classList.contains('hidden') || !deleteModal.classList.contains('hidden');
  document.body.style.overflow = anyOpen ? 'hidden' : '';
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

function openDeleteModal(reservation) {
  state.pendingDelete = reservation;
  $('deleteMessage').textContent = `Vas a eliminar la reserva de ${reservation.name}, para ${reservation.peopleCount} persona${reservation.peopleCount === 1 ? '' : 's'}, el ${formatDate(reservation.date, { includeYear: true })} a las ${reservation.time}.`;
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

function renderReservations() {
  const search = $('searchInput').value.trim().toLocaleLowerCase('es');
  const visible = state.reservations.filter((reservation) => {
    if (!search) return true;
    return [reservation.name, reservation.contact, reservation.comments]
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
    detail.textContent = reservation.id.slice(0, 7).toUpperCase();
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
      deleteButton.addEventListener('click', () => openDeleteModal(reservation));
      actions.appendChild(deleteButton);
    }

    actionsCell.appendChild(actions);
    row.append(timeCell, nameCell, peopleCell, contactCell, commentsCell, sourceCell, actionsCell);
    body.appendChild(row);
  });

  const totalPeople = visible.reduce((total, reservation) => total + Number(reservation.peopleCount || 0), 0);
  const largeGroups = visible.filter((reservation) => reservation.peopleCount > 15).length;
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
      state.reservations = snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }));
      renderReservations();
    },
    (error) => {
      console.error('No se pudieron cargar las reservas.', error);
      $('loadingState').classList.add('hidden');
      $('emptyState').classList.remove('hidden');
      $('emptyState').querySelector('h3').textContent = 'No se pudieron cargar las reservas';
      $('emptyState').querySelector('p').textContent = 'Actualizá la página o revisá tu conexión.';
      showToast('No se pudieron cargar las reservas.', 'error');
    }
  );
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

$('logoutBtn').addEventListener('click', async () => {
  await signOut(auth);
});

$('newReservationBtn').addEventListener('click', () => openReservationModal());
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

document.querySelectorAll('[data-close-modal]').forEach((element) => {
  element.addEventListener('click', closeReservationModal);
});
document.querySelectorAll('[data-close-delete]').forEach((element) => {
  element.addEventListener('click', closeDeleteModal);
});

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
      await updateDoc(
        doc(db, `companies/${state.userMeta.companyId}/reservations/${state.editingReservation.id}`),
        baseData
      );
      closeReservationModal();
      showToast('Reserva actualizada correctamente.');
    } else {
      await addDoc(collection(db, `companies/${state.userMeta.companyId}/reservations`), {
        ...baseData,
        source: 'manual',
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

$('confirmDeleteBtn').addEventListener('click', async () => {
  if (!state.pendingDelete || state.userMeta?.role !== 'admin') return;
  setButtonBusy($('confirmDeleteBtn'), true, 'Eliminando…');

  try {
    await deleteDoc(
      doc(db, `companies/${state.userMeta.companyId}/reservations/${state.pendingDelete.id}`)
    );
    closeDeleteModal();
    showToast('Reserva eliminada.');
  } catch (error) {
    console.error('No se pudo eliminar la reserva.', error);
    showToast('No se pudo eliminar la reserva.', 'error');
  } finally {
    setButtonBusy($('confirmDeleteBtn'), false);
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
  else if (!reservationModal.classList.contains('hidden')) closeReservationModal();
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (state.unsubscribeReservations) state.unsubscribeReservations();
    state.unsubscribeReservations = null;
    state.userMeta = null;
    state.reservations = [];
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
    return;
  }

  try {
    const metaSnapshot = await getDoc(doc(db, `users/${user.uid}`));
    if (!metaSnapshot.exists()) {
      throw new Error('Tu usuario no tiene una empresa asignada.');
    }

    state.userMeta = metaSnapshot.data();
    $('userName').textContent = state.userMeta.displayName || user.displayName || user.email;
    $('userRole').textContent = state.userMeta.role === 'admin' ? 'Administrador' : 'Equipo';
    $('adminSection').classList.toggle('hidden', state.userMeta.role !== 'admin');
    $('todayLabel').textContent = formatLongToday();
    $('filterDate').value = todayValue();
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    subscribeToReservations();
  } catch (error) {
    console.error('No se pudo cargar el perfil.', error);
    await signOut(auth);
    showFormError($('loginError'), 'Tu usuario no está configurado correctamente. Contactá al administrador.');
  }
});
