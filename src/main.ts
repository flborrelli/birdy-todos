import { initializeApp }         from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, writeBatch,
  type CollectionReference, type DocumentData,
} from 'firebase/firestore';

// ─── Firebase ──────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyB5dmG3a12WDdE13jzKTfv9C65igNmhveU',
  authDomain:        'birdy-tarefas.web.app',
  projectId:         'birdy---to-do-s',
  storageBucket:     'birdy---to-do-s.firebasestorage.app',
  messagingSenderId: '564307060103',
  appId:             '1:564307060103:web:45f9c3a0b5ba4d14131f22',
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

// ─── Domain types ──────────────────────────────────────────────
interface Task {
  _id:    string;
  title:  string;
  note?:  string;
  done:   boolean;
  doneAt: number | null;
  listId?: string;
}

interface TaskList {
  _id:   string;
  name:  string;
  emoji: string;
}

interface Recurring {
  _id:    string;
  name:   string;
  amount: number;
}

interface Payment {
  _id:         string;
  description: string;
  amount:      number;
  month:       string;
  paid:        boolean;
  recurringId?: string;
}

type View = 'pending' | 'payments' | string; // string = list id

// ─── State ────────────────────────────────────────────────────
let tasks:     Task[]      = [];
let lists:     TaskList[]  = [];
let recurring: Recurring[] = [];
let payments:  Payment[]   = [];

let currentView:       View    = 'pending';
let unsubs:            Array<() => void> = [];
let payYear:           number  = new Date().getFullYear();
let payMonth:          number  = new Date().getMonth();
let recurringEditMode: boolean = false;
let selectedListEmoji: string  = '📋';
let editingListId:     string | null = null;
let editingPaymentId:  string | null = null;
let editingRecId:      string | null = null;

// ─── DOM helpers ──────────────────────────────────────────────
function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function userCol(col: string): CollectionReference<DocumentData> {
  const uid = auth.currentUser!.uid;
  return collection(db, 'users', uid, col);
}

function userDoc(col: string, id: string) {
  const uid = auth.currentUser!.uid;
  return doc(db, 'users', uid, col, id);
}

function payMonthStr(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function fmtBRL(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskBRL(input: HTMLInputElement): void {
  const v = input.value.replace(/\D/g, '');
  if (!v) { input.value = ''; return; }
  const n = parseInt(v, 10) / 100;
  input.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBRL(str: string): number {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, dur = 2200): void {
  const t = $<HTMLElement>('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

function setSyncState(state: string, label: string): void {
  $<HTMLElement>('sync-dot').className  = 'sync-dot ' + state;
  $<HTMLElement>('sync-label').textContent = label;
}

function setLoading(btnId: string, loading: boolean): void {
  document.getElementById(btnId)?.classList.toggle('loading', loading);
}

function openOverlay(id: string): void  { document.getElementById(id)?.classList.add('open');    }
function closeOverlay(id: string): void { document.getElementById(id)?.classList.remove('open'); }

// ─── Auth ──────────────────────────────────────────────────────
$<HTMLButtonElement>('btn-google-login').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    showToast('Erro ao entrar: ' + (e as Error).message);
  }
});

async function doLogout(): Promise<void> {
  unsubs.forEach(u => u());
  unsubs = [];
  await signOut(auth);
}

onAuthStateChanged(auth, (user: User | null) => {
  if (user) {
    $<HTMLElement>('login-screen').style.display = 'none';
    $<HTMLElement>('main-app').style.display     = 'flex';
    $<HTMLElement>('fab').style.display          = 'flex';
    ($<HTMLImageElement>('user-avatar')).src     = user.photoURL ?? '';
    $<HTMLElement>('user-name').textContent      = user.displayName ?? user.email ?? '';
    updateDateLabel();
    startListening();
  } else {
    $<HTMLElement>('login-screen').style.display = 'flex';
    $<HTMLElement>('main-app').style.display     = 'none';
    $<HTMLElement>('fab').style.display          = 'none';
    tasks = []; lists = []; recurring = []; payments = [];
  }
});

function updateDateLabel(): void {
  const d = new Date();
  $<HTMLElement>('date-label').textContent = d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// ─── Firestore listeners ───────────────────────────────────────
function startListening(): void {
  setSyncState('syncing', 'Conectando…');

  const u1 = onSnapshot(userCol('tasks'), snap => {
    tasks = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<Task, '_id'>) }));
    autoDeleteOldCompleted();
    renderAll();
    setSyncState('ok', 'Sincronizado');
  }, () => setSyncState('error', 'Erro de conexão'));

  const u2 = onSnapshot(userCol('lists'), snap => {
    lists = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<TaskList, '_id'>) }));
    renderAll();
  });

  const u3 = onSnapshot(userCol('recurring'), snap => {
    recurring = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<Recurring, '_id'>) }));
    renderAll();
  });

  const u4 = onSnapshot(userCol('payments'), snap => {
    payments = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<Payment, '_id'>) }));
    renderAll();
  });

  unsubs = [u1, u2, u3, u4];
}

function autoDeleteOldCompleted(): void {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const toDelete  = tasks.filter(t => t.done && t.doneAt != null && t.doneAt < oneDayAgo);
  if (!toDelete.length) return;
  const batch = writeBatch(db);
  toDelete.forEach(t => batch.delete(userDoc('tasks', t._id)));
  batch.commit().catch(err => console.error('Auto-delete error:', err));
}

// ─── Render orchestrator ───────────────────────────────────────
function renderAll(): void {
  renderStats();
  renderListsNav();
  if (currentView === 'payments') {
    renderPayments();
  } else {
    renderTaskList();
  }
}

function renderStats(): void {
  const pending   = tasks.filter(t => !t.done).length;
  const doneToday = tasks.filter(t => {
    if (!t.done || !t.doneAt) return false;
    return new Date(t.doneAt).toDateString() === new Date().toDateString();
  }).length;

  $<HTMLElement>('stats').innerHTML = `
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
function renderListsNav(): void {
  const nav = $<HTMLElement>('lists-nav');
  if (!lists.length) { nav.innerHTML = ''; return; }
  nav.innerHTML = lists.map(l => {
    const count  = tasks.filter(t => !t.done && t.listId === l._id).length;
    const active = currentView === l._id ? ' active' : '';
    return `<button class="list-nav-item${active}" onclick="setView('${l._id}')">
      <span>${escHtml(l.emoji ?? '📋')}</span>
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
function isListView(): boolean {
  return currentView !== 'pending' && currentView !== 'payments';
}

function setView(view: View): void {
  currentView      = view;
  recurringEditMode = false;

  $<HTMLButtonElement>('tab-pending').classList.toggle('active', view === 'pending' || isListView());
  $<HTMLButtonElement>('tab-payments').classList.toggle('active', view === 'payments');
  $<HTMLElement>('quick-add').style.display = view === 'payments' ? 'none' : '';

  renderAll();
}

// ─── Task list render ──────────────────────────────────────────
function renderTaskList(): void {
  const hdr    = $<HTMLElement>('list-view-header');
  const listEl = $<HTMLElement>('list');

  let viewTasks: Task[] = [];
  if (currentView === 'pending') {
    hdr.style.display = 'none';
    viewTasks = tasks.filter(t => !t.listId);
  } else {
    const lst = lists.find(l => l._id === currentView);
    hdr.style.display = lst ? 'flex' : 'none';
    if (lst) {
      hdr.innerHTML = `
        <button class="view-back-btn" onclick="setView('pending')" title="Voltar"><i class="ti ti-arrow-left"></i></button>
        <div class="view-title">${escHtml(lst.emoji ?? '📋')} ${escHtml(lst.name)}</div>`;
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

  let html = pending.map(taskRowHtml).join('');
  if (done.length) {
    html += `<div class="done-notice"><i class="ti ti-clock-hour-4"></i> Concluídas · serão removidas em 24h</div>`;
    html += done.map(taskRowHtml).join('');
  }
  listEl.innerHTML = html;
}

function taskRowHtml(t: Task): string {
  const noteHtml = t.note ? `<div class="task-row-note">${escHtml(t.note)}</div>` : '';
  return `<div class="task-row${t.done ? ' done' : ''}" data-id="${t._id}">
    <div class="task-cb${t.done ? ' checked' : ''}" onclick="toggleDone('${t._id}')">
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
$<HTMLInputElement>('qa-input').addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') { e.preventDefault(); quickAdd(); }
  if (e.key === 'Tab')   { e.preventDefault(); toggleQaNoteRow(); }
});

function toggleQaNoteRow(): void {
  const nr   = $<HTMLElement>('qa-note-row');
  const open = nr.classList.toggle('open');
  if (open) setTimeout(() => $<HTMLTextAreaElement>('qa-note').focus(), 50);
}

function closeQaNote(): void {
  $<HTMLElement>('qa-note-row').classList.remove('open');
  $<HTMLTextAreaElement>('qa-note').value = '';
  $<HTMLInputElement>('qa-input').focus();
}

async function quickAdd(): Promise<void> {
  const title = $<HTMLInputElement>('qa-input').value.trim();
  if (!title) { $<HTMLInputElement>('qa-input').focus(); return; }
  const note   = $<HTMLTextAreaElement>('qa-note').value.trim();
  const listId = isListView() ? currentView : null;

  $<HTMLInputElement>('qa-input').value     = '';
  $<HTMLTextAreaElement>('qa-note').value   = '';
  $<HTMLElement>('qa-note-row').classList.remove('open');

  try {
    const data: Record<string, unknown> = {
      title, done: false, doneAt: null, added: serverTimestamp(),
    };
    if (note)   data['note']   = note;
    if (listId) data['listId'] = listId;
    await addDoc(userCol('tasks'), data);
  } catch {
    showToast('Erro ao adicionar');
  }
}

// ─── Task CRUD ─────────────────────────────────────────────────
async function toggleDone(id: string): Promise<void> {
  const t = tasks.find(x => x._id === id);
  if (!t) return;
  try {
    await updateDoc(userDoc('tasks', id), {
      done: !t.done,
      doneAt: !t.done ? Date.now() : null,
    });
  } catch { showToast('Erro ao atualizar'); }
}

async function deleteTask(id: string): Promise<void> {
  try { await deleteDoc(userDoc('tasks', id)); }
  catch { showToast('Erro ao excluir'); }
}

// ─── Task modal (mobile FAB) ───────────────────────────────────
function fabAction(): void {
  if (currentView === 'payments') openPaymentModal();
  else openTaskModal();
}

function openTaskModal(): void {
  $<HTMLElement>('modal-title-el').textContent = 'Nova pendência';
  $<HTMLElement>('modal-save-btn').querySelector('.btn-label')!.textContent = 'Adicionar';
  $<HTMLInputElement>('m-title').value     = '';
  $<HTMLTextAreaElement>('m-note').value   = '';

  const sel = $<HTMLSelectElement>('m-list');
  if (lists.length) {
    sel.style.display = '';
    sel.innerHTML = `<option value="">Sem lista</option>` +
      lists.map(l => `<option value="${l._id}">${escHtml(l.emoji ?? '')} ${escHtml(l.name)}</option>`).join('');
    sel.value = isListView() ? currentView : '';
  } else {
    sel.style.display = 'none';
  }

  openOverlay('modal-overlay');
  setTimeout(() => $<HTMLInputElement>('m-title').focus(), 60);
}

async function saveModal(): Promise<void> {
  const title = $<HTMLInputElement>('m-title').value.trim();
  if (!title) { $<HTMLInputElement>('m-title').focus(); return; }
  const note   = $<HTMLTextAreaElement>('m-note').value.trim();
  const listId = $<HTMLSelectElement>('m-list').value || null;
  setLoading('modal-save-btn', true);
  try {
    const data: Record<string, unknown> = {
      title, done: false, doneAt: null, added: serverTimestamp(),
    };
    if (note)   data['note']   = note;
    if (listId) data['listId'] = listId;
    await addDoc(userCol('tasks'), data);
    closeModal();
  } catch {
    showToast('Erro ao adicionar');
  } finally {
    setLoading('modal-save-btn', false);
  }
}

function closeModal(): void { closeOverlay('modal-overlay'); }

// ─── Payments view ─────────────────────────────────────────────
function renderPayments(): void {
  $<HTMLElement>('list-view-header').style.display = 'none';
  const listEl = $<HTMLElement>('list');
  const mStr   = payMonthStr(payYear, payMonth);

  const monthLabel = new Date(payYear, payMonth, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  type RecRow = { rec: Recurring; payDoc: Payment | undefined };
  const recRows: RecRow[] = recurring.map(r => ({
    rec: r,
    payDoc: payments.find(p => p.recurringId === r._id && p.month === mStr),
  }));

  const oneOffPayments = payments.filter(p => !p.recurringId && p.month === mStr);

  const totalRec    = recurring.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalOneOff = oneOffPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalMonth  = totalRec + totalOneOff;

  let html = `<div class="payments-view">`;

  html += `<div class="payments-month-nav">
    <button class="month-nav-btn" onclick="shiftMonth(-1)"><i class="ti ti-chevron-left"></i></button>
    <div class="month-nav-label">${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</div>
    <button class="month-nav-btn" onclick="shiftMonth(1)"><i class="ti ti-chevron-right"></i></button>
  </div>`;

  // ── Recurring ──
  html += `<div class="payments-section-header">
    <div class="payments-section-title"><i class="ti ti-repeat" style="margin-right:5px"></i>Despesas Fixas</div>
    <button class="payments-section-action ${recurringEditMode ? 'active' : ''}" onclick="toggleRecurringEdit()">
      <i class="ti ti-${recurringEditMode ? 'check' : 'settings-2'}"></i>
      ${recurringEditMode ? 'Pronto' : 'Gerenciar'}
    </button>
  </div>`;

  if (recurringEditMode) {
    if (recurring.length) {
      html += recurring.map(r => `
        <div class="rec-edit-row">
          <div class="rec-name">${escHtml(r.name)}</div>
          <div class="rec-amt">R$ ${fmtBRL(r.amount)}</div>
          <button class="icon-btn-sm" onclick="editRecurring('${r._id}')"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn-sm" onclick="deleteRecurring('${r._id}')"><i class="ti ti-trash"></i></button>
        </div>`).join('');
    } else {
      html += `<div style="padding:14px 0;font-size:.83rem;color:var(--text3)">Nenhuma despesa fixa cadastrada.</div>`;
    }
    html += `<button class="pay-add-btn" onclick="openRecurringModal()">
      <i class="ti ti-plus"></i> Nova despesa fixa
    </button>`;
  } else {
    if (recRows.length) {
      html += recRows.map(({ rec, payDoc }) => {
        const paid = !!payDoc;
        return `<div class="pay-row ${paid ? 'paid' : ''}">
          <div class="pay-cb ${paid ? 'checked' : ''}" onclick="toggleRecurringPaid('${rec._id}','${payDoc?._id ?? ''}')">
            ${paid ? '<i class="ti ti-check" style="font-size:.7rem"></i>' : ''}
          </div>
          <div class="pay-row-body"><div class="pay-row-desc">${escHtml(rec.name)}</div></div>
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

  // ── One-off ──
  html += `<div class="payments-section-header" style="margin-top:20px">
    <div class="payments-section-title"><i class="ti ti-receipt" style="margin-right:5px"></i>Pagamentos Avulsos</div>
  </div>`;

  if (oneOffPayments.length) {
    html += oneOffPayments.map(p => `
      <div class="pay-row ${p.paid ? 'paid' : ''}">
        <div class="pay-cb ${p.paid ? 'checked' : ''}" onclick="toggleOneOffPaid('${p._id}')">
          ${p.paid ? '<i class="ti ti-check" style="font-size:.7rem"></i>' : ''}
        </div>
        <div class="pay-row-body"><div class="pay-row-desc">${escHtml(p.description)}</div></div>
        <div class="pay-row-amount">R$ ${fmtBRL(p.amount)}</div>
        <div class="pay-row-actions">
          <button onclick="deletePayment('${p._id}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join('');
  }

  html += `<button class="pay-add-btn" onclick="openPaymentModal()">
    <i class="ti ti-plus"></i> Adicionar pagamento avulso
  </button>`;

  if (totalMonth > 0) {
    html += `<div class="pay-summary" style="margin-top:16px;border-top-width:2px">
      <div class="pay-summary-label">Total do mês</div>
      <div class="pay-summary-val">R$ ${fmtBRL(totalMonth)}</div>
    </div>`;
  }

  html += `</div>`;
  listEl.innerHTML = html;
}

function shiftMonth(delta: number): void {
  payMonth += delta;
  if (payMonth > 11) { payMonth = 0; payYear++; }
  if (payMonth < 0)  { payMonth = 11; payYear--; }
  renderPayments();
}

function toggleRecurringEdit(): void {
  recurringEditMode = !recurringEditMode;
  renderPayments();
}

async function toggleRecurringPaid(recId: string, paymentId: string): Promise<void> {
  const rec  = recurring.find(x => x._id === recId);
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
}

async function toggleOneOffPaid(id: string): Promise<void> {
  const p = payments.find(x => x._id === id);
  if (!p) return;
  await updateDoc(userDoc('payments', id), { paid: !p.paid });
}

async function deletePayment(id: string): Promise<void> {
  try { await deleteDoc(userDoc('payments', id)); }
  catch { showToast('Erro ao excluir'); }
}

// ─── Payment modal ─────────────────────────────────────────────
function openPaymentModal(id?: string): void {
  editingPaymentId = id ?? null;
  const p = id ? payments.find(x => x._id === id) : null;
  $<HTMLElement>('pay-modal-title').textContent = p ? 'Editar pagamento' : 'Novo pagamento';
  $<HTMLInputElement>('pm-desc').value   = p?.description ?? '';
  $<HTMLInputElement>('pm-amount').value = p ? fmtBRL(p.amount) : '';
  openOverlay('pay-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('pm-desc').focus(), 60);
}

async function savePaymentModal(): Promise<void> {
  const desc = $<HTMLInputElement>('pm-desc').value.trim();
  if (!desc) { $<HTMLInputElement>('pm-desc').focus(); return; }
  const amount = parseBRL($<HTMLInputElement>('pm-amount').value);
  const mStr   = payMonthStr(payYear, payMonth);
  setLoading('pay-modal-save-btn', true);
  try {
    if (editingPaymentId) {
      await updateDoc(userDoc('payments', editingPaymentId), { description: desc, amount });
    } else {
      await addDoc(userCol('payments'), {
        description: desc, amount, month: mStr, paid: false, added: serverTimestamp(),
      });
    }
    closePaymentModal();
  } catch {
    showToast('Erro ao salvar');
  } finally {
    setLoading('pay-modal-save-btn', false);
    editingPaymentId = null;
  }
}

function closePaymentModal(): void { closeOverlay('pay-modal-overlay'); editingPaymentId = null; }

// ─── Recurring modal ───────────────────────────────────────────
function openRecurringModal(id?: string): void {
  editingRecId = id ?? null;
  const r = id ? recurring.find(x => x._id === id) : null;
  $<HTMLElement>('rec-modal-title').textContent = r ? 'Editar despesa fixa' : 'Nova despesa fixa';
  $<HTMLInputElement>('rec-name').value   = r?.name ?? '';
  $<HTMLInputElement>('rec-amount').value = r ? fmtBRL(r.amount) : '';
  openOverlay('rec-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('rec-name').focus(), 60);
}

async function saveRecurringModal(): Promise<void> {
  const name = $<HTMLInputElement>('rec-name').value.trim();
  if (!name) { $<HTMLInputElement>('rec-name').focus(); return; }
  const amount = parseBRL($<HTMLInputElement>('rec-amount').value);
  setLoading('rec-modal-save-btn', true);
  try {
    if (editingRecId) {
      await updateDoc(userDoc('recurring', editingRecId), { name, amount });
    } else {
      await addDoc(userCol('recurring'), { name, amount, added: serverTimestamp() });
    }
    closeRecurringModal();
  } catch {
    showToast('Erro ao salvar');
  } finally {
    setLoading('rec-modal-save-btn', false);
    editingRecId = null;
  }
}

function closeRecurringModal(): void { closeOverlay('rec-modal-overlay'); editingRecId = null; }

async function deleteRecurring(id: string): Promise<void> {
  try { await deleteDoc(userDoc('recurring', id)); }
  catch { showToast('Erro ao excluir'); }
}

// ─── List modal ────────────────────────────────────────────────
function openListModal(id?: string): void {
  editingListId = id ?? null;
  const l = id ? lists.find(x => x._id === id) : null;
  $<HTMLElement>('list-modal-title').textContent = l ? 'Editar lista' : 'Nova lista';
  selectedListEmoji = l?.emoji ?? '📋';
  $<HTMLInputElement>('list-modal-name').value = l?.name ?? '';

  document.querySelectorAll<HTMLButtonElement>('.list-emoji-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset['emoji'] === selectedListEmoji);
  });

  openOverlay('list-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('list-modal-name').focus(), 60);
}

function editList(id: string): void { openListModal(id); }

function selectListEmoji(btn: HTMLButtonElement): void {
  selectedListEmoji = btn.dataset['emoji'] ?? '📋';
  document.querySelectorAll<HTMLButtonElement>('.list-emoji-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function saveList(): Promise<void> {
  const name = $<HTMLInputElement>('list-modal-name').value.trim();
  if (!name) { $<HTMLInputElement>('list-modal-name').focus(); return; }
  setLoading('list-modal-save-btn', true);
  try {
    if (editingListId) {
      await updateDoc(userDoc('lists', editingListId), { name, emoji: selectedListEmoji });
    } else {
      await addDoc(userCol('lists'), { name, emoji: selectedListEmoji, added: serverTimestamp() });
    }
    closeListModal();
  } catch {
    showToast('Erro ao salvar lista');
  } finally {
    setLoading('list-modal-save-btn', false);
    editingListId = null;
  }
}

async function deleteList(id: string): Promise<void> {
  const lst = lists.find(x => x._id === id);
  if (!lst) return;
  if (!confirm(`Excluir lista "${lst.name}"? As tarefas da lista serão removidas.`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(userDoc('lists', id));
    tasks.filter(t => t.listId === id).forEach(t => batch.delete(userDoc('tasks', t._id)));
    await batch.commit();
    if (currentView === id) setView('pending');
  } catch {
    showToast('Erro ao excluir lista');
  }
}

function closeListModal(): void { closeOverlay('list-modal-overlay'); editingListId = null; }

// ─── Theme ─────────────────────────────────────────────────────
const themes = ['auto', 'light', 'dark'] as const;
type Theme = typeof themes[number];
let themeIdx = themes.indexOf((localStorage.getItem('birdy-theme') as Theme) ?? 'auto');
if (themeIdx < 0) themeIdx = 0;

function cycleTheme(): void {
  themeIdx = (themeIdx + 1) % themes.length;
  const t = themes[themeIdx];
  localStorage.setItem('birdy-theme', t);
  if (t === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
  updateThemeIcon();
}

function updateThemeIcon(): void {
  const icons: Record<Theme, string> = {
    auto: 'ti-brightness-auto', light: 'ti-sun', dark: 'ti-moon',
  };
  $<HTMLElement>('theme-icon').className = 'ti ' + icons[themes[themeIdx]];
}

updateThemeIcon();

// ─── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    ['modal-overlay', 'pay-modal-overlay', 'rec-modal-overlay', 'list-modal-overlay']
      .forEach(id => document.getElementById(id)?.classList.remove('open'));
  }
});

// ─── Expose to HTML onclick handlers ──────────────────────────
type WindowExtensions = {
  doLogout:            () => void;
  setView:             (v: View) => void;
  toggleQaNoteRow:     () => void;
  closeQaNote:         () => void;
  quickAdd:            () => void;
  toggleDone:          (id: string) => void;
  deleteTask:          (id: string) => void;
  fabAction:           () => void;
  saveModal:           () => void;
  closeModal:          () => void;
  handleOverlayClick:  (e: MouseEvent) => void;
  shiftMonth:          (delta: number) => void;
  toggleRecurringEdit: () => void;
  toggleRecurringPaid: (recId: string, paymentId: string) => void;
  toggleOneOffPaid:    (id: string) => void;
  deletePayment:       (id: string) => void;
  openPaymentModal:    (id?: string) => void;
  savePaymentModal:    () => void;
  closePaymentModal:   () => void;
  handlePayModalOverlay: (e: MouseEvent) => void;
  openRecurringModal:  (id?: string) => void;
  editRecurring:       (id: string) => void;
  saveRecurringModal:  () => void;
  closeRecurringModal: () => void;
  deleteRecurring:     (id: string) => void;
  openListModal:       (id?: string) => void;
  editList:            (id: string) => void;
  selectListEmoji:     (btn: HTMLButtonElement) => void;
  saveList:            () => void;
  deleteList:          (id: string) => void;
  closeListModal:      () => void;
  cycleTheme:          () => void;
  maskBRL:             (input: HTMLInputElement) => void;
};

Object.assign(window, {
  doLogout,
  setView,
  toggleQaNoteRow,
  closeQaNote,
  quickAdd,
  toggleDone,
  deleteTask,
  fabAction,
  saveModal,
  closeModal,
  handleOverlayClick: (e: MouseEvent) => { if (e.target === $('modal-overlay')) closeModal(); },
  shiftMonth,
  toggleRecurringEdit,
  toggleRecurringPaid,
  toggleOneOffPaid,
  deletePayment,
  openPaymentModal,
  savePaymentModal,
  closePaymentModal,
  handlePayModalOverlay: (e: MouseEvent) => { if (e.target === $('pay-modal-overlay')) closePaymentModal(); },
  openRecurringModal,
  editRecurring: (id: string) => openRecurringModal(id),
  saveRecurringModal,
  closeRecurringModal,
  deleteRecurring,
  openListModal,
  editList,
  selectListEmoji,
  saveList,
  deleteList,
  closeListModal,
  cycleTheme,
  maskBRL,
} satisfies WindowExtensions);
