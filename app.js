import { initializeApp }       from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";

// ── Config ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyB5dmG3a12WDdE13jzKTfv9C65igNmhveU",
  authDomain:        "birdy---to-do-s.firebaseapp.com",
  projectId:         "birdy---to-do-s",
  storageBucket:     "birdy---to-do-s.firebasestorage.app",
  messagingSenderId: "564307060103",
  appId:             "1:564307060103:web:45f9c3a0b5ba4d14131f22"
};

const fbApp    = initializeApp(firebaseConfig);
const auth     = getAuth(fbApp);
const db       = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// ── Estado ────────────────────────────────────────────────────
const CATS = {
  prazo:      { label: 'Prazo judicial', icon: '⚖️',  cls: 'prazo' },
  contrato:   { label: 'Contrato',       icon: '📄',  cls: 'contrato' },
  cartorio:   { label: 'Cartório',       icon: '🏛️', cls: 'cartorio' },
  societario: { label: 'Societário',     icon: '🏢',  cls: 'societario' },
  email:      { label: 'E-mail',         icon: '✉️',  cls: 'email' },
  reuniao:    { label: 'Reunião',        icon: '🤝',  cls: 'reuniao' },
  outro:      { label: 'Outro',          icon: '📌',  cls: 'outro' },
};
const PRIO = {
  alta:  { color: '#E24B4A' },
  media: { color: '#BA7517' },
  baixa: { color: '#B4B2A9' },
};
let tasks = [], view = 'pending', filterCat = 'all', sortBy = 'prio', editId = null;
let unsubTasks = null;
let searchQuery = '';
let detailTaskId = null, unsubNotes = null, selectedNoteColor = '#FEF08A';

const NOTE_COLORS = ['#FEF08A', '#93C5FD', '#F9A8D4', '#86EFAC', '#FCD34D', '#C4B5FD'];

// ── Auth ──────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').style.display = '';
    document.getElementById('fab').style.display = '';
    document.getElementById('user-name').textContent = user.displayName || user.email;
    document.getElementById('user-avatar').src = user.photoURL || '';
    document.getElementById('user-avatar').style.display = user.photoURL ? '' : 'none';
    startListening(user.uid);
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('fab').style.display = 'none';
    if (unsubTasks) { unsubTasks(); unsubTasks = null; }
    tasks = [];
  }
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    showToast('Erro ao fazer login. Tente novamente.');
  }
});

window.doLogout = async function () {
  await signOut(auth);
};

// ── Firestore ─────────────────────────────────────────────────
function startListening(uid) {
  if (unsubTasks) unsubTasks();
  const COL = collection(db, 'users', uid, 'tasks');
  unsubTasks = onSnapshot(COL,
    snap => {
      tasks = snap.docs.map(d => ({ ...d.data(), _id: d.id, _col: COL }));
      setSyncStatus('ok', 'Sincronizado');
      render();
    },
    err => {
      console.error(err);
      setSyncStatus('err', 'Erro de conexão');
    }
  );
}

function getUserCol() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return collection(db, 'users', uid, 'tasks');
}

// ── Helpers ───────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }

function fmtDate(d) {
  if (!d) return null;
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

function dateStatus(d) {
  if (!d) return null;
  const t = today();
  if (d < t) return 'overdue';
  if (d === t) return 'today';
  if ((new Date(d) - new Date(t)) / 86400000 <= 3) return 'soon';
  return 'normal';
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setSyncStatus(state, label) {
  document.getElementById('sync-dot').className = 'sync-dot ' + state;
  document.getElementById('sync-label').textContent = label;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Modal ─────────────────────────────────────────────────────
window.openModal = function (id) {
  editId = id || null;
  const t = id ? tasks.find(x => x._id === id) : null;
  document.getElementById('modal-title-el').textContent = id ? 'Editar tarefa' : 'Nova tarefa';
  document.getElementById('modal-save-btn').querySelector('.btn-label').textContent = id ? 'Salvar' : 'Adicionar';
  document.getElementById('m-title').value = t ? t.title : '';
  document.getElementById('m-cat').value   = t ? t.cat   : 'prazo';
  document.getElementById('m-prio').value  = t ? t.prio  : 'alta';
  document.getElementById('m-date').value  = t ? (t.date || '') : '';
  document.getElementById('m-note').value  = t ? (t.note || '') : '';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('m-title').focus(), 100);
};

window.closeModal = function () {
  document.getElementById('modal-overlay').classList.remove('open');
  editId = null;
};

window.handleOverlayClick = function (e) {
  if (e.target.id === 'modal-overlay') closeModal();
};

window.saveModal = async function () {
  const title = document.getElementById('m-title').value.trim();
  if (!title) { document.getElementById('m-title').focus(); return; }
  const COL = getUserCol(); if (!COL) return;
  const btn = document.getElementById('modal-save-btn');
  btn.classList.add('loading');
  const data = {
    title,
    cat:  document.getElementById('m-cat').value,
    prio: document.getElementById('m-prio').value,
    date: document.getElementById('m-date').value,
    note: document.getElementById('m-note').value.trim(),
  };
  try {
    if (editId) {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'tasks', editId), data);
      showToast('Tarefa atualizada');
    } else {
      data.done = false; data.doneAt = null; data.added = serverTimestamp();
      await addDoc(COL, data);
      showToast('Tarefa adicionada');
    }
    closeModal();
  } catch (e) {
    console.error(e);
    showToast('Erro ao salvar. Tente novamente.');
  } finally {
    btn.classList.remove('loading');
  }
};

window.toggleDone = async function (id) {
  const t = tasks.find(x => x._id === id); if (!t) return;
  const done = !t.done;
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid, 'tasks', id), { done, doneAt: done ? Date.now() : null });
  } catch (e) { showToast('Erro ao atualizar.'); }
};

window.deleteTask = async function (id) {
  if (!confirm('Excluir esta tarefa?')) return;
  try {
    await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'tasks', id));
    showToast('Tarefa excluída');
  } catch (e) { showToast('Erro ao excluir.'); }
};

window.setView = function (v) {
  view = v;
  ['pending', 'today', 'done'].forEach(x => document.getElementById('tab-' + x).classList.toggle('active', x === v));
  render();
};

// ── Render ────────────────────────────────────────────────────
function getVisible() {
  let list = tasks.filter(t => {
    if (view === 'pending') return !t.done;
    if (view === 'done') return t.done;
    const s = dateStatus(t.date);
    return !t.done && (s === 'overdue' || s === 'today' || s === 'soon' || t.prio === 'alta');
  });
  if (filterCat !== 'all') list = list.filter(t => t.cat === filterCat);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q));
  }
  return [...list].sort((a, b) => {
    if (sortBy === 'prio') { const p = { alta: 0, media: 1, baixa: 2 }; return (p[a.prio] || 0) - (p[b.prio] || 0) || (a.date || 'z').localeCompare(b.date || 'z'); }
    if (sortBy === 'date') return (a.date || 'z').localeCompare(b.date || 'z');
    if (sortBy === 'cat')  return a.cat.localeCompare(b.cat);
    return (b.added?.seconds || 0) - (a.added?.seconds || 0);
  });
}

function renderStats() {
  const pend  = tasks.filter(x => !x.done);
  const urg   = pend.filter(x => { const s = dateStatus(x.date); return x.prio === 'alta' || s === 'overdue' || s === 'today' || s === 'soon'; });
  const tod   = pend.filter(x => { const s = dateStatus(x.date); return s === 'overdue' || s === 'today'; });
  const done7 = tasks.filter(x => x.done && x.doneAt && Date.now() - x.doneAt < 7 * 86400000);
  document.getElementById('stats').innerHTML =
    `<div class="stat"><div class="stat-n">${pend.length}</div><div class="stat-l">Pendentes</div></div>` +
    `<div class="stat"><div class="stat-n red">${urg.length}</div><div class="stat-l">Urgentes</div></div>` +
    `<div class="stat"><div class="stat-n amber">${tod.length}</div><div class="stat-l">Para hoje</div></div>` +
    `<div class="stat"><div class="stat-n green">${done7.length}</div><div class="stat-l">Concluídas 7d</div></div>`;
}

function renderFilters() {
  const used = Object.keys(CATS).filter(c => tasks.some(t => t.cat === c));
  document.getElementById('filters').innerHTML =
    `<span class="chip all${filterCat === 'all' ? ' sel' : ''}" onclick="filterCat='all';render()">Todas</span>` +
    used.map(c => `<span class="chip ${CATS[c].cls}${filterCat === c ? ' sel' : ''}" onclick="filterCat='${c}';render()">${CATS[c].icon} ${CATS[c].label}</span>`).join('');
}

function taskHtml(t) {
  const s  = dateStatus(t.date);
  const pc = PRIO[t.prio] || PRIO.media;
  const dc = s === 'overdue' ? 'overdue' : s === 'today' ? 'today' : s === 'soon' ? 'soon' : '';
  const di = s === 'overdue' ? 'ti-alert-triangle' : s === 'today' ? 'ti-calendar-event' : 'ti-calendar';
  const dt = t.date
    ? `<span class="task-date ${dc}"><i class="ti ${di}" style="font-size:12px"></i> ${s === 'overdue' ? 'Venceu ' + fmtDate(t.date) : s === 'today' ? 'Hoje' : fmtDate(t.date)}</span>`
    : '';
  return `<div class="task-card${t.done ? ' done' : ''}">` +
    `<div class="prio-bar" style="background:${t.done ? 'var(--border)' : pc.color}"></div>` +
    `<div class="cb${t.done ? ' checked' : ''}" onclick="toggleDone('${t._id}')" role="checkbox" aria-checked="${t.done}" tabindex="0" onkeydown="if(event.key===' '||event.key==='Enter')toggleDone('${t._id}')">${t.done ? '<i class="ti ti-check" style="font-size:11px;color:var(--bg)"></i>' : ''}</div>` +
    `<div class="task-body" onclick="openDetail('${t._id}')" style="cursor:pointer">` +
      `<div class="task-title">${esc(t.title)}</div>` +
      `<div class="task-meta"><span class="chip ${CATS[t.cat]?.cls || 'outro'}" style="font-size:11px;padding:2px 7px">${CATS[t.cat]?.icon || ''} ${CATS[t.cat]?.label || t.cat}</span>${dt}</div>` +
      (t.note ? `<div class="task-note">${esc(t.note)}</div>` : '') +
    `</div>` +
    `<div class="task-actions">` +
      `<button class="icon-btn" onclick="openModal('${t._id}')" aria-label="Editar"><i class="ti ti-edit"></i></button>` +
      `<button class="icon-btn" onclick="deleteTask('${t._id}')" aria-label="Excluir"><i class="ti ti-trash"></i></button>` +
    `</div></div>`;
}

function renderList() {
  const el   = document.getElementById('list');
  const list = getVisible();
  if (!list.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-mood-smile"></i>${
      view === 'done'  ? 'Nenhuma tarefa concluída ainda.' :
      view === 'today' ? 'Nenhuma tarefa urgente ou para hoje!' :
                         'Nenhuma tarefa pendente. Bom trabalho!'
    }</div>`;
    return;
  }
  let html = '';
  if (view === 'pending') {
    const over = list.filter(t => dateStatus(t.date) === 'overdue');
    const rest = list.filter(t => dateStatus(t.date) !== 'overdue');
    if (over.length) {
      html += `<div class="section-label"><i class="ti ti-alert-circle" style="font-size:13px"></i>Vencidas</div>`;
      over.forEach(t => { html += taskHtml(t); });
      if (rest.length) html += `<div class="section-label" style="margin-top:1.25rem">Demais tarefas</div>`;
    }
    rest.forEach(t => { html += taskHtml(t); });
  } else {
    list.forEach(t => { html += taskHtml(t); });
  }
  el.innerHTML = html;
}

window.render = function () { renderStats(); renderFilters(); renderList(); };

// ── Data no header ────────────────────────────────────────────
(function () {
  const d     = new Date();
  const dias  = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  document.getElementById('date-label').textContent = `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
})();

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDetail(); } });

// ── Busca ─────────────────────────────────────────────────────
window.setSearch = function (val) {
  searchQuery = val;
  document.getElementById('search-clear').style.display = val ? '' : 'none';
  render();
};

window.clearSearch = function () {
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  render();
};

// ── Modal de detalhes ─────────────────────────────────────────
window.openDetail = function (id) {
  const t = tasks.find(x => x._id === id);
  if (!t) return;
  detailTaskId = id;

  document.getElementById('detail-title').textContent = t.title;

  const s  = dateStatus(t.date);
  const pc = PRIO[t.prio] || PRIO.media;
  const dc = s === 'overdue' ? 'overdue' : s === 'today' ? 'today' : s === 'soon' ? 'soon' : '';
  const di = s === 'overdue' ? 'ti-alert-triangle' : s === 'today' ? 'ti-calendar-event' : 'ti-calendar';
  const prioLabel = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[t.prio] || t.prio;
  document.getElementById('detail-meta').innerHTML =
    `<span class="chip ${CATS[t.cat]?.cls || 'outro'}">${CATS[t.cat]?.icon || ''} ${CATS[t.cat]?.label || t.cat}</span>` +
    `<span style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2)"><span style="width:8px;height:8px;border-radius:50%;background:${pc.color};display:inline-block;flex-shrink:0"></span>${prioLabel}</span>` +
    (t.date ? `<span class="task-date ${dc}"><i class="ti ${di}" style="font-size:12px"></i> ${s === 'overdue' ? 'Venceu ' + fmtDate(t.date) : s === 'today' ? 'Hoje' : fmtDate(t.date)}</span>` : '');

  const noteEl = document.getElementById('detail-note-text');
  noteEl.textContent = t.note || '';
  noteEl.style.display = t.note ? '' : 'none';

  document.getElementById('detail-edit-btn').onclick = () => { closeDetail(); openModal(id); };
  document.getElementById('note-form').style.display = 'none';
  document.getElementById('note-text-input').value = '';
  initNoteColors();

  document.getElementById('detail-overlay').classList.add('open');
  startListeningNotes(id);
};

window.closeDetail = function () {
  document.getElementById('detail-overlay').classList.remove('open');
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
  detailTaskId = null;
};

window.handleDetailOverlayClick = function (e) {
  if (e.target.id === 'detail-overlay') closeDetail();
};

// ── Post-its ──────────────────────────────────────────────────
function startListeningNotes(taskId) {
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const col = collection(db, 'users', uid, 'tasks', taskId, 'notes');
  unsubNotes = onSnapshot(col, snap => {
    const notes = snap.docs.map(d => ({ ...d.data(), _id: d.id }))
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    renderNotes(notes, taskId);
  });
}

function renderNotes(notes, taskId) {
  const board = document.getElementById('postit-board');
  if (!notes.length) {
    board.innerHTML = '<span class="postit-empty">Nenhum post-it ainda. Adicione o primeiro!</span>';
    return;
  }
  board.innerHTML = notes.map(n => {
    const rot  = n.rotation || 0;
    const date = n.createdAt
      ? new Date(n.createdAt.seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : '';
    return `<div class="postit" style="background:${n.color};transform:rotate(${rot}deg)">` +
      `<div class="postit-text">${esc(n.text)}</div>` +
      `<span class="postit-date">${date}</span>` +
      `<button class="postit-delete" onclick="deleteNote('${taskId}','${n._id}')" aria-label="Excluir post-it"><i class="ti ti-x"></i></button>` +
      `</div>`;
  }).join('');
}

function initNoteColors() {
  selectedNoteColor = NOTE_COLORS[0];
  document.getElementById('note-colors').innerHTML = NOTE_COLORS.map((c, i) =>
    `<button class="note-color-btn${i === 0 ? ' sel' : ''}" style="background:${c}" onclick="selectNoteColor('${c}',this)" aria-label="Cor ${i + 1}"></button>`
  ).join('');
}

window.selectNoteColor = function (color, btn) {
  selectedNoteColor = color;
  document.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
};

window.toggleNoteForm = function () {
  const form = document.getElementById('note-form');
  const opening = form.style.display === 'none';
  form.style.display = opening ? '' : 'none';
  if (opening) setTimeout(() => document.getElementById('note-text-input').focus(), 50);
};

window.saveNote = async function () {
  const text = document.getElementById('note-text-input').value.trim();
  if (!text || !detailTaskId) return;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const col = collection(db, 'users', uid, 'tasks', detailTaskId, 'notes');
  try {
    await addDoc(col, {
      text,
      color:     selectedNoteColor,
      rotation:  parseFloat((Math.random() * 6 - 3).toFixed(1)),
      createdAt: serverTimestamp(),
    });
    document.getElementById('note-text-input').value = '';
    document.getElementById('note-form').style.display = 'none';
  } catch (e) {
    console.error(e);
    showToast('Erro ao salvar post-it.');
  }
};

window.deleteNote = async function (taskId, noteId) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId, 'notes', noteId));
  } catch (e) {
    showToast('Erro ao excluir post-it.');
  }
};

// ── Tema ──────────────────────────────────────────────────────
const THEME_CYCLE  = ['auto', 'light', 'dark'];
const THEME_ICONS  = { auto: 'ti-brightness-auto', light: 'ti-sun', dark: 'ti-moon' };
const THEME_LABELS = { auto: 'Automático', light: 'Claro', dark: 'Escuro' };

function syncThemeIcon() {
  const t  = localStorage.getItem('birdy-theme') || 'auto';
  const el = document.getElementById('theme-icon');
  if (el) el.className = 'ti ' + THEME_ICONS[t];
}

window.cycleTheme = function () {
  const cur  = localStorage.getItem('birdy-theme') || 'auto';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
  localStorage.setItem('birdy-theme', next);
  if (next === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  syncThemeIcon();
  showToast(THEME_LABELS[next]);
};

syncThemeIcon();
render();
