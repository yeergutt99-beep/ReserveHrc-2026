import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'REEMPLAZAR_API_KEY',
  authDomain: 'REEMPLAZAR_AUTH_DOMAIN',
  projectId: 'REEMPLAZAR_PROJECT_ID'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

let currentUserMeta = null;

const $ = (id) => document.getElementById(id);

$('loginBtn').onclick = async () => {
  await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
};

$('createReservationBtn').onclick = async () => {
  const companyId = currentUserMeta.companyId;
  await addDoc(collection(db, `companies/${companyId}/reservations`), {
    companyId,
    name: $('resName').value,
    peopleCount: Number($('resPeople').value),
    date: $('resDate').value,
    time: $('resTime').value,
    comments: $('resComments').value,
    createdBy: auth.currentUser.uid,
    createdAt: serverTimestamp()
  });
  alert('Reserva guardada');
  await loadReservations();
};

$('loadReservationsBtn').onclick = loadReservations;

$('createUserBtn').onclick = async () => {
  const createUserByAdmin = httpsCallable(functions, 'createUserByAdmin');
  await createUserByAdmin({
    email: $('newUserEmail').value,
    password: $('newUserPassword').value,
    displayName: $('newUserName').value,
    role: $('newUserRole').value
  });
  alert('Usuario creado');
};

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const metaSnap = await getDoc(doc(db, `users/${user.uid}`));
  currentUserMeta = metaSnap.data();

  $('loginSection').classList.add('hidden');
  $('appSection').classList.remove('hidden');

  if (currentUserMeta.role !== 'admin') {
    $('adminSection').classList.add('hidden');
  }

  await loadReservations();
});

async function loadReservations() {
  const companyId = currentUserMeta.companyId;
  const dateFilter = $('filterDate').value;
  let q = query(collection(db, `companies/${companyId}/reservations`), orderBy('date'), orderBy('time'));
  if (dateFilter) {
    q = query(collection(db, `companies/${companyId}/reservations`), where('date', '==', dateFilter), orderBy('time'));
  }

  const snap = await getDocs(q);
  $('reservationsList').innerHTML = '';
  snap.forEach((docu) => {
    const r = docu.data();
    const li = document.createElement('li');
    li.textContent = `${r.date} ${r.time} - ${r.name} - ${r.peopleCount} personas`;
    $('reservationsList').appendChild(li);
  });
}
