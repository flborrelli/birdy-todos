import type { AppState, Ctx } from './types';
import {
  escHtml, money, monthSummary, hashIndex, dueText, monthShort, cap, visibleTasks, filterListId,
  maskBRL, parseBRL, parseDueDay, dueDateFor, fmtDate, type PayRow,
} from './util';
import './mini.css';

// Mini janela flutuante e sempre por cima, via Document Picture-in-Picture (Chrome/Edge 116+).
// O código roda na página principal; só o DOM fica na janelinha. Por isso as ações e os
// dados são os mesmos do app, e a janela se atualiza junto com ele (update).

interface PiPApi {
  window: Window | null;
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

function pipApi(): PiPApi | null {
  return (window as unknown as { documentPictureInPicture?: PiPApi }).documentPictureInPicture ?? null;
}

export interface Mini {
  update:  () => void;
  focus:   () => void;
  destroy: () => void;
}

const COLORS    = ['#ffd23f', '#ff8fb1', '#b79cff', '#7ae582', '#ff9f5a', '#6ec1ff'];
const MAX_TASKS = 12;
const MAX_PAY   = 8;
const TAB_KEY    = 'birdy-mini-tab';
const FILTER_KEY = 'birdy-mini-filter';
const DEFAULT_PH = 'O que precisa ser feito?';

type Tab      = 'tasks' | 'pay';
type FormKind = 'pay' | 'rec';

const SHELL = `
  <nav class="m-tabs" id="m-tabs" aria-label="Telas da mini janela">
    <button class="m-tab on" data-a="tab" data-t="tasks">Pendências <i class="m-n" id="m-n-tasks">0</i></button>
    <button class="m-tab" data-a="tab" data-t="pay">Pagamentos <i class="m-n" id="m-n-pay">0</i></button>
  </nav>

  <section class="m-pane" id="m-tasks">
    <div class="m-chips" id="m-chips" role="group" aria-label="Listas" hidden></div>
    <div class="m-add">
      <input id="m-tin" placeholder="${DEFAULT_PH}" autocomplete="off">
      <button class="m-plus" data-a="add-task" aria-label="Adicionar pendência"><i class="ti ti-plus"></i></button>
    </div>
    <ul class="m-list" id="m-tlist"></ul>
  </section>

  <section class="m-pane" id="m-pay" hidden>
    <div class="m-mon">
      <button data-a="month" data-d="-1" aria-label="Mês anterior"><i class="ti ti-chevron-left"></i></button>
      <span id="m-mname"></span>
      <button data-a="month" data-d="1" aria-label="Próximo mês"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div id="m-meter"></div>
    <div class="m-addrow" id="m-addrow">
      <button class="m-dash" data-a="form" data-k="pay">+ pagamento avulso</button>
      <button class="m-dash" data-a="form" data-k="rec">+ despesa fixa</button>
    </div>
    <form class="m-form" id="m-form" hidden autocomplete="off">
      <b id="m-ftitle"></b>
      <input id="m-fname" placeholder="Nome (ex: Internet)">
      <div class="m-frow">
        <input id="m-famt" inputmode="numeric" placeholder="Valor (R$)">
        <input id="m-fdue" type="number" min="1" max="31" inputmode="numeric" placeholder="Vence dia (1-31)" aria-label="Dia do vencimento">
      </div>
      <p class="m-hint" id="m-fhint"></p>
      <div class="m-frow">
        <button type="button" class="m-cancel" data-a="close-form">Cancelar</button>
        <button type="submit" class="m-save">Adicionar</button>
      </div>
    </form>
    <ul class="m-list" id="m-plist"></ul>
  </section>

  <div class="m-toast" id="m-toast" role="status"></div>`;

function amountText(r: PayRow): string {
  if (r.noValue)   return 'a informar';
  if (r.estimated) return `~${money(r.amount)}`;
  return money(r.amount);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function readTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === 'pay' ? 'pay' : 'tasks'; } catch { return 'tasks'; }
}

function readFilter(): string {
  try { return localStorage.getItem(FILTER_KEY) || 'all'; } catch { return 'all'; }
}

// Precisa ser chamada direto de um clique: o Chrome só abre a janela com um gesto do usuário.
export async function createMini(ctx: Ctx, onClose: () => void): Promise<Mini> {
  const api = pipApi();
  if (!api) throw new Error('Mini janela não suportada neste navegador');
  const win = await api.requestWindow({ width: 360, height: 560 });
  return mountMini(win, ctx, onClose);
}

export function mountMini(win: Window, ctx: Ctx, onClose: () => void): Mini {
  const ac   = new AbortController();
  const opts = { signal: ac.signal };
  const doc  = win.document;
  const html = doc.documentElement;

  doc.title = 'Birdy · mini';
  html.lang = 'pt-BR';
  html.dataset['layout'] = 'c';
  // Copia os estilos da página (layout, fontes e ícones) para a janelinha.
  document.head.querySelectorAll('link[rel="stylesheet"], style')
    .forEach(n => doc.head.appendChild(n.cloneNode(true)));

  const root = doc.createElement('div');
  root.className = 'm-root';
  root.innerHTML = SHELL;
  doc.body.replaceChildren(root);

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const tin    = q<HTMLInputElement>('#m-tin');
  const form   = q<HTMLFormElement>('#m-form');
  const fname  = q<HTMLInputElement>('#m-fname');
  const famt   = q<HTMLInputElement>('#m-famt');
  const fdue   = q<HTMLInputElement>('#m-fdue');
  const fhint  = q('#m-fhint');
  const addrow = q('#m-addrow');

  const chips = q('#m-chips');

  let tab: Tab = readTab();
  let filter   = readFilter();   // 'all' | id da lista (próprio da mini janela, não mexe no app)
  let formKind: FormKind | null = null;
  let toastTimer: number | undefined;

  function toast(msg: string): void {
    const t = q('#m-toast');
    t.textContent = msg;
    t.classList.add('show');
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => t.classList.remove('show'), 1800);
  }

  function setTab(t: Tab): void {
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch { /* sem localStorage: segue sem lembrar a aba */ }
    q('#m-tasks').hidden = t !== 'tasks';
    q('#m-pay').hidden   = t !== 'pay';
    root.querySelectorAll<HTMLElement>('.m-tab').forEach(b => b.classList.toggle('on', b.dataset['t'] === t));
    if (t === 'tasks') tin.focus();
  }

  // ─── adicionar pendência (na lista escolhida, como no app) ───
  async function addTask(): Promise<void> {
    const title = tin.value.trim();
    if (!title) { tin.focus(); return; }
    tin.value = '';
    const listId = filterListId(filter);
    const list   = listId ? ctx.state().lists.find(l => l._id === listId) : undefined;
    await ctx.actions.addTask(title, '', listId);
    toast(list ? `Adicionada em ${list.name}` : 'Pendência adicionada');
  }

  function setFilter(f: string): void {
    filter = f;
    try { localStorage.setItem(FILTER_KEY, f); } catch { /* segue sem lembrar a lista */ }
    renderTasks(ctx.state());
  }
  tin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void addTask(); } }, opts);

  // ─── adicionar pagamento avulso / despesa fixa ───
  function updateHint(): void {
    const day = parseDueDay(fdue.value);
    if (formKind === 'pay') {
      const s = ctx.state();
      fhint.textContent = day
        ? `Vence em ${fmtDate(dueDateFor(s.payYear, s.payMonth, day))}.`
        : 'O dia do vencimento é obrigatório (1 a 31).';
    } else {
      fhint.textContent = day
        ? `Vence todo dia ${day}.`
        : 'Valor e vencimento são opcionais: você completa mês a mês.';
    }
  }

  function openForm(kind: FormKind): void {
    formKind = kind;
    q('#m-ftitle').textContent = kind === 'pay' ? 'Novo pagamento avulso' : 'Nova despesa fixa';
    fname.value = ''; famt.value = ''; fdue.value = '';
    updateHint();
    form.hidden = false;
    addrow.hidden = true;
    fname.focus();
  }

  function closeForm(): void {
    formKind = null;
    form.hidden = true;
    addrow.hidden = false;
  }

  async function submitForm(): Promise<void> {
    const kind   = formKind;
    const name   = fname.value.trim();
    if (!kind) return;
    if (!name) { fname.focus(); return; }
    const amount = parseBRL(famt.value);
    const dueDay = parseDueDay(fdue.value);
    if (kind === 'pay') {
      if (dueDay == null) { toast('Informe o dia do vencimento (1 a 31)'); fdue.focus(); return; }
      closeForm();
      await ctx.actions.addOneOffPayment(name, amount, dueDay);
      toast('Pagamento adicionado');
    } else {
      closeForm();
      await ctx.actions.addRecurring(name, amount, dueDay);
      toast('Despesa fixa adicionada');
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); void submitForm(); }, opts);
  famt.addEventListener('input', () => maskBRL(famt), opts);
  fdue.addEventListener('input', updateHint, opts);
  form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeForm(); } }, opts);

  // ─── cliques (delegação) ───
  root.addEventListener('click', e => {
    const el = (e.target as Element).closest<HTMLElement>('[data-a]');
    if (!el || !root.contains(el)) return;
    const id = el.dataset['id'] ?? '';
    const A  = ctx.actions;
    switch (el.dataset['a']) {
      case 'tab':        setTab(el.dataset['t'] === 'pay' ? 'pay' : 'tasks'); break;
      case 'add-task':   void addTask(); break;
      case 'filter':     setFilter(el.dataset['f'] ?? 'all'); break;
      case 'done':       A.toggleDone(id); break;
      case 'month':      A.shiftMonth(Number(el.dataset['d'] ?? 0)); break;
      case 'pay':
        if (el.dataset['k'] === 'rec') A.toggleRecurringPaid(id, el.dataset['pid'] ?? '');
        else A.toggleOneOffPaid(id);
        break;
      case 'form':       openForm(el.dataset['k'] === 'rec' ? 'rec' : 'pay'); break;
      case 'close-form': closeForm(); break;
    }
  }, opts);

  // ─── render ───
  const listColor = (id: string): string => COLORS[hashIndex(id, COLORS.length)] ?? '#ffd23f';

  function renderTasks(s: AppState): void {
    const all = s.tasks.filter(t => !t.done);
    // Lista apagada (ou ainda sem listas): volta para "Todas".
    if (filter !== 'all' && !s.lists.some(l => l._id === filter)) filter = 'all';
    const vis   = visibleTasks({ ...s, filter }).filter(t => !t.done);
    const shown = vis.slice(0, MAX_TASKS);
    q('#m-n-tasks').textContent = String(all.length);

    // Divisão por listas (TRABALHO, CASA…), igual ao painel do app: Todas · uma por lista.
    chips.hidden = s.lists.length === 0;
    const chip = (id: string, emoji: string, name: string, color: string, n: number): string =>
      `<button class="m-chip${filter === id ? ' on' : ''}" style="--c:${color}" data-a="filter" data-f="${escHtml(id)}">
         <span>${emoji}</span>${escHtml(name)}<i>${n}</i></button>`;
    chips.innerHTML =
      chip('all',  '📌', 'Todas', '#6ec1ff', all.length) +
      s.lists.map(l => chip(l._id, escHtml(l.emoji ?? '📋'), l.name, listColor(l._id), all.filter(t => t.listId === l._id).length)).join('');

    const current = filter !== 'all' ? s.lists.find(l => l._id === filter) : undefined;
    tin.placeholder = current ? `Nova pendência em ${current.name}` : DEFAULT_PH;

    q('#m-tlist').innerHTML = shown.length
      ? shown.map(t => {
          const lst  = t.listId ? s.lists.find(l => l._id === t.listId) : undefined;
          const pill = filter === 'all' && lst
            ? `<span class="m-pill" style="--c:${listColor(lst._id)}">${escHtml(lst.emoji ?? '')} ${escHtml(lst.name)}</span>` : '';
          return `
          <li class="m-t" style="--bar:${lst ? listColor(lst._id) : '#ffd23f'}">
            <button class="m-chk" data-a="done" data-id="${escHtml(t._id)}" aria-label="Concluir: ${escHtml(t.title)}"></button>
            <span class="m-tt">${escHtml(t.title)}</span>${pill}
          </li>`;
        }).join('')
        + (vis.length > shown.length ? `<li class="m-more">+${vis.length - shown.length} no app completo</li>` : '')
      : `<li class="m-empty">${filter === 'all' ? 'Nenhuma pendência. Que paz!' : 'Nada pendente nesta lista.'}</li>`;
  }

  function payRow(r: PayRow): string {
    const dd = r.dueDate
      ? `<div class="m-dd ${r.status}"><b>${r.dueDate.getDate()}</b><span>${monthShort(r.dueDate)}</span></div>`
      : '<div class="m-dd none"><b>?</b><span>sem</span></div>';
    const action = r.estimated
      ? '<span class="m-need">falta o valor</span>'
      : `<button class="m-paybtn" data-a="pay" data-k="${r.kind}" data-id="${escHtml(r.id)}" data-pid="${escHtml(r.payDocId)}">pagar</button>`;
    return `
      <li class="m-p ${r.status}${r.estimated ? ' est' : ''}">
        ${dd}
        <div class="m-pl"><b>${escHtml(r.name)}</b><small>${dueText(r)}</small></div>
        <div class="m-pr"><span class="m-v">${amountText(r)}</span>${action}</div>
      </li>`;
  }

  function renderPay(s: AppState): void {
    const sum  = monthSummary(s);
    const open = sum.rows.filter(r => !r.paid);
    const paid = sum.rows.length - open.length;

    q('#m-mname').textContent =
      `${cap(new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'long' }))} ${s.payYear}`;
    const nPay = q('#m-n-pay');
    nPay.textContent = String(open.length);
    nPay.classList.toggle('late', sum.overdue.length > 0);

    const ratio = sum.total > 0 ? sum.paid / sum.total : 0;
    const miss  = sum.estimatedCount;
    q('#m-meter').innerHTML = sum.rows.length
      ? `<div class="m-meter">
           <small>Falta pagar</small><b>${money(sum.left)}</b>
           <div class="m-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>
           ${miss ? `<p class="m-miss">Falta informar o valor de ${miss} outra${plural(miss, '', 's')} despesa${plural(miss, '', 's')}. Informe no app completo.</p>` : ''}
         </div>`
      : '<div class="m-empty">Nenhum lançamento neste mês.</div>';

    const shown = open.slice(0, MAX_PAY);
    q('#m-plist').innerHTML =
      shown.map(payRow).join('')
      + (open.length > shown.length ? `<li class="m-more">+${open.length - shown.length} no app completo</li>` : '')
      + (paid ? `<li class="m-more">${paid} paga${plural(paid, '', 's')} neste mês</li>` : '');
  }

  function update(): void {
    const s  = ctx.state();
    const th = document.documentElement.getAttribute('data-theme');
    if (th) html.setAttribute('data-theme', th); else html.removeAttribute('data-theme');
    renderTasks(s);
    renderPay(s);
    if (formKind === 'pay') updateHint();
  }

  win.addEventListener('pagehide', () => { ac.abort(); onClose(); }, { once: true });

  setTab(tab);
  update();

  return {
    update,
    focus:   () => win.focus(),
    destroy: () => { ac.abort(); win.close(); },
  };
}
