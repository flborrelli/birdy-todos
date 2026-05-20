import { initializeApp }       from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, increment }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";

// ── Config ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyB5dmG3a12WDdE13jzKTfv9C65igNmhveU",
  authDomain:        "birdy-tarefas.web.app",
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
  ato:        { label: 'Ato Societário', icon: '📋',  cls: 'ato' },
  procuracao: { label: 'Procuração',     icon: '✍️',  cls: 'procuracao' },
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
let payments = [], payYear = new Date().getFullYear(), payMonth = new Date().getMonth();
let unsubPayments = null, editPaymentId = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
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
    startListeningPayments(user.uid);
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('fab').style.display = 'none';
    if (unsubTasks) { unsubTasks(); unsubTasks = null; }
    if (unsubPayments) { unsubPayments(); unsubPayments = null; }
    tasks = []; payments = [];
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
window.togglePrazoFields = function () {
  const isPrazo = document.getElementById('m-cat').value === 'prazo';
  document.getElementById('prazo-fields').style.display = isPrazo ? '' : 'none';
  if (!isPrazo) {
    document.getElementById('m-processo').value = '';
    document.getElementById('m-autor').value = '';
    document.getElementById('m-reu').value = '';
  }
};

window.openModal = function (id) {
  editId = id || null;
  const t = id ? tasks.find(x => x._id === id) : null;
  document.getElementById('modal-title-el').textContent = id ? 'Editar tarefa' : 'Nova tarefa';
  document.getElementById('modal-save-btn').querySelector('.btn-label').textContent = id ? 'Salvar' : 'Adicionar';
  document.getElementById('m-title').value    = t ? t.title : '';
  document.getElementById('m-cat').value      = t ? t.cat   : 'prazo';
  document.getElementById('m-prio').value     = t ? t.prio  : 'alta';
  document.getElementById('m-date').value     = t ? (t.date || '') : '';
  document.getElementById('m-note').value     = t ? (t.note || '') : '';
  document.getElementById('m-processo').value = t ? (t.processo || '') : '';
  document.getElementById('m-autor').value    = t ? (t.autor || '') : '';
  document.getElementById('m-reu').value      = t ? (t.reu || '') : '';
  togglePrazoFields();
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
  const cat = document.getElementById('m-cat').value;
  const data = {
    title,
    cat,
    prio:     document.getElementById('m-prio').value,
    date:     document.getElementById('m-date').value,
    note:     document.getElementById('m-note').value.trim(),
    processo: cat === 'prazo' ? document.getElementById('m-processo').value.trim() : '',
    autor:    cat === 'prazo' ? document.getElementById('m-autor').value.trim() : '',
    reu:      cat === 'prazo' ? document.getElementById('m-reu').value.trim() : '',
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
  ['pending', 'today', 'done', 'calendar', 'payments'].forEach(x => document.getElementById('tab-' + x).classList.toggle('active', x === v));
  const hideToolbar = v === 'calendar' || v === 'payments';
  document.querySelector('.search-wrap').style.display = hideToolbar ? 'none' : '';
  document.getElementById('filters').style.display     = hideToolbar ? 'none' : '';
  document.querySelector('.sort-row').style.display    = hideToolbar ? 'none' : '';
  const fab = document.getElementById('fab');
  fab.setAttribute('aria-label', v === 'payments' ? 'Novo pagamento' : 'Nova tarefa');
  render();
};

window.fabAction = function () {
  if (view === 'payments') openPaymentModal();
  else openModal();
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
    list = list.filter(t => t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (t.processo || '').toLowerCase().includes(q) || (t.autor || '').toLowerCase().includes(q) || (t.reu || '').toLowerCase().includes(q));
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
  const nc = t.noteCount || 0;
  const postits = nc > 0
    ? `<div class="card-postits"><i class="ti ti-note card-postit-icon"></i><span class="card-postit-text">${esc(t.notePreview || '')}</span>${nc > 1 ? `<span class="card-postit-count">+${nc - 1}</span>` : ''}</div>`
    : '';
  return `<div class="task-card${t.done ? ' done' : ''}">` +
    `<div class="prio-bar" style="background:${t.done ? 'var(--border)' : pc.color}"></div>` +
    `<div class="cb${t.done ? ' checked' : ''}" onclick="toggleDone('${t._id}')" role="checkbox" aria-checked="${t.done}" tabindex="0" onkeydown="if(event.key===' '||event.key==='Enter')toggleDone('${t._id}')">${t.done ? '<i class="ti ti-check" style="font-size:11px;color:var(--bg)"></i>' : ''}</div>` +
    `<div class="task-body" onclick="openDetail('${t._id}')" style="cursor:pointer">` +
      `<div class="task-title">${esc(t.title)}</div>` +
      (t.cat === 'prazo' && t.processo ? `<div class="task-processo"><i class="ti ti-file-text" style="font-size:11px;flex-shrink:0"></i><strong>${esc(t.processo)}</strong></div>` : '') +
      (t.cat === 'prazo' && (t.autor || t.reu) ? `<div class="task-partes">${esc(t.autor || '—')} <span style="color:var(--text3);font-weight:400">×</span> ${esc(t.reu || '—')}</div>` : '') +
      `<div class="task-meta" style="margin-top:${t.cat === 'prazo' && (t.processo || t.autor) ? '5px' : '4px'}"><span class="chip ${CATS[t.cat]?.cls || 'outro'}" style="font-size:11px;padding:2px 7px">${CATS[t.cat]?.icon || ''} ${CATS[t.cat]?.label || t.cat}</span>${dt}</div>` +
      (t.note ? `<div class="task-note">${esc(t.note)}</div>` : '') +
      postits +
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
  let html = '<div class="task-grid">';
  if (view === 'pending') {
    const over = list.filter(t => dateStatus(t.date) === 'overdue');
    const rest = list.filter(t => dateStatus(t.date) !== 'overdue');
    if (over.length) {
      html += `<div class="section-label"><i class="ti ti-alert-circle" style="font-size:13px"></i>Vencidas</div>`;
      over.forEach(t => { html += taskHtml(t); });
      if (rest.length) {
        html += `<div class="section-label" style="margin-top:.5rem">Demais tarefas</div>`;
        rest.forEach(t => { html += taskHtml(t); });
      }
    } else {
      list.forEach(t => { html += taskHtml(t); });
    }
  } else {
    list.forEach(t => { html += taskHtml(t); });
  }
  html += '</div>';
  el.innerHTML = html;
}

window.render = function () {
  renderStats();
  if (view === 'payments')      { renderPayments(); }
  else if (view === 'calendar') { renderCalendar(); }
  else                          { renderFilters(); renderList(); }
};

// ── Calendário ────────────────────────────────────────────────
const CAL_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CAL_DOW    = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function renderCalendar() {
  const el  = document.getElementById('list');
  const pad = n => String(n).padStart(2, '0');
  const todayStr    = today();
  const firstDay    = new Date(calYear, calMonth, 1);
  const lastDay     = new Date(calYear, calMonth + 1, 0);
  const startDow    = firstDay.getDay();
  const totalDays   = lastDay.getDate();
  const monthPrefix = `${calYear}-${pad(calMonth + 1)}`;

  const tasksByDay = {};
  tasks.filter(t => !t.done && t.date && t.date.startsWith(monthPrefix)).forEach(t => {
    const d = parseInt(t.date.split('-')[2]);
    (tasksByDay[d] = tasksByDay[d] || []).push(t);
  });

  let html = `<div class="cal-wrap">`;
  html += `<div class="cal-header"><div class="cal-title">${CAL_MONTHS[calMonth]} ${calYear}</div>`;
  html += `<div style="display:flex;align-items:center;gap:8px">`;
  html += `<div class="cal-nav"><button onclick="calPrev()"><i class="ti ti-chevron-left"></i></button><button onclick="calNext()"><i class="ti ti-chevron-right"></i></button></div>`;
  html += `<button class="cal-today-btn" onclick="calToday()">Hoje</button></div></div>`;

  html += `<div class="cal-grid">`;
  CAL_DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });

  const prevLast = new Date(calYear, calMonth, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${prevLast - i}</div></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const dateStr  = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const isToday  = dateStr === todayStr;
    const isPast   = dateStr < todayStr;
    const dayTasks = tasksByDay[d] || [];
    html += `<div class="cal-day${isToday ? ' today' : ''}"><div class="cal-day-num">${d}</div>`;
    dayTasks.slice(0, 2).forEach(t => {
      const cls = isPast ? 'overdue' : isToday ? 'today-ev' : t.cat === 'prazo' ? 'prazo' : 'other';
      const icon = CATS[t.cat]?.icon || '';
      html += `<div class="cal-event ${cls}" onclick="openDetail('${t._id}')" title="${esc(t.title)}">${icon} ${esc(t.title)}</div>`;
    });
    if (dayTasks.length > 2) html += `<div class="cal-more">+${dayTasks.length - 2} mais</div>`;
    html += `</div>`;
  }

  const trailing = (startDow + totalDays) % 7;
  for (let d = 1; d <= (trailing === 0 ? 0 : 7 - trailing); d++) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  }
  html += `</div>`;

  html += `<div class="cal-legend">`;
  html += `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:#FDECEA;border-left-color:var(--red)"></div>Vencido</div>`;
  html += `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:#FFF3DC;border-left-color:var(--amber)"></div>Hoje</div>`;
  html += `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--prazo-bg);border-left-color:var(--prazo-sel)"></div>Prazo judicial</div>`;
  html += `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:var(--bg2);border-left-color:var(--border2)"></div>Outros</div>`;
  html += `</div></div>`;

  el.innerHTML = html;
}

window.calPrev  = function () { calMonth--; if (calMonth < 0)  { calMonth = 11; calYear--; } renderCalendar(); };
window.calNext  = function () { calMonth++; if (calMonth > 11) { calMonth = 0;  calYear++; } renderCalendar(); };
window.calToday = function () { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar(); };

// ── Data no header ────────────────────────────────────────────
(function () {
  const d     = new Date();
  const dias  = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  document.getElementById('date-label').textContent = `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
})();

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDetail(); closePaymentModal(); } });

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
    (t.date ? `<span class="task-date ${dc}"><i class="ti ${di}" style="font-size:12px"></i> ${s === 'overdue' ? 'Venceu ' + fmtDate(t.date) : s === 'today' ? 'Hoje' : fmtDate(t.date)}</span>` : '') +
    (t.cat === 'prazo' && t.processo ? `<div style="width:100%;margin-top:6px;font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px"><i class="ti ti-file-text" style="font-size:12px;flex-shrink:0"></i><strong style="font-weight:500">${esc(t.processo)}</strong></div>` : '') +
    (t.cat === 'prazo' && (t.autor || t.reu) ? `<div style="width:100%;font-size:13px;color:var(--prazo-c);font-weight:500;margin-top:2px">${esc(t.autor || '—')} <span style="color:var(--text3);font-weight:400">×</span> ${esc(t.reu || '—')}</div>` : '');

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
  const col     = collection(db, 'users', uid, 'tasks', detailTaskId, 'notes');
  const taskRef = doc(db, 'users', uid, 'tasks', detailTaskId);
  try {
    await Promise.all([
      addDoc(col, { text, color: selectedNoteColor, rotation: parseFloat((Math.random() * 6 - 3).toFixed(1)), createdAt: serverTimestamp() }),
      updateDoc(taskRef, { noteCount: increment(1), notePreview: text }),
    ]);
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
  const task    = tasks.find(x => x._id === taskId);
  const isLast  = (task?.noteCount || 1) <= 1;
  const taskRef = doc(db, 'users', uid, 'tasks', taskId);
  try {
    await Promise.all([
      deleteDoc(doc(db, 'users', uid, 'tasks', taskId, 'notes', noteId)),
      updateDoc(taskRef, { noteCount: increment(-1), ...(isLast ? { notePreview: '' } : {}) }),
    ]);
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

// ── Pagamentos ────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtBRL(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function payMonthStr(y, m) { return `${y}-${pad2(m + 1)}`; }

function getPayCol() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return collection(db, 'users', uid, 'payments');
}

function startListeningPayments(uid) {
  if (unsubPayments) { unsubPayments(); unsubPayments = null; }
  const COL = collection(db, 'users', uid, 'payments');
  unsubPayments = onSnapshot(COL,
    snap => {
      payments = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
      if (view === 'payments') renderPayments();
    },
    err => { console.error(err); }
  );
}

function renderPayments() {
  const el   = document.getElementById('list');
  const mStr = payMonthStr(payYear, payMonth);

  const list = payments
    .filter(p => p.month === mStr)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const total   = list.reduce((s, p) => s + (p.amount || 0), 0);
  const paidAmt = list.filter(p => p.paid).reduce((s, p) => s + (p.amount || 0), 0);
  const pendAmt = total - paidAmt;

  let html = `<div class="pay-wrap">`;

  html += `<div class="pay-header">
    <div class="pay-month-title">${CAL_MONTHS[payMonth]} ${payYear}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <div class="cal-nav">
        <button onclick="payPrev()"><i class="ti ti-chevron-left"></i></button>
        <button onclick="payNext()"><i class="ti ti-chevron-right"></i></button>
      </div>
      <button class="cal-today-btn" onclick="payThisMonth()">Este mês</button>
    </div>
  </div>`;

  html += `<div class="pay-summary">
    <div class="pay-sum-card">
      <div class="pay-sum-val">${fmtBRL(total)}</div>
      <div class="pay-sum-lbl">Total do mês</div>
    </div>
    <div class="pay-sum-card pay-sum-green">
      <div class="pay-sum-val">${fmtBRL(paidAmt)}</div>
      <div class="pay-sum-lbl">Pago</div>
    </div>
    <div class="pay-sum-card${pendAmt > 0 ? ' pay-sum-red' : ' pay-sum-green'}">
      <div class="pay-sum-val">${fmtBRL(pendAmt)}</div>
      <div class="pay-sum-lbl">Pendente</div>
    </div>
  </div>`;

  if (!list.length) {
    html += `<div class="empty"><i class="ti ti-receipt-off"></i>Nenhum pagamento para este mês.</div>`;
  } else {
    html += `<div class="pay-list">`;
    list.forEach(p => { html += paymentHtml(p); });
    html += `</div>`;
  }

  html += `<div class="pay-actions-row">
    <button class="btn-pay-secondary" onclick="copyPrevMonth()"><i class="ti ti-copy"></i> Copiar mês anterior</button>
    <button class="btn-new" onclick="openPaymentModal()"><i class="ti ti-plus" aria-hidden="true"></i> Novo pagamento</button>
  </div>`;

  html += `</div>`;
  el.innerHTML = html;
}

function paymentHtml(p) {
  const s = dateStatus(p.dueDate);
  const dateCls = s === 'overdue' ? 'date-overdue' : (s === 'today' || s === 'soon') ? 'date-soon' : 'date-normal';
  const dateIcon = s === 'overdue' ? 'ti-alert-circle' : 'ti-calendar';
  const dateLabel = p.dueDate ? fmtPayDate(p.dueDate) : '';
  const dateBadge = p.dueDate
    ? `<span class="pay-item-date ${dateCls}"><i class="ti ${dateIcon}" style="font-size:10px"></i> ${dateLabel}</span>`
    : '';
  return `<div class="pay-item${p.paid ? ' paid' : ''}">` +
    `<div class="pay-item-check${p.paid ? ' checked' : ''}" onclick="togglePaymentPaid('${p._id}')" role="checkbox" aria-checked="${p.paid}" tabindex="0" onkeydown="if(event.key===' '||event.key==='Enter')togglePaymentPaid('${p._id}')">` +
      (p.paid ? '<i class="ti ti-check" style="font-size:10px;color:var(--bg)"></i>' : '') +
    `</div>` +
    `<div class="pay-item-body"><div class="pay-item-desc">${esc(p.description)}</div></div>` +
    dateBadge +
    `<div class="pay-item-amount${p.paid ? ' paid-amount' : ''}">${fmtBRL(p.amount)}</div>` +
    `<div class="task-actions">` +
      `<button class="icon-btn" onclick="openPaymentModal('${p._id}')" aria-label="Editar"><i class="ti ti-edit"></i></button>` +
      `<button class="icon-btn" onclick="deletePayment('${p._id}')" aria-label="Excluir"><i class="ti ti-trash"></i></button>` +
    `</div>` +
  `</div>`;
}

function fmtPayDate(d) {
  if (!d) return '';
  const [, m, dd] = d.split('-');
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dd} ${months[parseInt(m) - 1]}`;
}

window.payPrev = function () { payMonth--; if (payMonth < 0)  { payMonth = 11; payYear--; } renderPayments(); };
window.payNext = function () { payMonth++; if (payMonth > 11) { payMonth = 0;  payYear++; } renderPayments(); };
window.payThisMonth = function () { const d = new Date(); payYear = d.getFullYear(); payMonth = d.getMonth(); renderPayments(); };

window.openPaymentModal = function (id) {
  editPaymentId = id || null;
  const p = id ? payments.find(x => x._id === id) : null;
  document.getElementById('pay-modal-title').textContent = id ? 'Editar pagamento' : 'Novo pagamento';
  document.getElementById('pay-modal-save-btn').querySelector('.btn-label').textContent = id ? 'Salvar' : 'Adicionar';
  document.getElementById('pm-desc').value   = p ? (p.description || '') : '';
  document.getElementById('pm-amount').value = p ? (p.amount  || '') : '';
  document.getElementById('pm-date').value   = p ? (p.dueDate || '') : '';
  document.getElementById('pay-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pm-desc').focus(), 100);
};

window.closePaymentModal = function () {
  document.getElementById('pay-modal-overlay').classList.remove('open');
  editPaymentId = null;
};

window.handlePayModalOverlay = function (e) {
  if (e.target.id === 'pay-modal-overlay') closePaymentModal();
};

window.savePaymentModal = async function () {
  const description = document.getElementById('pm-desc').value.trim();
  if (!description) { document.getElementById('pm-desc').focus(); return; }
  const amount  = parseFloat(document.getElementById('pm-amount').value) || 0;
  const dueDate = document.getElementById('pm-date').value;
  const COL = getPayCol(); if (!COL) return;
  const btn = document.getElementById('pay-modal-save-btn');
  btn.classList.add('loading');
  const mStr = payMonthStr(payYear, payMonth);
  const data = { description, amount, dueDate, month: mStr };
  try {
    if (editPaymentId) {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'payments', editPaymentId), data);
      showToast('Pagamento atualizado');
    } else {
      data.paid = false; data.added = serverTimestamp();
      await addDoc(COL, data);
      showToast('Pagamento adicionado');
    }
    closePaymentModal();
  } catch (e) {
    console.error(e);
    showToast('Erro ao salvar. Tente novamente.');
  } finally {
    btn.classList.remove('loading');
  }
};

window.togglePaymentPaid = async function (id) {
  const p = payments.find(x => x._id === id); if (!p) return;
  try {
    await updateDoc(doc(db, 'users', auth.currentUser.uid, 'payments', id), { paid: !p.paid });
  } catch (e) { showToast('Erro ao atualizar.'); }
};

window.deletePayment = async function (id) {
  if (!confirm('Excluir este pagamento?')) return;
  try {
    await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'payments', id));
    showToast('Pagamento excluído');
  } catch (e) { showToast('Erro ao excluir.'); }
};

window.copyPrevMonth = async function () {
  let prevY = payYear, prevM = payMonth - 1;
  if (prevM < 0) { prevM = 11; prevY--; }
  const prevList = payments.filter(p => p.month === payMonthStr(prevY, prevM));
  if (!prevList.length) {
    showToast(`Nenhum pagamento em ${CAL_MONTHS[prevM]}.`);
    return;
  }
  if (!confirm(`Copiar ${prevList.length} pagamento(s) de ${CAL_MONTHS[prevM]} para ${CAL_MONTHS[payMonth]}?`)) return;
  const COL = getPayCol(); if (!COL) return;
  const mStr = payMonthStr(payYear, payMonth);
  try {
    await Promise.all(prevList.map(p => {
      let newDate = '';
      if (p.dueDate) {
        const [, , dd] = p.dueDate.split('-').map(Number);
        const lastDay = new Date(payYear, payMonth + 1, 0).getDate();
        newDate = `${payYear}-${pad2(payMonth + 1)}-${pad2(Math.min(dd, lastDay))}`;
      }
      return addDoc(COL, { description: p.description, amount: p.amount, dueDate: newDate, month: mStr, paid: false, added: serverTimestamp() });
    }));
    showToast(`${prevList.length} pagamento(s) copiado(s)!`);
  } catch (e) {
    console.error(e);
    showToast('Erro ao copiar pagamentos.');
  }
};

