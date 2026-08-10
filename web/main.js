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
const SOFIA_OPERATOR_API = 'https://sofia-hrc-ushuaia-tq3aftvmdq-tl.a.run.app';

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
  conversations: [],
  selectedConversationId: null,
  messages: [],
  unsubscribeConversations: null,
  unsubscribeMessages: null,
  unsubscribeInformation: null,
  informationLoaded: false,
  activeView: 'reservations',
  toastTimer: null
};

const $ = (id) => document.getElementById(id);

const loginView = $('loginView');
const appView = $('appView');
const loginForm = $('loginForm');
const reservationForm = $('reservationForm');
const reservationModal = $('reservationModal');
const deleteModal = $('deleteModal');

const DEFAULT_INFORMATION = {
  exchangeRates: { USD: 1500, EUR: 1700, BRL: 290, updatedAt: '2026-07-21' },
  openingHours: {
    sundayThursday: { restaurant: '11:30-23:59', rockShop: '10:30-23:59' },
    fridaySaturday: { restaurant: '11:30-01:00', rockShop: '10:30-01:00' }
  },
  contact: {
    address: 'Av. San Martín 594, Ushuaia, Tierra del Fuego, Argentina',
    phone: '',
    menuUrl: 'https://drive.google.com/file/d/1kyFcII3wQ_WsUisn4XYvn7QF-hPwK7dh/view?usp=drivesdk'
  },
  reservationRules: {
    dailyLimit: 50,
    sameDayCutoff: '16:30',
    restaurantMinPeople: 1,
    bowlingMinPeople: 6,
    bowlingMaxPeople: 12,
    areasNotes: ''
  },
  promotions: '',
  menu: '',
  policies: '',
  generalInformation: ''
};

function firestoreDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value, options = {}) {
  const date = firestoreDate(value);
  if (!date) return options.fallback || '';
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: RESTAURANT_TIME_ZONE,
    day: options.includeDate ? '2-digit' : undefined,
    month: options.includeDate ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}

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

function switchView(viewName) {
  if (!['reservations', 'conversations', 'information'].includes(viewName)) return;
  state.activeView = viewName;
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('nav-tab--active', button.dataset.view === viewName);
  });
  $('reservationsView').classList.toggle('hidden', viewName !== 'reservations');
  $('conversationsView').classList.toggle('hidden', viewName !== 'conversations');
  $('informationView').classList.toggle('hidden', viewName !== 'information');

  if (viewName === 'conversations' && !state.unsubscribeConversations) {
    subscribeToConversations();
  }
  if (viewName === 'information' && !state.unsubscribeInformation) {
    subscribeToInformation();
  }
}

async function callSofiaOperator(path, payload) {
  if (!auth.currentUser) throw new Error('La sesión venció. Volvé a ingresar.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${SOFIA_OPERATOR_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || 'No se pudo completar la acción con Sofía.');
  }
  return body;
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

function conversationStatus(conversation) {
  if (conversation.conversationStatus === 'closed') return 'closed';
  if (conversation.paused || conversation.conversationStatus === 'human') return 'human';
  return 'sofia';
}

function conversationStatusLabel(status) {
  return {
    sofia: 'Atendiendo Sofía',
    human: 'Pendiente humano',
    closed: 'Finalizada'
  }[status] || 'Atendiendo Sofía';
}

function conversationTags(conversation) {
  const tags = new Set(Array.isArray(conversation.tags) ? conversation.tags : []);
  if (conversation.reservationDraft || conversation.lastReservationEvent) tags.add('reservation');
  if (conversation.paused || conversation.activeAlertId) tags.add('handoff');
  if (!tags.size) tags.add('consultation');
  return [...tags];
}

function lastConversationMessage(conversation) {
  if (conversation.lastMessage) return conversation.lastMessage;
  const history = Array.isArray(conversation.history) ? conversation.history : [];
  return history.at(-1)?.content || 'Sin mensajes registrados';
}

function conversationUpdatedAt(conversation) {
  return firestoreDate(
    conversation.lastMessageAt || conversation.updatedAt || conversation.updated_at
  );
}

function displayPhone(value) {
  const raw = String(value || '').trim();
  return /^\d{8,15}$/.test(raw) ? `+${raw}` : raw;
}

function createStatusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `conversation-status conversation-status--${status}`;
  badge.textContent = conversationStatusLabel(status);
  return badge;
}

function createConversationTag(tag) {
  const labels = { reservation: 'Reserva', consultation: 'Consulta', handoff: 'Derivación' };
  const badge = document.createElement('span');
  badge.className = 'conversation-tag';
  badge.textContent = labels[tag] || tag;
  return badge;
}

function renderConversationList() {
  const search = $('conversationSearch').value.trim().toLocaleLowerCase('es');
  const filter = $('conversationFilter').value;
  const visible = state.conversations.filter((conversation) => {
    const matchesSearch = !search || [conversation.id, conversation.phone, lastConversationMessage(conversation)]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('es').includes(search));
    const tags = conversationTags(conversation);
    return matchesSearch && (filter === 'all' || tags.includes(filter));
  });

  const list = $('conversationList');
  list.replaceChildren();
  visible.forEach((conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `conversation-item${conversation.id === state.selectedConversationId ? ' conversation-item--active' : ''}`;
    button.addEventListener('click', () => selectConversation(conversation.id));

    const avatar = document.createElement('span');
    avatar.className = 'conversation-avatar';
    avatar.textContent = 'WA';

    const content = document.createElement('span');
    content.className = 'conversation-item__content';
    const top = document.createElement('span');
    top.className = 'conversation-item__top';
    const phone = document.createElement('strong');
    phone.textContent = displayPhone(conversation.phone || conversation.id);
    const time = document.createElement('span');
    time.className = 'conversation-item__time';
    time.textContent = formatDateTime(conversationUpdatedAt(conversation), { includeDate: true });
    top.append(phone, time);

    const message = document.createElement('span');
    message.className = 'conversation-item__message';
    message.textContent = lastConversationMessage(conversation);
    const badges = document.createElement('span');
    badges.className = 'conversation-item__badges';
    badges.appendChild(createStatusBadge(conversationStatus(conversation)));
    conversationTags(conversation).slice(0, 2).forEach((tag) => badges.appendChild(createConversationTag(tag)));
    content.append(top, message, badges);
    button.append(avatar, content);
    list.appendChild(button);
  });

  $('conversationsLoading').classList.add('hidden');
  $('conversationsEmpty').classList.toggle('hidden', visible.length > 0);
  const pendingCount = state.conversations.filter((item) => conversationStatus(item) === 'human').length;
  $('pendingConversationCount').textContent = String(pendingCount);
  $('pendingConversationCount').classList.toggle('hidden', pendingCount === 0);
}

function subscribeToConversations() {
  if (!state.userMeta || state.unsubscribeConversations) return;
  $('conversationsLoading').classList.remove('hidden');
  const conversationsRef = collection(
    db,
    `companies/${state.userMeta.companyId}/sofiaConversations`
  );
  state.unsubscribeConversations = onSnapshot(
    conversationsRef,
    (snapshot) => {
      state.conversations = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((conversation) => (
          conversation.channel === 'whatsapp' || /^\d{8,15}$/.test(conversation.id)
        ))
        .sort((a, b) => (
          (conversationUpdatedAt(b)?.getTime() || 0) - (conversationUpdatedAt(a)?.getTime() || 0)
        ));
      if (
        state.selectedConversationId
        && !state.conversations.some((item) => item.id === state.selectedConversationId)
      ) {
        clearSelectedConversation();
      }
      renderConversationList();
      renderActiveConversationHeader();
    },
    (error) => {
      console.error('No se pudieron cargar las conversaciones.', error);
      $('conversationsLoading').classList.add('hidden');
      $('conversationsEmpty').classList.remove('hidden');
      showToast('No se pudieron cargar las conversaciones.', 'error');
    }
  );
}

function selectedConversation() {
  return state.conversations.find((item) => item.id === state.selectedConversationId) || null;
}

function renderReservationEvent(conversation) {
  const badge = $('chatReservationEvent');
  const event = conversation?.lastReservationEvent;
  if (!event?.type) {
    badge.className = 'reservation-event hidden';
    badge.textContent = '';
    return;
  }
  const labels = {
    created: 'Reserva creada',
    modified: 'Reserva modificada',
    cancelled: 'Reserva cancelada'
  };
  badge.className = `reservation-event${event.type === 'cancelled' ? ' reservation-event--cancelled' : ''}`;
  badge.textContent = `${labels[event.type] || 'Reserva'}${event.reservationCode ? ` · ${event.reservationCode}` : ''}`;
}

function renderActiveConversationHeader() {
  const conversation = selectedConversation();
  if (!conversation) return;
  $('chatPhone').textContent = displayPhone(conversation.phone || conversation.id);
  const status = conversationStatus(conversation);
  const statusContainer = $('chatStatus');
  statusContainer.className = `conversation-status conversation-status--${status}`;
  statusContainer.textContent = conversationStatusLabel(status);
  $('pauseSofiaBtn').classList.toggle('hidden', status !== 'sofia');
  $('resumeSofiaBtn').classList.toggle('hidden', status === 'sofia');
  $('resumeSofiaBtn').textContent = status === 'closed' ? 'Reabrir con Sofía' : 'Devolver a Sofía';
  $('closeConversationBtn').classList.toggle('hidden', status === 'closed');
  $('manualReplyText').disabled = status === 'closed';
  $('sendManualReplyBtn').disabled = status === 'closed';
  $('manualReplyText').placeholder = status === 'closed'
    ? 'La conversación está finalizada. Un nuevo mensaje del cliente la reabrirá.'
    : 'Escribí una respuesta como equipo de Hard Rock…';
  renderReservationEvent(conversation);
}

function clearSelectedConversation() {
  if (state.unsubscribeMessages) state.unsubscribeMessages();
  state.unsubscribeMessages = null;
  state.selectedConversationId = null;
  state.messages = [];
  $('activeChat').classList.add('hidden');
  $('chatPlaceholder').classList.remove('hidden');
}

function selectConversation(conversationId) {
  if (state.selectedConversationId === conversationId && state.unsubscribeMessages) return;
  if (state.unsubscribeMessages) state.unsubscribeMessages();
  state.selectedConversationId = conversationId;
  state.messages = [];
  $('chatPlaceholder').classList.add('hidden');
  $('activeChat').classList.remove('hidden');
  renderConversationList();
  renderActiveConversationHeader();
  $('messageList').replaceChildren();

  const messagesRef = collection(
    db,
    `companies/${state.userMeta.companyId}/sofiaConversations/${conversationId}/messages`
  );
  state.unsubscribeMessages = onSnapshot(
    query(messagesRef, orderBy('createdAt')),
    (snapshot) => {
      state.messages = snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }));
      renderMessages();
    },
    (error) => {
      console.error('No se pudo cargar el historial.', error);
      showToast('No se pudo cargar el historial completo.', 'error');
    }
  );
}

function legacyConversationMessages(conversation) {
  if (!conversation || conversation.messageLogVersion) return [];
  const history = Array.isArray(conversation.history) ? conversation.history : [];
  const baseTime = conversationUpdatedAt(conversation) || new Date();
  return history.map((item, index) => ({
    id: `legacy-${index}`,
    text: item.content || '',
    direction: item.role === 'user' ? 'incoming' : 'outgoing',
    actor: item.role === 'user' ? 'customer' : 'sofia',
    createdAt: new Date(baseTime.getTime() - ((history.length - index) * 1000)),
    imported: true
  }));
}

function renderMessages() {
  const conversation = selectedConversation();
  const messages = state.messages.length ? state.messages : legacyConversationMessages(conversation);
  const list = $('messageList');
  list.replaceChildren();
  messages.forEach((message) => {
    const row = document.createElement('article');
    const direction = message.direction || (message.actor === 'customer' ? 'incoming' : 'outgoing');
    row.className = `message-row message-row--${direction}`;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble${message.actor === 'human' ? ' message-bubble--human' : ''}`;
    const text = document.createElement('p');
    text.textContent = message.text || '';
    const footer = document.createElement('footer');
    const actor = document.createElement('span');
    actor.textContent = message.actor === 'human'
      ? (message.operatorName || 'Equipo HRC')
      : message.actor === 'sofia' ? 'Sofía' : 'Cliente';
    const time = document.createElement('time');
    time.textContent = `${message.imported ? 'Historial anterior · ' : ''}${formatDateTime(message.createdAt, { includeDate: true, fallback: 'Sin hora' })}`;
    footer.append(actor, time);
    bubble.append(text, footer);
    row.appendChild(bubble);
    list.appendChild(row);
  });
  requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
}

async function setConversationStatus(status, button) {
  if (!state.selectedConversationId) return;
  setButtonBusy(button, true, 'Guardando…');
  try {
    await callSofiaOperator(
      `/api/operator/conversations/${encodeURIComponent(state.selectedConversationId)}/status`,
      { status }
    );
    const messages = {
      sofia: 'La conversación volvió a Sofía.',
      human: 'Sofía quedó pausada en esta conversación.',
      closed: 'Conversación finalizada.'
    };
    showToast(messages[status]);
  } catch (error) {
    console.error('No se pudo cambiar el estado.', error);
    showToast(error.message, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

function mergeInformation(information = {}) {
  return {
    ...DEFAULT_INFORMATION,
    ...information,
    exchangeRates: { ...DEFAULT_INFORMATION.exchangeRates, ...(information.exchangeRates || {}) },
    openingHours: {
      sundayThursday: {
        ...DEFAULT_INFORMATION.openingHours.sundayThursday,
        ...(information.openingHours?.sundayThursday || {})
      },
      fridaySaturday: {
        ...DEFAULT_INFORMATION.openingHours.fridaySaturday,
        ...(information.openingHours?.fridaySaturday || {})
      }
    },
    contact: { ...DEFAULT_INFORMATION.contact, ...(information.contact || {}) },
    reservationRules: {
      ...DEFAULT_INFORMATION.reservationRules,
      ...(information.reservationRules || {})
    }
  };
}

function fillInformationForm(rawInformation) {
  const information = mergeInformation(rawInformation);
  $('infoUsd').value = information.exchangeRates.USD;
  $('infoEur').value = information.exchangeRates.EUR;
  $('infoBrl').value = information.exchangeRates.BRL;
  $('infoRatesUpdatedAt').value = information.exchangeRates.updatedAt;
  $('infoSunThuRestaurant').value = information.openingHours.sundayThursday.restaurant;
  $('infoSunThuRockShop').value = information.openingHours.sundayThursday.rockShop;
  $('infoFriSatRestaurant').value = information.openingHours.fridaySaturday.restaurant;
  $('infoFriSatRockShop').value = information.openingHours.fridaySaturday.rockShop;
  $('infoAddress').value = information.contact.address;
  $('infoPhone').value = information.contact.phone;
  $('infoMenuUrl').value = information.contact.menuUrl;
  $('infoDailyLimit').value = information.reservationRules.dailyLimit;
  $('infoSameDayCutoff').value = information.reservationRules.sameDayCutoff;
  $('infoRestaurantMin').value = information.reservationRules.restaurantMinPeople;
  $('infoBowlingMin').value = information.reservationRules.bowlingMinPeople;
  $('infoBowlingMax').value = information.reservationRules.bowlingMaxPeople;
  $('infoAreasNotes').value = information.reservationRules.areasNotes;
  $('infoPromotions').value = information.promotions;
  $('infoMenu').value = information.menu;
  $('infoPolicies').value = information.policies;
  $('infoGeneral').value = information.generalInformation;

  const updated = firestoreDate(rawInformation?.updatedAt);
  $('informationUpdatedAt').textContent = updated
    ? `Último cambio: ${formatDateTime(updated, { includeDate: true })}${rawInformation.updatedByName ? ` · ${rawInformation.updatedByName}` : ''}`
    : 'Todavía usa la configuración base';
}

function setInformationPermissions() {
  const canEdit = state.userMeta?.role === 'admin';
  $('saveInformationBtn').classList.toggle('hidden', !canEdit);
  $('informationForm').querySelectorAll('input, textarea').forEach((field) => {
    field.disabled = !canEdit;
  });
}

function subscribeToInformation() {
  if (!state.userMeta || state.unsubscribeInformation) return;
  const informationRef = doc(
    db,
    `companies/${state.userMeta.companyId}/sofiaInformation/current`
  );
  state.unsubscribeInformation = onSnapshot(
    informationRef,
    (snapshot) => {
      state.informationLoaded = true;
      fillInformationForm(snapshot.exists() ? snapshot.data() : {});
      setInformationPermissions();
    },
    (error) => {
      console.error('No se pudo cargar la información de Sofía.', error);
      showToast('No se pudo cargar la información de Sofía.', 'error');
    }
  );
}

function informationPayload() {
  const bowlingMin = Number($('infoBowlingMin').value);
  const bowlingMax = Number($('infoBowlingMax').value);
  if (bowlingMax < bowlingMin) {
    throw new Error('El máximo automático de bowling no puede ser menor que el mínimo.');
  }
  return {
    companyId: state.userMeta.companyId,
    exchangeRates: {
      USD: Number($('infoUsd').value),
      EUR: Number($('infoEur').value),
      BRL: Number($('infoBrl').value),
      updatedAt: $('infoRatesUpdatedAt').value
    },
    openingHours: {
      sundayThursday: {
        restaurant: $('infoSunThuRestaurant').value.trim(),
        rockShop: $('infoSunThuRockShop').value.trim()
      },
      fridaySaturday: {
        restaurant: $('infoFriSatRestaurant').value.trim(),
        rockShop: $('infoFriSatRockShop').value.trim()
      }
    },
    contact: {
      address: $('infoAddress').value.trim(),
      phone: $('infoPhone').value.trim(),
      menuUrl: $('infoMenuUrl').value.trim()
    },
    reservationRules: {
      dailyLimit: Number($('infoDailyLimit').value),
      sameDayCutoff: $('infoSameDayCutoff').value,
      restaurantMinPeople: Number($('infoRestaurantMin').value),
      bowlingMinPeople: bowlingMin,
      bowlingMaxPeople: bowlingMax,
      areasNotes: $('infoAreasNotes').value.trim()
    },
    promotions: $('infoPromotions').value.trim(),
    menu: $('infoMenu').value.trim(),
    policies: $('infoPolicies').value.trim(),
    generalInformation: $('infoGeneral').value.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
    updatedByName: state.userMeta.displayName || auth.currentUser.email
  };
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
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});
$('conversationSearch').addEventListener('input', renderConversationList);
$('conversationFilter').addEventListener('change', renderConversationList);
$('pauseSofiaBtn').addEventListener('click', () => setConversationStatus('human', $('pauseSofiaBtn')));
$('resumeSofiaBtn').addEventListener('click', () => setConversationStatus('sofia', $('resumeSofiaBtn')));
$('closeConversationBtn').addEventListener('click', () => setConversationStatus('closed', $('closeConversationBtn')));

$('manualReplyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedConversationId) return;
  const text = $('manualReplyText').value.trim();
  if (!text) return;
  setButtonBusy($('sendManualReplyBtn'), true, 'Enviando…');
  try {
    await callSofiaOperator(
      `/api/operator/conversations/${encodeURIComponent(state.selectedConversationId)}/messages`,
      { text }
    );
    $('manualReplyText').value = '';
    showToast('Mensaje enviado desde el número de Sofía.');
  } catch (error) {
    console.error('No se pudo enviar el mensaje manual.', error);
    showToast(error.message, 'error');
  } finally {
    setButtonBusy($('sendManualReplyBtn'), false);
  }
});

$('informationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.userMeta?.role !== 'admin') return;
  setButtonBusy($('saveInformationBtn'), true, 'Guardando…');
  try {
    const informationRef = doc(
      db,
      `companies/${state.userMeta.companyId}/sofiaInformation/current`
    );
    await setDoc(informationRef, informationPayload(), { merge: true });
    showToast('Información actualizada. Sofía ya utiliza estos datos.');
  } catch (error) {
    console.error('No se pudo guardar la información.', error);
    showToast(error.message || 'No se pudo guardar la información.', 'error');
  } finally {
    setButtonBusy($('saveInformationBtn'), false);
  }
});

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
    if (state.unsubscribeConversations) state.unsubscribeConversations();
    if (state.unsubscribeMessages) state.unsubscribeMessages();
    if (state.unsubscribeInformation) state.unsubscribeInformation();
    state.unsubscribeReservations = null;
    state.unsubscribeConversations = null;
    state.unsubscribeMessages = null;
    state.unsubscribeInformation = null;
    state.userMeta = null;
    state.reservations = [];
    state.conversations = [];
    state.messages = [];
    state.selectedConversationId = null;
    state.informationLoaded = false;
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
    setInformationPermissions();
    $('todayLabel').textContent = formatLongToday();
    $('filterDate').value = todayValue();
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    switchView('reservations');
    subscribeToReservations();
    subscribeToConversations();
  } catch (error) {
    console.error('No se pudo cargar el perfil.', error);
    await signOut(auth);
    showFormError($('loginError'), 'Tu usuario no está configurado correctamente. Contactá al administrador.');
  }
});
