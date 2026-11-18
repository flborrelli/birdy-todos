import { initializeApp }         from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, writeBatch, deleteField,
  type CollectionReference, type DocumentData,
} from 'firebase/firestore';

import type {
  Task, TaskList, Recurring, Payment, Filter, Layout,
  AppState, AppActions, Ctx, SyncInfo,
} from './types';
import {
  fmtBRL, maskBRL, parseBRL, payMonthStr, filterListId, escHtml,
  parseDueDay, dueDateFor, fmtDate, monthSummary,
} from './util';
import { mountC } from './layout-c';
import { createMini, type Mini } from './mini';

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

// ─── State ────────────────────────────────────────────────────
let tasks:     Task[]      = [];
let lists:     TaskList[]  = [];
let recurring: Recurring[] = [];
let payments:  Payment[]   = [];

let filter:            Filter  = 'all';
let sync:              SyncInfo = { state: 'syncing', label: 'Conectando…' };
let userInfo                   = { name: '', photo: '' };
let unsubs:            Array<() => void> = [];
let payYear:           number  = new Date().getFullYear();
let payMonth:          number  = new Date().getMonth();
let recurringEditMode: boolean = false;
let selectedListEmoji: string  = '📋';
let editingListId:     string | null = null;
let editingPaymentId:  string | null = null;
let editingRecId:      string | null = null;
let editingMonthRecId: string | null = null;

let layout: Layout | null = null;
let mini:   Mini | null   = null;
let miniOpening           = false;

// ─── Helpers ──────────────────────────────────────────────────
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

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, dur = 2200): void {
  const t = $<HTMLElement>('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

function setLoading(btnId: string, loading: boolean): void {
  document.getElementById(btnId)?.classList.toggle('loading', loading);
}

function openOverlay(id: string): void  { document.getElementById(id)?.classList.add('open');    }
function closeOverlay(id: string): void { document.getElementById(id)?.classList.remove('open'); }

// ─── Layout ────────────────────────────────────────────────────
function getState(): AppState {
  return {
    tasks, lists, recurring, payments,
    filter, payYear, payMonth,
    manageRecurring: recurringEditMode,
    user: userInfo,
    sync,
  };
}

const actions: AppActions = {
  setFilter:           f => { filter = f; renderAll(); },
  toggleDone:          id => { void toggleDone(id); },
  deleteTask:          id => { void deleteTask(id); },
  addTask,
  toggleRecurringPaid: (recId, paymentId) => { void toggleRecurringPaid(recId, paymentId); },
  toggleOneOffPaid:    id => { void toggleOneOffPaid(id); },
  deletePayment:       id => { void deletePayment(id); },
  addOneOffPayment,
  addRecurring,
  openMini:            () => { void openMiniWindow(); },
  shiftMonth,
  toggleManage:        () => { recurringEditMode = !recurringEditMode; renderAll(); },
  openTaskModal,
  openPaymentModal,
  openRecurringModal,
  openMonthModal,
  deleteRecurring:     id => { void deleteRecurring(id); },
  openListModal,
  deleteList:          id => { void deleteList(id); },
  cycleTheme,
  logout:              () => { void doLogout(); },
  toast:               msg => showToast(msg),
};

const ctx: Ctx = { state: getState, actions };

function mountLayout(): void {
  layout?.destroy();
  const root = $<HTMLElement>('layout-root');
  root.innerHTML = '';
  document.documentElement.dataset['layout'] = 'c';
  layout = mountC(root, ctx);
  renderAll();
}

function unmountLayout(): void {
  layout?.destroy();
  layout = null;
  delete document.documentElement.dataset['layout'];
}

function renderAll(): void {
  if (filter !== 'all' && filter !== 'none' && !lists.some(l => l._id === filter)) filter = 'all';
  layout?.update();
  mini?.update();
  updateThemeIcon();
}

// Mini janela flutuante: precisa ser chamada direto de um clique (exigência do Chrome).
async function openMiniWindow(): Promise<void> {
  if (mini) { mini.focus(); return; }
  if (miniOpening) return;
  miniOpening = true;
  try {
    mini = await createMini(ctx, () => { mini = null; });
  } catch {
    showToast('Não foi possível abrir a mini janela');
  } finally {
    miniOpening = false;
  }
}

function closeMini(): void {
  const m = mini;
  mini = null;
  m?.destroy();
}

function setSyncState(state: SyncInfo['state'], label: string): void {
  sync = { state, label };
  renderAll();
}

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
    userInfo = { name: user.displayName ?? user.email ?? '', photo: user.photoURL ?? '' };
    $<HTMLElement>('login-screen').style.display  = 'none';
    $<HTMLElement>('main-app').style.display      = 'block';
    $<HTMLElement>('fab').style.display           = 'flex';
    mountLayout();
    startListening();
  } else {
    $<HTMLElement>('login-screen').style.display  = 'flex';
    $<HTMLElement>('main-app').style.display     = 'none';
    $<HTMLElement>('fab').style.display          = 'none';
    closeMini();
    unmountLayout();
    tasks = []; lists = []; recurring = []; payments = [];
  }
});

// ─── Firestore listeners ───────────────────────────────────────
function startListening(): void {
  setSyncState('syncing', 'Conectando…');

  const u1 = onSnapshot(userCol('tasks'), snap => {
    tasks = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<Task, '_id'>) }));
    autoDeleteOldCompleted();
    setSyncState('ok', 'Sincronizado');
  }, () => setSyncState('error', 'Erro de conexão'));

  const u2 = onSnapshot(userCol('lists'), snap => {
    lists = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<TaskList, '_id'>) }));
    renderAll();
  });

  const u3 = onSnapshot(userCol('recurring'), snap => {
    recurring = snap.docs.map(d => ({ _id: d.id, ...(d.data() as Omit<Recurring, '_id'>) }));
    renderAll();
  }, () => showToast('Despesas fixas indisponíveis: publique as regras do Firestore', 6000));

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

// ─── Task CRUD ─────────────────────────────────────────────────
async function addTask(title: string, note: string, listId: string | null): Promise<void> {
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

// ─── Task modal (FAB / mobile) ─────────────────────────────────
// Na tela de Pagamentos o (+) cria um pagamento; nas demais, uma pendência.
function fabAction(): void {
  if (layout?.getView() === 'pay') openPaymentModal();
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
    sel.value = filterListId(filter) ?? '';
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

// ─── Payments ──────────────────────────────────────────────────
function shiftMonth(delta: number): void {
  payMonth += delta;
  if (payMonth > 11) { payMonth = 0; payYear++; }
  if (payMonth < 0)  { payMonth = 11; payYear--; }
  renderAll();
}

// O documento do mês é mantido ao desmarcar, para não perder ajustes de valor/vencimento.
async function toggleRecurringPaid(recId: string, paymentId: string): Promise<void> {
  const rec  = recurring.find(x => x._id === recId);
  if (!rec) return;
  const mStr = payMonthStr(payYear, payMonth);
  const row  = monthSummary(getState()).rows.find(r => r.kind === 'rec' && r.id === recId);
  if (row?.estimated) { openMonthModal(recId); return; }
  const docu = payments.find(p => p._id === paymentId)
            ?? payments.find(p => p.recurringId === recId && p.month === mStr);
  try {
    if (docu) {
      await updateDoc(userDoc('payments', docu._id), { paid: !docu.paid });
    } else {
      const data: Record<string, unknown> = {
        description: rec.name, amount: row?.amount ?? rec.amount ?? 0,
        month: mStr, recurringId: recId, paid: true,
        added: serverTimestamp(),
      };
      if (rec.dueDay) data['dueDay'] = rec.dueDay;
      await addDoc(userCol('payments'), data);
    }
  } catch { showToast('Erro ao atualizar'); }
}

async function toggleOneOffPaid(id: string): Promise<void> {
  const p = payments.find(x => x._id === id);
  if (!p) return;
  try { await updateDoc(userDoc('payments', id), { paid: !p.paid }); }
  catch { showToast('Erro ao atualizar'); }
}

async function deletePayment(id: string): Promise<void> {
  try { await deleteDoc(userDoc('payments', id)); }
  catch { showToast('Erro ao excluir'); }
}

async function addOneOffPayment(description: string, amount: number, dueDay: number): Promise<void> {
  try {
    await addDoc(userCol('payments'), {
      description, amount, dueDay, month: payMonthStr(payYear, payMonth), paid: false, added: serverTimestamp(),
    });
  } catch { showToast('Erro ao adicionar'); }
}

// Despesa fixa criada fora do modal (mini janela): valor e vencimento são opcionais.
async function addRecurring(name: string, amount: number, dueDay: number | null): Promise<void> {
  try {
    const data: Record<string, unknown> = { name, amount, variable: false, added: serverTimestamp() };
    if (dueDay) data['dueDay'] = dueDay;
    await addDoc(userCol('recurring'), data);
  } catch { showToast('Erro ao adicionar'); }
}

// ─── Dia de vencimento (modais) ────────────────────────────────
function readDueDay(inputId: string): number | null {
  return parseDueDay($<HTMLInputElement>(inputId).value);
}

function updateDueHint(kind: 'rec' | 'pay' | 'mo'): void {
  const day  = readDueDay(kind === 'rec' ? 'rec-due' : kind === 'pay' ? 'pm-due' : 'mo-due');
  const hint = $<HTMLElement>(kind === 'rec' ? 'rec-due-hint' : kind === 'pay' ? 'pm-due-hint' : 'mo-due-hint');
  if (!day) {
    hint.textContent = kind === 'rec' ? 'Opcional. Em branco = você define o vencimento em cada mês.'
      : kind === 'mo' ? 'Dia do vencimento neste mês (1 a 31). Em branco = mantém o padrão.'
      : 'Dia do mês em que a conta vence (1 a 31).';
    return;
  }
  if (kind === 'rec') {
    hint.textContent = day > 28
      ? `Vence todo dia ${day} (em meses mais curtos, vale o último dia).`
      : `Vence todo dia ${day}.`;
    return;
  }
  let y = payYear, m = payMonth;
  const p = kind === 'pay' && editingPaymentId ? payments.find(x => x._id === editingPaymentId) : null;
  if (p) { const [py, pm] = p.month.split('-').map(Number); y = py!; m = pm! - 1; }
  hint.textContent = `Vence em ${fmtDate(dueDateFor(y, m, day))}.`;
}

function requireDueDay(inputId: string): number | null {
  const day = readDueDay(inputId);
  if (day == null) {
    showToast('Informe o dia do vencimento (1 a 31)');
    $<HTMLInputElement>(inputId).focus();
  }
  return day;
}

// ─── Payment modal ─────────────────────────────────────────────
function openPaymentModal(id?: string): void {
  editingPaymentId = id ?? null;
  const p = id ? payments.find(x => x._id === id) : null;
  $<HTMLElement>('pay-modal-title').textContent = p ? 'Editar pagamento' : 'Novo pagamento';
  $<HTMLInputElement>('pm-desc').value   = p?.description ?? '';
  $<HTMLInputElement>('pm-amount').value = p ? fmtBRL(p.amount) : '';
  $<HTMLInputElement>('pm-due').value    = p?.dueDay ? String(p.dueDay) : '';
  updateDueHint('pay');
  openOverlay('pay-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('pm-desc').focus(), 60);
}

async function savePaymentModal(): Promise<void> {
  const desc = $<HTMLInputElement>('pm-desc').value.trim();
  if (!desc) { $<HTMLInputElement>('pm-desc').focus(); return; }
  const amount = parseBRL($<HTMLInputElement>('pm-amount').value);
  const dueDay = requireDueDay('pm-due');
  if (dueDay == null) return;
  const mStr   = payMonthStr(payYear, payMonth);
  setLoading('pay-modal-save-btn', true);
  try {
    if (editingPaymentId) {
      await updateDoc(userDoc('payments', editingPaymentId), { description: desc, amount, dueDay });
    } else {
      await addDoc(userCol('payments'), {
        description: desc, amount, dueDay, month: mStr, paid: false, added: serverTimestamp(),
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
  $<HTMLInputElement>('rec-due').value    = r?.dueDay ? String(r.dueDay) : '';
  $<HTMLInputElement>('rec-variable').checked = !!r?.variable;
  updateDueHint('rec');
  updateRecVariable();
  openOverlay('rec-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('rec-name').focus(), 60);
}

function updateRecVariable(): void {
  const variable = $<HTMLInputElement>('rec-variable').checked;
  const blank    = !parseBRL($<HTMLInputElement>('rec-amount').value);
  $<HTMLInputElement>('rec-amount').placeholder = variable ? 'Estimativa (opcional)' : 'Opcional';
  $<HTMLElement>('rec-var-hint').textContent = variable
    ? 'Todo mês você informa o valor real quando a fatura chegar. Até lá, aparece como previsão.'
    : blank ? 'Sem valor: você informa o valor em cada mês.' : '';
}

// Valor e vencimento são opcionais: o que ficar em branco é preenchido mês a mês.
async function saveRecurringModal(): Promise<void> {
  const name = $<HTMLInputElement>('rec-name').value.trim();
  if (!name) { $<HTMLInputElement>('rec-name').focus(); return; }
  const variable = $<HTMLInputElement>('rec-variable').checked;
  const amount   = parseBRL($<HTMLInputElement>('rec-amount').value);
  const dueDay   = readDueDay('rec-due');
  setLoading('rec-modal-save-btn', true);
  try {
    if (editingRecId) {
      await updateDoc(userDoc('recurring', editingRecId), { name, amount, variable, dueDay: dueDay ?? deleteField() });
    } else {
      const data: Record<string, unknown> = { name, amount, variable, added: serverTimestamp() };
      if (dueDay) data['dueDay'] = dueDay;
      await addDoc(userCol('recurring'), data);
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

// ─── Month modal (ajuste de uma despesa fixa só neste mês) ─────
function monthDocFor(recId: string): Payment | undefined {
  const mStr = payMonthStr(payYear, payMonth);
  return payments.find(p => p.recurringId === recId && p.month === mStr);
}

function openMonthModal(recId: string): void {
  const rec = recurring.find(x => x._id === recId);
  if (!rec) return;
  editingMonthRecId = recId;
  const row   = monthSummary(getState()).rows.find(r => r.kind === 'rec' && r.id === recId);
  const docu  = monthDocFor(recId);
  const label = new Date(payYear, payMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  $<HTMLElement>('mo-modal-title').textContent = row?.estimated ? `Informar valor · ${rec.name}` : `Editar · ${rec.name}`;
  $<HTMLElement>('mo-modal-sub').textContent = rec.variable
    ? `${label}. Informe o valor real desta fatura; vale só para este mês.`
    : `${label}. Vale só para este mês; nos outros meses continua R$ ${fmtBRL(rec.amount)}${rec.dueDay ? `, dia ${rec.dueDay}` : ''}.`;
  $<HTMLInputElement>('mo-amount').value = row && row.amount ? fmtBRL(row.amount) : '';
  $<HTMLInputElement>('mo-due').value    = row?.dueDay ? String(row.dueDay) : '';
  updateDueHint('mo');
  const hasOverride = !!docu && !docu.paid && (docu.edited === true || docu.amountConfirmed === true);
  $<HTMLElement>('mo-reset-btn').style.display = hasOverride ? '' : 'none';
  openOverlay('mo-modal-overlay');
  setTimeout(() => $<HTMLInputElement>('mo-amount').focus(), 60);
}

async function saveMonthModal(): Promise<void> {
  const rec = recurring.find(x => x._id === editingMonthRecId);
  if (!rec) return;
  const amount = parseBRL($<HTMLInputElement>('mo-amount').value);
  const dueDay = readDueDay('mo-due');
  if (!amount && !dueDay) {
    showToast('Informe o valor ou o vencimento');
    $<HTMLInputElement>('mo-amount').focus();
    return;
  }

  // Campo em branco = mantém o padrão da despesa fixa (ou continua “a informar”).
  const docu    = monthDocFor(rec._id);
  const variable = !!rec.variable || !rec.amount;
  const edited  = (amount > 0 && !variable && amount !== rec.amount) || (dueDay != null && dueDay !== rec.dueDay);
  const fields: Record<string, unknown> = { edited };
  if (amount) { fields['amount'] = amount; if (variable) fields['amountConfirmed'] = true; }
  if (dueDay) fields['dueDay'] = dueDay;

  setLoading('mo-save-btn', true);
  try {
    if (docu) {
      if (!dueDay && docu.dueDay != null) fields['dueDay'] = deleteField();
      await updateDoc(userDoc('payments', docu._id), fields);
    } else {
      await addDoc(userCol('payments'), {
        description: rec.name, month: payMonthStr(payYear, payMonth), recurringId: rec._id,
        paid: false, added: serverTimestamp(), ...fields,
      });
    }
    closeMonthModal();
  } catch {
    showToast('Erro ao salvar');
  } finally {
    setLoading('mo-save-btn', false);
  }
}

async function resetMonthOverride(): Promise<void> {
  const docu = editingMonthRecId ? monthDocFor(editingMonthRecId) : undefined;
  if (docu && !docu.paid) {
    try { await deleteDoc(userDoc('payments', docu._id)); }
    catch { showToast('Erro ao restaurar'); return; }
  }
  closeMonthModal();
}

function closeMonthModal(): void { closeOverlay('mo-modal-overlay'); editingMonthRecId = null; }

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
    if (filter === id) { filter = 'all'; renderAll(); }
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
  const t = themes[themeIdx]!;
  localStorage.setItem('birdy-theme', t);
  if (t === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
  updateThemeIcon();
  showToast(t === 'auto' ? 'Tema: automático' : t === 'light' ? 'Tema: claro' : 'Tema: escuro', 1400);
}

function updateThemeIcon(): void {
  const icons: Record<Theme, string> = {
    auto: 'ti-brightness-auto', light: 'ti-sun', dark: 'ti-moon',
  };
  const cls = 'ti js-theme-icon ' + icons[themes[themeIdx]!];
  document.querySelectorAll<HTMLElement>('.js-theme-icon').forEach(el => { el.className = cls; });
}

// ─── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    ['modal-overlay', 'pay-modal-overlay', 'rec-modal-overlay', 'mo-modal-overlay', 'list-modal-overlay']
      .forEach(id => document.getElementById(id)?.classList.remove('open'));
  }
});

// ─── Expose to HTML onclick handlers ──────────────────────────
type WindowExtensions = {
  fabAction:            () => void;
  saveModal:             () => void;
  closeModal:            () => void;
  handleOverlayClick:    (e: MouseEvent) => void;
  savePaymentModal:      () => void;
  closePaymentModal:     () => void;
  handlePayModalOverlay: (e: MouseEvent) => void;
  saveRecurringModal:    () => void;
  closeRecurringModal:   () => void;
  saveList:              () => void;
  selectListEmoji:       (btn: HTMLButtonElement) => void;
  closeListModal:        () => void;
  maskBRL:               (input: HTMLInputElement) => void;
  updateDueHint:         (kind: 'rec' | 'pay' | 'mo') => void;
  updateRecVariable:     () => void;
  saveMonthModal:        () => void;
  closeMonthModal:       () => void;
  resetMonthOverride:    () => void;
};

Object.assign(window, {
  fabAction,
  saveModal,
  closeModal,
  handleOverlayClick:    (e: MouseEvent) => { if (e.target === $('modal-overlay')) closeModal(); },
  savePaymentModal,
  closePaymentModal,
  handlePayModalOverlay: (e: MouseEvent) => { if (e.target === $('pay-modal-overlay')) closePaymentModal(); },
  saveRecurringModal,
  closeRecurringModal,
  saveList,
  selectListEmoji,
  closeListModal,
  maskBRL,
  updateDueHint,
  updateRecVariable,
  saveMonthModal,
  closeMonthModal,
  resetMonthOverride,
} satisfies WindowExtensions);
