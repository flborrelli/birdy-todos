import { initializeApp }       from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch, getDocs, query, where }
                               from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyB5dmG3a12WDdE13jzKTfv9C65igNmhveU",
  authDomain:        "birdy-tarefas.web.app",
  projectId:         "birdy---to-do-s",
  storageBucket:     "birdy---to-do-s.firebasestorage.app",
  messagingSenderId: "564307060103",
  appId:             "1:564307060103:web:45f9c3a0b5ba4d14131f22"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── State ────────────────────────────────────────────────────
let tasks     = [];
let lists     = [];
let recurring = [];
let payments  = [];

let currentView   = 'pending'; // 'pending' | 'payments' | list id
let unsubs        = [];
let payYear       = new Date().getFullYear();
let payMonth      = new Date().getMonth(); // 0-based
let recurringEditMode = false;
let selectedListEmoji = '📋';
let editingListId     = null;
let editingPaymentId  = null;
let editingRecId      = null;

// ─── Helpers ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function userCol(col) {
  return collection(db, 'users', auth.currentUser.uid, col);
}
function userDoc(col, id) {
  return doc(db, 'users', auth.currentUser.uid, col, id);
}

function payMonthStr(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function fmtBRL(n) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

window.maskBRL = function(input) {
  let v = input.value.replace(/\D/g, '');
  if (!v) { input.value = ''; return; }
  const n = parseInt(v, 10) / 100;
  input.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function parseBRL(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg, dur = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

function setSyncState(state, label) {
  const dot = $('sync-dot'), lbl = $('sync-label');
  dot.className = 'sync-dot ' + state;
  lbl.textContent = label;
}

// ─── Auth ──────────────────────────────────────────────────────
document.getElementById('btn-google-login').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch(e) {
    showToast('Erro ao entrar: ' + e.message);
  }
});

window.doLogout = async function() {
  unsubs.forEach(u => u());
  unsubs = [];
  await signOut(auth);
};

onAuthStateChanged(auth, user => {
  if (user) {
    $('login-screen').style.display = 'none';
    $('main-app').style.display = 'flex';
    $('fab').style.display = 'flex';
    $('user-avatar').src  = user.photoURL || '';
    $('user-name').textContent = user.displayName || user.email || '';
    updateDateLabel();
    startListening();
  } else {
    $('login-screen').style.display = 'flex';
    $('main-app').style.display = 'none';
    $('fab').style.display = 'none';
    tasks = []; lists = []; recurring = []; payments = [];
  }
});

function updateDateLabel() {
  const d = new Date();
  $('date-label').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── Firestore listeners ───────────────────────────────────────
function startListening() {
  setSyncState('syncing', 'Conectando…');

  const u1 = onSnapshot(userCol('tasks'), snap => {
    tasks = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    autoDeleteOldCompleted();
    renderAll();
    setSyncState('ok', 'Sincronizado');
  }, () => setSyncState('error', 'Erro de conexão'));

  const u2 = onSnapshot(userCol('lists'), snap => {
    lists = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderAll();
  });

  const u3 = onSnapshot(userCol('recurring'), snap => {
    recurring = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderAll();
  });

  const u4 = onSnapshot(userCol('payments'), snap => {
    payments = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderAll();
  });

  unsubs = [u1, u2, u3, u4];
}

function autoDeleteOldCompleted() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const toDelete = tasks.filter(t => t.done && t.doneAt && t.doneAt < oneDayAgo);
  if (!toDelete.length) return;
  const batch = writeBatch(db);
  toDelete.forEach(t => batch.delete(userDoc('tasks', t._id)));
  batch.commit().catch(err => console.error('Auto-delete error:', err));
}

// ─── Render orchestrator ───────────────────────────────────────
function renderAll() {
  renderStats();
  renderListsNav();
  if (currentView === 'payments') {
    renderPayments();
  } else {
    renderTaskList();
  }
}

function renderStats() {
  const pending = tasks.filter(t => !t.done).length;
  const doneToday = tasks.filter(t => {
    if (!t.done || !t.doneAt) return false;
    const d = new Date(t.doneAt);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }).length;

  const mStr = payMonthStr(payYear, payMonth);
  const paidAmt = payments
    .filter(p => p.month === mStr)
    .reduce((s, p) => s + (p.amount || 0), 0);

  $('stats').innerHTML = `
    <div class="stat-box accent">
      <div class="stat-num">${pending}</div>
      <div class="stat-label">Pendentes</div>
    </div>
    <div class="stat-box green">
      <div class="stat-num">${doneToday}</div>
      <div class="stat-label">Feitas hoje</div>
    </div>`;
}

// ─── Lists nav ─────────────────────────────────────────────────
function renderListsNav() {
  const nav = $('lists-nav');
  if (!lists.length) { nav.innerHTML = ''; return; }
  nav.innerHTML = lists.map(l => {
    const count = tasks.filter(t => !t.done && t.listId === l._id).length;
    const active = currentView === l._id ? ' active' : '';
    return `<button class="list-nav-item${active}" onclick="setView('${l._id}')">
      <span>${escHtml(l.emoji || '📋')}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l.name)}</span>
      <span class="list-nav-badge">${count || ''}</span>
      <span class="list-nav-actions">
        <button class="icon-btn-sm" onclick="event.stopPropagation();editList('${l._id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn-sm" onclick="event.stopPropagation();deleteList('${l._id}')" title="Excluir"><i class="ti ti-trash"></i></button>
      </span>
    </button>`;
  }).join('');
}

// ─── View switching ────────────────────────────────────────────
window.setView = function(view) {
  currentView = view;
  recurringEditMode = false;

  // Tabs
  $('tab-pending').classList.toggle('active', view === 'pending' || isListView());
  $('tab-payments').classList.toggle('active', view === 'payments');

  // Quick-add & FAB
  $('quick-add').style.display = (view === 'payments') ? 'none' : '';

  renderAll();
};

function isListView() {
  return currentView !== 'pending' && currentView !== 'payments';
}

// ─── Task list render ──────────────────────────────────────────
function renderTaskList() {
  const hdr = $('list-view-header');
  const listEl = $('list');

  let viewTasks = [];
  if (currentView === 'pending') {
    hdr.style.display = 'none';
    viewTasks = tasks.filter(t => !t.listId);
  } else {
    const lst = lists.find(l => l._id === currentView);
    hdr.style.display = lst ? 'flex' : 'none';
    if (lst) {
      hdr.innerHTML = `
        <button class="view-back-btn" onclick="setView('pending')" title="Voltar"><i class="ti ti-arrow-left"></i></button>
        <div class="view-title">${escHtml(lst.emoji || '📋')} ${escHtml(lst.name)}</div>`;
    }
    viewTasks = tasks.filter(t => t.listId === currentView);
  }

  const pending = viewTasks.filter(t => !t.done);
  const done    = viewTasks.filter(t => t.done);

  if (!viewTasks.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📝</div>
      Nada aqui ainda.<br>Adicione sua primeira pendência acima.
    </div>`;
    return;
  }

  let html = '';
  html += pending.map(t => taskRowHtml(t)).join('');

  if (done.length) {
    html += `<div class="done-notice"><i class="ti ti-clock-hour-4"></i> Concluídas · serão removidas em 24h</div>`;
    html += done.map(t => taskRowHtml(t)).join('');
  }

  listEl.innerHTML = html;
}

function taskRowHtml(t) {
  const doneClass = t.done ? ' done' : '';
  const cbClass   = t.done ? ' checked' : '';
  const noteHtml  = t.note ? `<div class="task-row-note">${escHtml(t.note)}</div>` : '';
  return `<div class="task-row${doneClass}" data-id="${t._id}">
    <div class="task-cb${cbClass}" onclick="toggleDone('${t._id}')">
      ${t.done ? '<i class="ti ti-check" style="font-size:.7rem"></i>' : ''}
    </div>
    <div class="task-row-body">
      <div class="task-row-title">${escHtml(t.title)}</div>
      ${noteHtml}
    </div>
    <div class="task-row-actions">
      <button onclick="deleteTask('${t._id}')" title="Excluir"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}

// ─── Quick-add ─────────────────────────────────────────────────
document.getElementById('qa-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); quickAdd(); }
  if (e.key === 'Tab')   { e.preventDefault(); toggleQaNoteRow(); }
});

window.toggleQaNoteRow = function() {
  const nr = $('qa-note-row');
  const open = nr.classList.toggle('open');
  if (open) setTimeout(() => $('qa-note').focus(), 50);
};

window.closeQaNote = function() {
  $('qa-note-row').classList.remove('open');
  $('qa-note').value = '';
  $('qa-input').focus();
};

window.quickAdd = async function() {
  const title = $('qa-input').value.trim();
  if (!title) { $('qa-input').focus(); return; }
  const note  = $('qa-note').value.trim();
  const listId = isListView() ? currentView : null;

  $('qa-input').value = '';
  $('qa-note').value = '';
  $('qa-note-row').classList.remove('open');

  try {
    const data = { title, done: false, doneAt: null, added: serverTimestamp() };
    if (note) data.note = note;
    if (listId) data.listId = listId;
    await addDoc(userCol('tasks'), data);
  } catch(e) {
    showToast('Erro ao adicionar');
  }
};

// ─── Task CRUD ─────────────────────────────────────────────────
window.toggleDone = async function(id) {
  const t = tasks.find(x => x._id === id);
  if (!t) return;
  try {
    await updateDoc(userDoc('tasks', id), {
      done: !t.done,
      doneAt: !t.done ? Date.now() : null
    });
  } catch(e) { showToast('Erro ao atualizar'); }
};

window.deleteTask = async function(id) {
  try {
    await deleteDoc(userDoc('tasks', id));
  } catch(e) { showToast('Erro ao excluir'); }
};

// ─── Task modal (mobile FAB) ───────────────────────────────────
window.fabAction = function() {
  if (currentView === 'payments') {
    openPaymentModal();
  } else {
    openTaskModal();
  }
};

function openTaskModal() {
  $('modal-title-el').textContent = 'Nova pendência';
  $('modal-save-btn').querySelector('.btn-label').textContent = 'Adicionar';
  $('m-title').value = '';
  $('m-note').value = '';

  const sel = $('m-list');
  if (lists.length) {
    sel.style.display = '';
    sel.innerHTML = `<option value="">Sem lista</option>` +
      lists.map(l => `<option value="${l._id}">${escHtml(l.emoji || '')} ${escHtml(l.name)}</option>`).join('');
    if (isListView()) sel.value = currentView;
    else sel.value = '';
  } else {
    sel.style.display = 'none';
  }

  openOverlay('modal-overlay');
  setTimeout(() => $('m-title').focus(), 60);
}

window.saveModal = async function() {
  const title = $('m-title').value.trim();
  if (!title) { $('m-title').focus(); return; }
  const note   = $('m-note').value.trim();
  const listId = $('m-list').value || null;
  setLoading('modal-save-btn', true);
  try {
    const data = { title, done: false, doneAt: null, added: serverTimestamp() };
    if (note)   data.note   = note;
    if (listId) data.listId = listId;
    await addDoc(userCol('tasks'), data);
    closeModal();
  } catch(e) {
    showToast('Erro ao adicionar');
  } finally {
    setLoading('modal-save-btn', false);
  }
};

window.closeModal = function() {
  closeOverlay('modal-overlay');
};

window.handleOverlayClick = function(e) {
  if (e.target === $('modal-overlay')) closeModal();
};

// ─── Payments view ─────────────────────────────────────────────
function renderPayments() {
  $('list-view-header').style.display = 'none';
  const listEl = $('list');
  const mStr = payMonthStr(payYear, payMonth);

  const monthLabel = new Date(payYear, payMonth, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // Recurring items + their payment docs this month
  const recRows = recurring.map(r => {
    const payDoc = payments.find(p => p.recurringId === r._id && p.month === mStr);
    return { rec: r, payDoc };
  });

  // One-off payments this month (no recurringId)
  const oneOffPayments = payments.filter(p => !p.recurringId && p.month === mStr);

  // Totals
  const totalRec    = recurring.reduce((s, r) => s + (r.amount || 0), 0);
  const paidRec     = recRows.filter(x => x.payDoc).reduce((s, x) => s + (x.rec.amount || 0), 0);
  const totalOneOff = oneOffPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalPaid   = paidRec + oneOffPayments.filter(p => p.paid).reduce((s, p) => s + (p.amount || 0), 0);
  const totalMonth  = totalRec + totalOneOff;

  let html = `<div class="payments-view">`;

  // Month navigation
  html += `<div class="payments-month-nav">
    <button class="month-nav-btn" onclick="shiftMonth(-1)"><i class="ti ti-chevron-left"></i></button>
    <div class="month-nav-label">${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</div>
    <button class="month-nav-btn" onclick="shiftMonth(1)"><i class="ti ti-chevron-right"></i></button>
  </div>`;

  // ── Recurring section ──
  html += `<div class="payments-section-header">
    <div class="payments-section-title"><i class="ti ti-repeat" style="margin-right:5px"></i>Despesas Fixas</div>
    <button class="payments-section-action ${recurringEditMode ? 'active' : ''}" onclick="toggleRecurringEdit()">
      <i class="ti ti-${recurringEditMode ? 'check' : 'settings-2'}"></i>
      ${recurringEditMode ? 'Pronto' : 'Gerenciar'}
    </button>
  </div>`;

  if (recurringEditMode) {
    // Edit mode: show edit/delete buttons
    if (recurring.length) {
      html += recurring.map(r => `
        <div class="rec-edit-row">
          <div class="rec-name">${escHtml(r.name)}</div>
          <div class="rec-amt">R$ ${fmtBRL(r.amount)}</div>
          <button class="icon-btn-sm" onclick="editRecurring('${r._id}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn-sm" onclick="deleteRecurring('${r._id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div>`).join('');
    } else {
      html += `<div style="padding:14px 0;font-size:.83rem;color:var(--text3)">Nenhuma despesa fixa cadastrada.</div>`;
    }
    html += `<button class="pay-add-btn" onclick="openRecurringModal()">
      <i class="ti ti-plus"></i> Nova despesa fixa
    </button>`;
  } else {
    // Check mode: show paid checkboxes
    if (recRows.length) {
      html += recRows.map(({ rec, payDoc }) => {
        const paid = !!payDoc;
        return `<div class="pay-row ${paid ? 'paid' : ''}">
          <div class="pay-cb ${paid ? 'checked' : ''}" onclick="toggleRecurringPaid('${rec._id}','${payDoc?._id||''}')">
            ${paid ? '<i class="ti ti-check" style="font-size:.7rem"></i>' : ''}
          </div>
          <div class="pay-row-body">
            <div class="pay-row-desc">${escHtml(rec.name)}</div>
          </div>
          <div class="pay-row-amount">R$ ${fmtBRL(rec.amount)}</div>
        </div>`;
      }).join('');
    } else {
      html += `<div style="padding:14px 0;font-size:.83rem;color:var(--text3)">
        Nenhuma despesa fixa. Clique em <strong>Gerenciar</strong> para adicionar.
      </div>`;
    }
    if (recurring.length) {
      html += `<div class="pay-summary">
        <div class="pay-summary-label">Total fixas</div>
        <div class="pay-summary-val">R$ ${fmtBRL(totalRec)}</div>
      </div>`;
    }
  }

  // ── One-off section ──
  html += `<div class="payments-section-header" style="margin-top:20px">
    <div class="payments-section-title"><i class="ti ti-receipt" style="margin-right:5px"></i>Pagamentos Avulsos</div>
  </div>`;

  if (oneOffPayments.length) {
    html += oneOffPayments.map(p => `
      <div class="pay-row ${p.paid ? 'paid' : ''}">
        <div class="pay-cb ${p.paid ? 'checked' : ''}" onclick="toggleOneOffPaid('${p._id}')">
          ${p.paid ? '<i class="ti ti-check" style="font-size:.7rem"></i>' : ''}
        </div>
        <div class="pay-row-body">
          <div class="pay-row-desc">${escHtml(p.description || p.desc || '')}</div>
        </div>
        <div class="pay-row-amount">R$ ${fmtBRL(p.amount)}</div>
        <div class="pay-row-actions">
          <button onclick="deletePayment('${p._id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join('');
  }

  html += `<button class="pay-add-btn" onclick="openPaymentModal()">
    <i class="ti ti-plus"></i> Adicionar pagamento avulso
  </button>`;

  // ── Monthly total ──
  if (totalMonth > 0) {
    html += `<div class="pay-summary" style="margin-top:16px;padding-top:16px;border-top-width:2px">
      <div class="pay-summary-label">Total do mês</div>
      <div class="pay-summary-val">R$ ${fmtBRL(totalMonth)}</div>
    </div>`;
  }

  html += `</div>`;
  listEl.innerHTML = html;
}

window.shiftMonth = function(delta) {
  payMonth += delta;
  if (payMonth > 11) { payMonth = 0; payYear++; }
  if (payMonth < 0)  { payMonth = 11; payYear--; }
  renderPayments();
};

window.toggleRecurringEdit = function() {
  recurringEditMode = !recurringEditMode;
  renderPayments();
};

window.toggleRecurringPaid = async function(recId, paymentId) {
  const rec = recurring.find(x => x._id === recId);
  if (!rec) return;
  const mStr = payMonthStr(payYear, payMonth);
  if (paymentId) {
    await deleteDoc(userDoc('payments', paymentId));
  } else {
    await addDoc(userCol('payments'), {
      description: rec.name, amount: rec.amount,
      month: mStr, recurringId: recId, paid: true,
      added: serverTimestamp(),
    });
  }
};

window.toggleOneOffPaid = async function(id) {
  const p = payments.find(x => x._id === id);
  if (!p) return;
  await updateDoc(userDoc('payments', id), { paid: !p.paid });
};

window.deletePayment = async function(id) {
  try { await deleteDoc(userDoc('payments', id)); }
  catch(e) { showToast('Erro ao excluir'); }
};

// ─── Payment modal (one-off) ───────────────────────────────────
function openPaymentModal(id) {
  editingPaymentId = id || null;
  const p = id ? payments.find(x => x._id === id) : null;
  $('pay-modal-title').textContent = p ? 'Editar pagamento' : 'Novo pagamento';
  $('pm-desc').value   = p ? (p.description || p.desc || '') : '';
  $('pm-amount').value = p ? fmtBRL(p.amount) : '';
  openOverlay('pay-modal-overlay');
  setTimeout(() => $('pm-desc').focus(), 60);
}

window.openPaymentModal = openPaymentModal;

window.savePaymentModal = async function() {
  const desc = $('pm-desc').value.trim();
  if (!desc) { $('pm-desc').focus(); return; }
  const amount = parseBRL($('pm-amount').value);
  const mStr   = payMonthStr(payYear, payMonth);
  setLoading('pay-modal-save-btn', true);
  try {
    if (editingPaymentId) {
      await updateDoc(userDoc('payments', editingPaymentId), { description: desc, amount });
    } else {
      await addDoc(userCol('payments'), {
        description: desc, amount, month: mStr, paid: false, added: serverTimestamp()
      });
    }
    closePaymentModal();
  } catch(e) {
    showToast('Erro ao salvar');
  } finally {
    setLoading('pay-modal-save-btn', false);
  }
};

window.closePaymentModal = function() {
  closeOverlay('pay-modal-overlay');
  editingPaymentId = null;
};

window.handlePayModalOverlay = function(e) {
  if (e.target === $('pay-modal-overlay')) closePaymentModal();
};

// ─── Recurring modal ───────────────────────────────────────────
function openRecurringModal(id) {
  editingRecId = id || null;
  const r = id ? recurring.find(x => x._id === id) : null;
  $('rec-modal-title').textContent = r ? 'Editar despesa fixa' : 'Nova despesa fixa';
  $('rec-name').value   = r ? r.name   : '';
  $('rec-amount').value = r ? fmtBRL(r.amount) : '';
  openOverlay('rec-modal-overlay');
  setTimeout(() => $('rec-name').focus(), 60);
}

window.openRecurringModal = openRecurringModal;

window.editRecurring = function(id) { openRecurringModal(id); };

window.saveRecurringModal = async function() {
  const name = $('rec-name').value.trim();
  if (!name) { $('rec-name').focus(); return; }
  const amount = parseBRL($('rec-amount').value);
  setLoading('rec-modal-save-btn', true);
  try {
    if (editingRecId) {
      await updateDoc(userDoc('recurring', editingRecId), { name, amount });
    } else {
      await addDoc(userCol('recurring'), { name, amount, added: serverTimestamp() });
    }
    closeRecurringModal();
  } catch(e) {
    showToast('Erro ao salvar');
  } finally {
    setLoading('rec-modal-save-btn', false);
  }
};

window.closeRecurringModal = function() {
  closeOverlay('rec-modal-overlay');
  editingRecId = null;
};

window.deleteRecurring = async function(id) {
  try { await deleteDoc(userDoc('recurring', id)); }
  catch(e) { showToast('Erro ao excluir'); }
};

// ─── List modal ────────────────────────────────────────────────
window.openListModal = function(id) {
  editingListId = id || null;
  const l = id ? lists.find(x => x._id === id) : null;
  $('list-modal-title').textContent = l ? 'Editar lista' : 'Nova lista';
  selectedListEmoji = l ? (l.emoji || '📋') : '📋';
  $('list-modal-name').value = l ? l.name : '';

  document.querySelectorAll('.list-emoji-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.emoji === selectedListEmoji);
  });

  openOverlay('list-modal-overlay');
  setTimeout(() => $('list-modal-name').focus(), 60);
};

window.editList = function(id) { openListModal(id); };

window.selectListEmoji = function(btn) {
  selectedListEmoji = btn.dataset.emoji;
  document.querySelectorAll('.list-emoji-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
};

window.saveList = async function() {
  const name = $('list-modal-name').value.trim();
  if (!name) { $('list-modal-name').focus(); return; }
  setLoading('list-modal-save-btn', true);
  try {
    if (editingListId) {
      await updateDoc(userDoc('lists', editingListId), { name, emoji: selectedListEmoji });
    } else {
      await addDoc(userCol('lists'), { name, emoji: selectedListEmoji, added: serverTimestamp() });
    }
    closeListModal();
  } catch(e) {
    showToast('Erro ao salvar lista');
  } finally {
    setLoading('list-modal-save-btn', false);
  }
};

window.deleteList = async function(id) {
  const lst = lists.find(x => x._id === id);
  if (!lst) return;

  if (!confirm(`Excluir lista "${lst.name}"? As tarefas da lista serão removidas.`)) return;

  try {
    const batch = writeBatch(db);
    batch.delete(userDoc('lists', id));
    tasks.filter(t => t.listId === id).forEach(t => batch.delete(userDoc('tasks', t._id)));
    await batch.commit();
    if (currentView === id) setView('pending');
  } catch(e) {
    showToast('Erro ao excluir lista');
  }
};

window.closeListModal = function() {
  closeOverlay('list-modal-overlay');
  editingListId = null;
};

// ─── Modal helpers ─────────────────────────────────────────────
function openOverlay(id) {
  document.getElementById(id).classList.add('open');
}
function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
}

function setLoading(btnId, loading) {
  document.getElementById(btnId).classList.toggle('loading', loading);
}

// ─── Theme ─────────────────────────────────────────────────────
const themes = ['auto', 'light', 'dark'];
let themeIdx = themes.indexOf(localStorage.getItem('birdy-theme') || 'auto');

window.cycleTheme = function() {
  themeIdx = (themeIdx + 1) % themes.length;
  const t = themes[themeIdx];
  localStorage.setItem('birdy-theme', t);
  if (t === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
  updateThemeIcon();
};

function updateThemeIcon() {
  const t = themes[themeIdx];
  const icons = { auto: 'ti-brightness-auto', light: 'ti-sun', dark: 'ti-moon' };
  $('theme-icon').className = 'ti ' + (icons[t] || 'ti-brightness-auto');
}

updateThemeIcon();

// ─── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-overlay','pay-modal-overlay','rec-modal-overlay','list-modal-overlay'].forEach(id => {
      document.getElementById(id).classList.remove('open');
    });
  }
});
