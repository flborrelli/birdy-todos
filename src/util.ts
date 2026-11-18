import type { AppState, Filter, Task } from './types';

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtBRL(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function money(n: number, digits = 2): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function maskBRL(input: HTMLInputElement): void {
  const v = input.value.replace(/\D/g, '');
  if (!v) { input.value = ''; return; }
  const n = parseInt(v, 10) / 100;
  input.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseBRL(str: string): number {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

export function payMonthStr(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLowerCase();
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isToday(ts: number | null | undefined): boolean {
  return ts != null && new Date(ts).toDateString() === new Date().toDateString();
}

// O botão flutuante (+) adiciona pagamento na tela de Pagamentos e pendência nas demais.
export function syncFab(view: string): void {
  const label = view === 'pay' ? 'Novo pagamento' : 'Nova pendência';
  const fab = document.getElementById('fab');
  if (!fab) return;
  fab.setAttribute('aria-label', label);
  fab.title = label;
}

// A mini janela flutuante usa a API Document Picture-in-Picture (Chrome/Edge 116+).
export function miniSupported(): boolean {
  return 'documentPictureInPicture' in window;
}

export function filterListId(f: Filter): string | null {
  return f === 'all' || f === 'none' ? null : f;
}

export function visibleTasks(s: AppState): Task[] {
  if (s.filter === 'all')  return s.tasks;
  if (s.filter === 'none') return s.tasks.filter(t => !t.listId);
  return s.tasks.filter(t => t.listId === s.filter);
}

export function hashIndex(id: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % mod;
}

// ─── Vencimento ────────────────────────────────────────────────
export type DueStatus = 'paid' | 'overdue' | 'today' | 'soon' | 'upcoming' | 'none';

export function parseDueDay(v: string | number | null | undefined): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

export function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

// Dia 31 em mês de 30 dias vence no último dia do mês.
export function dueDateFor(y: number, m0: number, day: number): Date {
  return new Date(y, m0, Math.min(day, daysInMonth(y, m0)));
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function monthShort(d: Date): string {
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export interface PayRow {
  kind:      'rec' | 'one';
  id:        string;
  name:      string;
  amount:    number;
  paid:      boolean;
  payDocId:  string;
  dueDay:    number | null;
  dueDate:   Date | null;
  days:      number | null;
  status:    DueStatus;
  variable:  boolean;   // o valor muda todo mês (ex.: energia)
  estimated: boolean;   // variável, ainda sem o valor real do mês
  noValue:   boolean;   // estimada e sem nenhum valor de referência ("a informar")
  adjusted:  boolean;   // valor/vencimento editado só neste mês
}

export function dueText(r: PayRow): string {
  if (r.status === 'paid')    return 'pago';
  if (r.status === 'none' || r.days == null) return 'sem vencimento';
  if (r.status === 'overdue') return `atrasada ${-r.days} dia${r.days === -1 ? '' : 's'}`;
  if (r.status === 'today')   return 'vence hoje';
  if (r.days === 1)           return 'vence amanhã';
  return `em ${r.days} dias`;
}

export interface MonthSummary {
  rows:           PayRow[];
  total:          number;
  paid:           number;
  left:           number;
  overdue:        PayRow[];
  overdueAmount:  number;
  next:           PayRow | null;
  undated:        number;
  estimatedCount: number;   // despesas ainda sem valor informado: não entram nos totais
}

// Último valor real conhecido de uma despesa variável (mês mais recente anterior ao selecionado).
export function lastKnownAmount(s: AppState, recId: string): number | null {
  const cur = payMonthStr(s.payYear, s.payMonth);
  const docs = s.payments
    .filter(p => p.recurringId === recId && p.month < cur && (p.paid || p.amountConfirmed))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
  return docs.length ? docs[0]!.amount : null;
}

type RowBase = Pick<PayRow, 'kind' | 'id' | 'name' | 'amount' | 'paid' | 'payDocId' | 'dueDay' | 'variable' | 'estimated' | 'noValue' | 'adjusted'>;

function makeRow(s: AppState, b: RowBase): PayRow {
  const dueDate = b.dueDay ? dueDateFor(s.payYear, s.payMonth, b.dueDay) : null;
  const days    = dueDate ? Math.round((dueDate.getTime() - startOfToday().getTime()) / 86_400_000) : null;
  let status: DueStatus;
  if (b.paid)             status = 'paid';
  else if (days == null)  status = 'none';
  else if (days < 0)      status = 'overdue';
  else if (days === 0)    status = 'today';
  else if (days <= 3)     status = 'soon';
  else                    status = 'upcoming';
  return { ...b, dueDate, days, status };
}

export function monthSummary(s: AppState): MonthSummary {
  const m = payMonthStr(s.payYear, s.payMonth);
  const rows: PayRow[] = [];

  for (const r of s.recurring) {
    const doc       = s.payments.find(p => p.recurringId === r._id && p.month === m);
    // Sem valor no cadastro = preenchido mês a mês, como as de valor variável.
    const variable  = !!r.variable || !r.amount;
    const paid      = doc?.paid === true;
    const estimated = variable && !paid && doc?.amountConfirmed !== true;
    const amount    = estimated ? (lastKnownAmount(s, r._id) ?? r.amount ?? 0) : (doc?.amount ?? r.amount ?? 0);
    rows.push(makeRow(s, {
      kind: 'rec', id: r._id, name: r.name, amount, paid, payDocId: doc?._id ?? '',
      dueDay: parseDueDay(doc?.dueDay ?? r.dueDay), variable, estimated, noValue: estimated && !amount,
      adjusted: doc?.edited === true,
    }));
  }
  for (const p of s.payments) {
    if (!p.recurringId && p.month === m) {
      rows.push(makeRow(s, {
        kind: 'one', id: p._id, name: p.description, amount: p.amount ?? 0, paid: !!p.paid, payDocId: p._id,
        dueDay: parseDueDay(p.dueDay), variable: false, estimated: false, noValue: false, adjusted: false,
      }));
    }
  }

  // Em aberto primeiro, por data de vencimento; sem vencimento por último.
  rows.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    const ta = a.dueDate ? a.dueDate.getTime() : Infinity;
    const tb = b.dueDate ? b.dueDate.getTime() : Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  // Os totais contam só o que já tem valor informado: despesas com valor ainda
  // por informar (estimated) ficam de fora e são apenas avisadas (estimatedCount).
  const informed  = rows.filter(r => !r.estimated);
  const total     = informed.reduce((a, r) => a + r.amount, 0);
  const paid      = informed.filter(r => r.paid).reduce((a, r) => a + r.amount, 0);
  const overdue   = rows.filter(r => r.status === 'overdue');
  return {
    rows, total, paid, left: total - paid,
    overdue,
    overdueAmount: overdue.filter(r => !r.estimated).reduce((a, r) => a + r.amount, 0),
    next:    rows.find(r => !r.paid && r.days != null && r.days >= 0) ?? null,
    undated: rows.filter(r => r.dueDay == null).length,
    estimatedCount: rows.length - informed.length,
  };
}
export interface MonthPoint {
  label:   string;
  total:   number;
  paid:    number;
  current: boolean;
}

// Mês selecionado usa o planejado (fixas + avulsas); meses anteriores usam só o que foi lançado.
export function monthHistory(s: AppState, current: MonthSummary, count = 6): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d   = new Date(s.payYear, s.payMonth - i, 1);
    const key = payMonthStr(d.getFullYear(), d.getMonth());
    const label = cap(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
    if (i === 0) {
      out.push({ label, total: current.total, paid: current.paid, current: true });
    } else {
      const docs = s.payments.filter(p => p.month === key);
      out.push({
        label,
        total: docs.reduce((a, p) => a + (p.amount ?? 0), 0),
        paid:  docs.filter(p => p.paid).reduce((a, p) => a + (p.amount ?? 0), 0),
        current: false,
      });
    }
  }
  return out;
}
