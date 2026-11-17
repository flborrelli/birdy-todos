import type { AppState, Ctx, Layout, ViewId } from './types';
import {
  escHtml, money, monthSummary, monthHistory, visibleTasks, filterListId,
  hashIndex, norm, cap, isToday, dueText, monthShort, parseDueDay, syncFab,
  type MonthSummary, type MonthPoint, type PayRow,
} from './util';
import './layout-b.css';

type View = 'all' | 'tasks' | 'pay';
interface PaletteItem { icon: string; title: string; hint: string; run: () => void }

const PAL = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#c084fc', '#f87171'];
const RING = 339.292;

function amountText(r: PayRow): string {
  if (r.noValue)   return 'a informar';
  if (r.estimated) return `~${money(r.amount)}`;
  return money(r.amount);
}

const BIRD = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1A1A1A"/><rect x="14" y="28" width="30" height="20" rx="6" fill="#fff" transform="rotate(-8 29 38)"/><circle cx="38" cy="20" r="9" fill="#fff"/><polygon points="14,34 6,44 18,44" fill="#fff"/><polygon points="18,30 38,26 36,34 18,36" fill="#fff" opacity=".55"/><polygon points="46,19 55,21 46,24" fill="#fff"/><circle cx="40" cy="19" r="2.8" fill="#1A1A1A"/><circle cx="41" cy="18" r=".9" fill="#fff"/></svg>`;

const SHELL = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="b-rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs></svg>
<div class="b-root">
  <header class="b-top">
    <div class="b-brand">${BIRD}<span>Birdy</span></div>
    <nav class="b-seg" id="b-seg">
      <button data-a="view" data-v="all" class="on">Visão geral</button>
      <button data-a="view" data-v="tasks">Pendências</button>
      <button data-a="view" data-v="pay">Pagamentos</button>
    </nav>
    <button class="b-cmdbar" data-a="open-cmd"><i class="ti ti-search"></i><span>Adicionar, buscar ou digitar um comando…</span><kbd>Ctrl K</kbd></button>
    <div class="b-tr">
      <i class="b-sync" id="b-sync"></i>
      <button class="b-icon" data-a="theme" title="Alternar tema" aria-label="Alternar tema"><i class="ti ti-brightness-auto js-theme-icon"></i></button>
      <div class="b-avatar" id="b-avatar"></div>
      <button class="b-icon" data-a="logout" title="Sair" aria-label="Sair"><i class="ti ti-logout"></i></button>
    </div>
  </header>

  <main class="b-wrap">
    <section class="b-hello">
      <div>
        <p class="b-eyebrow" id="b-date"></p>
        <h1 id="b-h1"></h1>
        <p class="b-lead" id="b-lead"></p>
      </div>
      <div class="b-actions">
        <button class="b-btn" data-a="focus-add">+ Pendência</button>
        <button class="b-btn ghost" data-a="new-pay">+ Pagamento</button>
      </div>
    </section>

    <div class="b-grid" id="b-grid" data-view="all">
      <article class="b-card b-money" id="b-money"></article>

      <article class="b-card b-tasks">
        <div class="b-card-h"><h2>Pendências <span class="b-count" id="b-tcount"></span></h2></div>
        <div class="b-qrow"><i class="ti ti-plus"></i><input id="b-qin" placeholder="Adicionar pendência…" autocomplete="off"><kbd>↵</kbd></div>
        <div class="b-qrow b-qnote" id="b-qnote" hidden><input id="b-qnin" placeholder="Detalhes (opcional)…" autocomplete="off"></div>
        <div class="b-fchips" id="b-fchips"></div>
        <ul class="b-tlist" id="b-tlist"></ul>
      </article>

      <article class="b-card b-next" id="b-next"></article>
      <article class="b-card b-lists" id="b-lists"></article>
      <article class="b-card b-trend" id="b-trend"></article>
      <article class="b-card b-today" id="b-today"></article>

      <article class="b-card b-tip">
        <div class="b-card-h"><h2>Adição inteligente</h2></div>
        <p>Com <kbd>Ctrl K</kbd> o Birdy entende o que você digita:</p>
        <div class="b-ex">
          <div>Pizza 45 dia 20 <span>→ avulso, vence dia 20</span></div>
          <div>/casa Comprar pão <span>→ lista Casa</span></div>
          <div>Dentista <span>→ pendência</span></div>
        </div>
      </article>
    </div>
  </main>

  <div class="b-ov" id="b-cmd" data-a="close-cmd" hidden>
    <div class="b-pal" role="dialog" aria-label="Paleta de comandos">
      <input id="b-cin" placeholder="Digite uma pendência, “Pizza 45” ou um comando…" autocomplete="off">
      <ul id="b-clist"></ul>
      <footer><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> executar</span><span><kbd>Esc</kbd> fechar</span></footer>
    </div>
  </div>
</div>`;

export function mountB(root: HTMLElement, ctx: Ctx): Layout {
  const ac   = new AbortController();
  const opts = { signal: ac.signal };
  root.innerHTML = SHELL;

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const grid  = q('#b-grid');
  const qin   = q<HTMLInputElement>('#b-qin');
  const qnote = q('#b-qnote');
  const qnin  = q<HTMLInputElement>('#b-qnin');
  const cmd   = q('#b-cmd');
  const cin   = q<HTMLInputElement>('#b-cin');
  const clist = q('#b-clist');

  let sel = 0;
  let items: PaletteItem[] = [];

  // ─── navegação local ───
  function setView(v: View): void {
    grid.dataset['view'] = v;
    root.querySelectorAll<HTMLElement>('#b-seg button').forEach(b => b.classList.toggle('on', b.dataset['v'] === v));
    syncFab(v);
  }

  // ─── adicionar pendência ───
  async function addFromInput(): Promise<void> {
    const title = qin.value.trim();
    if (!title) return;
    const note = qnin.value.trim();
    qin.value = ''; qnin.value = ''; qnote.hidden = true;
    await ctx.actions.addTask(title, note, filterListId(ctx.state().filter));
  }
  qin.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void addFromInput(); }
    if (e.key === 'Tab' && !e.shiftKey && qnote.hidden) { e.preventDefault(); qnote.hidden = false; qnin.focus(); }
  }, opts);
  qnin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void addFromInput(); } }, opts);

  // ─── cliques (delegação) ───
  root.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!el || !root.contains(el)) return;
    const a  = el.dataset['a'];
    const id = el.dataset['id'] ?? '';
    const A  = ctx.actions;
    if (a === 'close-cmd') { if (e.target === el) closeCmd(); return; }
    switch (a) {
      case 'view':       setView((el.dataset['v'] ?? 'all') as View); break;
      case 'filter':     A.setFilter(el.dataset['f'] ?? 'all'); break;
      case 'toggle-filter': { const f = el.dataset['f'] ?? 'all'; A.setFilter(ctx.state().filter === f ? 'all' : f); break; }
      case 'done':       A.toggleDone(id); break;
      case 'del-task':   A.deleteTask(id); break;
      case 'rec-paid':   A.toggleRecurringPaid(id, el.dataset['pid'] ?? ''); break;
      case 'one-paid':   A.toggleOneOffPaid(id); break;
      case 'del-pay':    A.deletePayment(id); break;
      case 'month':      A.shiftMonth(Number(el.dataset['d'] ?? 0)); break;
      case 'manage':     A.toggleManage(); break;
      case 'new-pay':    A.openPaymentModal(); break;
      case 'edit-pay':   A.openPaymentModal(id); break;
      case 'edit-month': A.openMonthModal(id); break;
      case 'new-rec':    A.openRecurringModal(); break;
      case 'edit-rec':   A.openRecurringModal(id); break;
      case 'del-rec':    A.deleteRecurring(id); break;
      case 'new-list':   A.openListModal(); break;
      case 'edit-list':  A.openListModal(id); break;
      case 'del-list':   A.deleteList(id); break;
      case 'theme':      A.cycleTheme(); break;
      case 'logout':     A.logout(); break;
      case 'open-cmd':   openCmd(); break;
      case 'focus-add':
        if (grid.dataset['view'] === 'pay') setView('all');
        qin.scrollIntoView({ behavior: 'smooth', block: 'center' });
        qin.focus();
        break;
    }
  }, opts);

  // ─── render ───
  function renderHello(s: AppState, sum: MonthSummary): void {
    const now  = new Date();
    const h    = now.getHours();
    const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const first = s.user.name.split(' ')[0] || 'por aqui';
    q('#b-date').textContent = cap(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
    q('#b-h1').innerHTML = `${greet}, <span class="b-grad">${escHtml(first)}</span>.`;
    const pend = s.tasks.filter(t => !t.done).length;
    const mName = new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'long' });
    const late = sum.overdue.length;
    const dueNote = late
      ? ` <span class="b-late"><i class="ti ti-alert-triangle"></i> <b>${late} conta${late === 1 ? '' : 's'} atrasada${late === 1 ? '' : 's'}</b> (${money(sum.overdueAmount)})</span>`
      : sum.next ? ` Próxima conta: <b>${escHtml(sum.next.name)}</b>, ${dueText(sum.next)}.` : '';
    q('#b-lead').innerHTML = `<b>${pend} pendência${pend === 1 ? '' : 's'}</b> aberta${pend === 1 ? '' : 's'}` +
      (sum.rows.length ? ` e <b>${money(sum.left)}</b> a pagar em ${mName}.` : '.') + dueNote;
    const av = q('#b-avatar');
    av.innerHTML = s.user.photo
      ? `<img src="${escHtml(s.user.photo)}" alt="" referrerpolicy="no-referrer">`
      : escHtml(s.user.name.split(' ').map(p => p[0] ?? '').slice(0, 2).join('').toUpperCase() || 'B');
    const dot = q('#b-sync');
    dot.className = 'b-sync ' + s.sync.state;
    dot.title = s.sync.label;
  }

  function renderMoney(s: AppState, sum: MonthSummary, hist: MonthPoint[]): void {
    const label  = cap(new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    const manage = s.manageRecurring;
    const paidCount = sum.rows.filter(r => r.paid).length;
    const countHtml = !manage && sum.rows.length ? `<span class="b-count">${paidCount}/${sum.rows.length} pagos</span>` : '';
    const head = `
      <div class="b-card-h">
        <h2>Pagamentos <em>${label}</em>${countHtml}</h2>
        <div class="b-mn">
          <button class="b-icon sm" data-a="month" data-d="-1" aria-label="Mês anterior"><i class="ti ti-chevron-left"></i></button>
          <button class="b-icon sm" data-a="month" data-d="1" aria-label="Próximo mês"><i class="ti ti-chevron-right"></i></button>
          <button class="b-pillbtn${manage ? ' on' : ''}" data-a="manage"><i class="ti ti-${manage ? 'check' : 'settings-2'}"></i>${manage ? 'Pronto' : 'Fixas'}</button>
        </div>
      </div>`;

    let body: string;
    if (manage) {
      body = `<p class="b-muted" style="margin-bottom:10px">Despesas fixas se repetem todo mês. Marque como paga na visão do mês.</p>
        <div class="b-mng">${s.recurring.length ? s.recurring.map(r => `
          <div class="b-mrow"><span class="cn">${escHtml(r.name)}</span><span class="b-due ${r.dueDay ? 'upcoming' : 'none'}">${r.dueDay ? `dia ${r.dueDay}` : 'sem dia'}</span>${r.variable || !r.amount ? '<span class="b-due upcoming">variável</span>' : ''}<b>${r.amount ? money(r.amount) : 'sem valor'}</b>
            <button class="b-icon sm" data-a="edit-rec" data-id="${r._id}" aria-label="Editar"><i class="ti ti-pencil"></i></button>
            <button class="b-icon sm danger" data-a="del-rec" data-id="${r._id}" aria-label="Excluir"><i class="ti ti-trash"></i></button>
          </div>`).join('') : '<p class="b-empty">Nenhuma despesa fixa cadastrada.</p>'}</div>
        <div class="b-payacts"><button class="b-ghost" data-a="new-rec"><i class="ti ti-plus"></i> Nova despesa fixa</button></div>`;
    } else if (!sum.rows.length) {
      body = `<div class="b-empty-pay"><i class="ti ti-receipt-2"></i><p>Nenhum lançamento neste mês.</p>
        <div class="b-payacts"><button class="b-ghost" data-a="new-rec"><i class="ti ti-repeat"></i> Despesa fixa</button><button class="b-ghost" data-a="new-pay"><i class="ti ti-plus"></i> Avulso</button></div></div>`;
    } else {
      const ratio = sum.total > 0 ? sum.paid / sum.total : 0;
      const [int, cents = '00'] = money(sum.left).split(',');
      const prev  = hist[hist.length - 2];
      const delta = prev && prev.total > 0 ? (sum.total / prev.total - 1) * 100 : null;
      const lateHtml = sum.overdue.length
        ? `<p class="b-delta late"><i class="ti ti-alert-triangle"></i> ${sum.overdue.length} atrasada${sum.overdue.length === 1 ? '' : 's'} · ${money(sum.overdueAmount)}</p>` : '';
      const deltaHtml = lateHtml + (delta == null ? '' :
        `<p class="b-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1).replace('.', ',')}% no total vs. mês anterior</p>`);
      const act  = hist.filter(p => p.total > 0);
      const avg  = act.length ? act.reduce((a, p) => a + p.total, 0) / act.length : 0;
      const attrs = (r: MonthSummary['rows'][number]) =>
        `data-a="${r.kind === 'rec' ? (r.estimated ? 'edit-month' : 'rec-paid') : 'one-paid'}" data-id="${r.id}" data-pid="${r.payDocId}"`;

      body = `
        <div class="b-mm">
          <div><p class="b-label">Falta pagar</p><p class="b-big">${int}<small>,${cents}</small></p>${deltaHtml}</div>
          <div class="b-ringw"><svg viewBox="0 0 132 132"><circle class="tk" cx="66" cy="66" r="54"/><circle class="pg" cx="66" cy="66" r="54" stroke-dasharray="${RING}" stroke-dashoffset="${(RING * (1 - ratio)).toFixed(2)}"/></svg>
            <div class="b-ringc"><b>${Math.round(ratio * 100)}%</b><span>pago</span></div></div>
        </div>
        <div class="b-bar">${sum.rows.map((r, i) =>
          `<button class="b-seg-i${r.paid ? ' on' : ''}" style="flex:${Math.max(r.amount, 1)};--c:${PAL[i % PAL.length]}" ${attrs(r)} title="${escHtml(r.name)} · ${money(r.amount)}"></button>`).join('')}</div>
        <div class="b-chips">${sum.rows.map((r, i) => `
          <div class="b-chip ${r.status}${r.paid ? ' on' : ''}${r.estimated ? ' est' : ''}" style="--c:${PAL[i % PAL.length]}">
            <button class="b-chip-main" ${attrs(r)}><i class="b-dot"></i><span class="cn">${escHtml(r.name)}${r.adjusted ? ' <i class="ti ti-adjustments-horizontal b-adj" title="Ajustado só neste mês"></i>' : ''}</span>${dueBadge(r)}<b>${amountText(r)}</b><i class="ti ti-check b-ck"></i></button>
            ${r.kind === 'rec' ? `<button class="b-x" data-a="edit-month" data-id="${r.id}" title="Ajustar valor e vencimento só deste mês" aria-label="Ajustar este mês"><i class="ti ti-pencil"></i></button>` : ''}
            ${r.kind === 'one' ? `<button class="b-x" data-a="edit-pay" data-id="${r.id}" title="Editar / definir vencimento" aria-label="Editar"><i class="ti ti-pencil"></i></button>
            <button class="b-x" data-a="del-pay" data-id="${r.id}" title="Excluir" aria-label="Excluir"><i class="ti ti-trash"></i></button>` : ''}
          </div>`).join('')}</div>
        ${sum.estimatedCount ? `<p class="b-muted b-undated"><i class="ti ti-chart-dots"></i> ${sum.estimatedCount} despesa${sum.estimatedCount === 1 ? '' : 's'} aguardando o valor real${sum.estimatedAmount ? ` (previsão de ${money(sum.estimatedAmount)} já está no total)` : ''}. Clique em “informar valor”.</p>` : ''}
        ${sum.undated ? `<p class="b-muted b-undated"><i class="ti ti-calendar-question"></i> ${sum.undated} lançamento${sum.undated === 1 ? '' : 's'} sem vencimento. Use o lápis (ou "Fixas") para definir o dia.</p>` : ''}
        <div class="b-payacts"><button class="b-ghost" data-a="new-pay"><i class="ti ti-plus"></i> Avulso</button><button class="b-ghost" data-a="new-rec"><i class="ti ti-repeat"></i> Fixa</button></div>
        <div class="b-stats">
          <div class="b-stat"><span>Total do mês</span><b>${money(sum.total, 0)}</b></div>
          <div class="b-stat"><span>Já pago</span><b>${money(sum.paid, 0)}</b></div>
          <div class="b-stat"><span>Média 6 meses</span><b>${avg ? money(avg, 0) : '—'}</b></div>
        </div>`;
    }

    q('#b-money').innerHTML = head + body;
  }

  function renderTasks(s: AppState): void {
    const pendAll = s.tasks.filter(t => !t.done);
    q('#b-tcount').textContent = String(pendAll.length);

    const fl: Array<[string, string, number]> = [
      ['all',  'Todas', pendAll.length],
      ['none', 'Geral', pendAll.filter(t => !t.listId).length],
      ...s.lists.map(l => [l._id, `${l.emoji ?? ''} ${l.name}`.trim(), pendAll.filter(t => t.listId === l._id).length] as [string, string, number]),
    ];
    q('#b-fchips').innerHTML = fl.map(([f, name, n]) =>
      `<button class="b-fc${s.filter === f ? ' on' : ''}" data-a="filter" data-f="${f}">${escHtml(name)}${n ? ` <i>${n}</i>` : ''}</button>`).join('');

    const vis  = visibleTasks(s);
    const open = vis.filter(t => !t.done);
    const done = vis.filter(t => t.done);
    const row = (t: typeof vis[number]): string => {
      const lst = t.listId ? s.lists.find(l => l._id === t.listId) : undefined;
      const tag = s.filter === 'all' && lst
        ? `<span class="b-lt" style="--c:${PAL[hashIndex(lst._id, PAL.length)]}"><i></i>${escHtml(lst.name)}</span>` : '';
      return `<li class="b-tk${t.done ? ' done' : ''}">
        <button class="b-cb" data-a="done" data-id="${t._id}" aria-label="${t.done ? 'Reabrir' : 'Concluir'}"><i class="ti ti-check"></i></button>
        <div class="b-tt"><b>${escHtml(t.title)}</b>${t.note ? `<small>${escHtml(t.note)}</small>` : ''}${t.done ? '<small>some em 24h</small>' : ''}</div>
        ${tag}
        <button class="b-x" data-a="del-task" data-id="${t._id}" title="Excluir" aria-label="Excluir"><i class="ti ti-trash"></i></button>
      </li>`;
    };
    q('#b-tlist').innerHTML = vis.length
      ? [...open, ...done].map(row).join('')
      : `<li class="b-empty">Nada por aqui ainda. Digite acima e aperte Enter.</li>`;
  }

  function dueBadge(r: PayRow): string {
    if (r.status === 'paid') return r.dueDate ? `<span class="b-due paid">${String(r.dueDate.getDate()).padStart(2, '0')}/${String(r.dueDate.getMonth() + 1).padStart(2, '0')}</span>` : '';
    if (!r.dueDate) return '<span class="b-due none">sem venc.</span>';
    const dd = `${String(r.dueDate.getDate()).padStart(2, '0')}/${String(r.dueDate.getMonth() + 1).padStart(2, '0')}`;
    return `<span class="b-due ${r.status}">${dd}${r.status === 'overdue' ? ' · atrasada' : r.status === 'today' ? ' · hoje' : ''}</span>`;
  }

  function renderNext(sum: MonthSummary): void {
    const unpaid = sum.rows.filter(r => !r.paid);
    let body: string;
    if (!sum.rows.length)    body = '<p class="b-empty">Sem lançamentos neste mês.</p>';
    else if (!unpaid.length) body = '<p class="b-empty">Tudo pago neste mês 🎉</p>';
    else body = `<div class="b-dues">${unpaid.slice(0, 6).map(r => `
      <div class="b-du ${r.status}">
        <div class="b-dd"><b>${r.dueDate ? r.dueDate.getDate() : '?'}</b><span>${r.dueDate ? monthShort(r.dueDate) : 'sem'}</span></div>
        <div class="b-dn"><b>${escHtml(r.name)}</b><small>${dueText(r)} · ${amountText(r)}</small></div>
        ${r.kind === 'one' && !r.dueDate ? `<button class="b-icon sm" data-a="edit-pay" data-id="${r.id}" title="Definir vencimento" aria-label="Definir vencimento"><i class="ti ti-calendar-plus"></i></button>` : ''}
        ${r.estimated
          ? `<button class="b-pay fill" data-a="edit-month" data-id="${r.id}">Informar valor</button>`
          : `<button class="b-pay" data-a="${r.kind === 'rec' ? 'rec-paid' : 'one-paid'}" data-id="${r.id}" data-pid="${r.payDocId}">Pagar</button>`}
      </div>`).join('')}</div>${unpaid.length > 6 ? `<p class="b-muted" style="margin-top:8px">+${unpaid.length - 6} em aberto</p>` : ''}`;
    q('#b-next').innerHTML = `<div class="b-card-h"><h2>Próximos vencimentos${unpaid.length ? ` <span class="b-count">${unpaid.length}</span>` : ''}</h2></div>${body}`;
  }

  function renderLists(s: AppState): void {
    const tiles = s.lists.map(l => {
      const all  = s.tasks.filter(t => t.listId === l._id);
      const done = all.filter(t => t.done).length;
      return `<div class="b-tile${s.filter === l._id ? ' on' : ''}" style="--c:${PAL[hashIndex(l._id, PAL.length)]}" data-a="toggle-filter" data-f="${l._id}" role="button" tabindex="0">
        <div class="b-em">${escHtml(l.emoji ?? '📋')}</div>
        <div class="b-tb"><b>${escHtml(l.name)}</b><span>${all.length - done} aberta${all.length - done === 1 ? '' : 's'}</span>
          <div class="b-mini"><i style="width:${all.length ? done / all.length * 100 : 0}%"></i></div></div>
        <span class="b-tile-act">
          <button class="b-icon sm" data-a="edit-list" data-id="${l._id}" aria-label="Editar"><i class="ti ti-pencil"></i></button>
          <button class="b-icon sm danger" data-a="del-list" data-id="${l._id}" aria-label="Excluir"><i class="ti ti-trash"></i></button>
        </span>
      </div>`;
    }).join('');
    q('#b-lists').innerHTML = `<div class="b-card-h"><h2>Listas</h2></div><div class="b-tiles">${tiles}<button class="b-tile new" data-a="new-list"><i class="ti ti-plus"></i> Nova lista</button></div>`;
  }

  function renderTrend(hist: MonthPoint[]): void {
    const max  = Math.max(...hist.map(p => p.total), 1);
    const prev = hist[hist.length - 2];
    const cur  = hist[hist.length - 1]!;
    const delta = prev && prev.total > 0 ? (cur.total / prev.total - 1) * 100 : null;
    q('#b-trend').innerHTML = `
      <div class="b-card-h"><h2>Gasto mensal <em>últimos 6 meses</em></h2>${delta == null ? '' : `<span class="b-count">${delta >= 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')}% vs. anterior</span>`}</div>
      <div class="b-bars">${hist.map(p => `
        <div class="b-bc${p.current ? ' cur' : ''}"><em>${p.current && p.total ? money(p.total, 0) : ''}</em>
          <div class="b-col" style="--h:${p.total / max}"><i style="height:${p.total ? p.paid / p.total * 100 : 0}%"></i></div><span>${p.label}</span></div>`).join('')}</div>`;
  }

  function renderToday(s: AppState): void {
    const doneToday = s.tasks.filter(t => t.done && isToday(t.doneAt)).length;
    const pend = s.tasks.filter(t => !t.done).length;
    const pct  = doneToday + pend ? doneToday / (doneToday + pend) * 100 : 0;
    q('#b-today').innerHTML = `
      <div class="b-card-h"><h2>Hoje</h2></div>
      <div class="b-today-n"><b>${doneToday}</b><span>concluída${doneToday === 1 ? '' : 's'}</span></div>
      <div class="b-meter"><i style="width:${pct}%"></i></div>
      <p class="b-muted">${pend} ainda aberta${pend === 1 ? '' : 's'}. As concluídas somem sozinhas em 24h.</p>`;
  }

  function update(): void {
    const s    = ctx.state();
    const sum  = monthSummary(s);
    const hist = monthHistory(s, sum);
    renderHello(s, sum);
    renderMoney(s, sum, hist);
    renderTasks(s);
    renderNext(sum);
    renderLists(s);
    renderTrend(hist);
    renderToday(s);
  }

  // ─── paleta de comandos ───
  function buildItems(): void {
    const s = ctx.state();
    const A = ctx.actions;
    const text = cin.value.trim();
    items = [];
    if (text) {
      let name = text;
      let listId = filterListId(s.filter);
      let listName = listId ? s.lists.find(l => l._id === listId)?.name : undefined;
      const lm = text.match(/^\/(\S+)\s+(.+)$/);
      if (lm) {
        const found = s.lists.find(l => norm(l.name).startsWith(norm(lm[1]!)));
        if (found) { listId = found._id; listName = found.name; name = lm[2]!; }
      }
      const pm = name.match(/^(.*?)\s+(\d+(?:[.,]\d{1,2})?)(?:\s+dia\s+(\d{1,2}))?$/i);
      if (pm && pm[1]) {
        const amount = parseFloat(pm[2]!.replace(',', '.'));
        const now = new Date();
        const isCurrent = s.payYear === now.getFullYear() && s.payMonth === now.getMonth();
        const dueDay = parseDueDay(pm[3]) ?? (isCurrent ? now.getDate() : 1);
        items.push({
          icon: '$', title: `Novo pagamento avulso: ${pm[1]}`,
          hint: `${money(amount)} · vence dia ${dueDay}`,
          run: () => { void A.addOneOffPayment(pm[1]!, amount, dueDay); A.toast('Pagamento avulso criado'); },
        });
      }
      items.push({ icon: 'P', title: `Criar pendência: ${name}`, hint: listName ? `em ${listName}` : '', run: () => { void A.addTask(name, '', listId); A.toast('Pendência criada'); } });
    }
    const cmds: Array<[string, string, () => void]> = [
      ['→', 'Ir para Visão geral', () => setView('all')],
      ['→', 'Ir para Pendências',  () => setView('tasks')],
      ['→', 'Ir para Pagamentos',  () => setView('pay')],
      ['+', 'Nova lista…',         () => A.openListModal()],
      ['+', 'Nova despesa fixa…',  () => A.openRecurringModal()],
      ['◐', 'Alternar tema',       () => A.cycleTheme()],
      ['⎋', 'Sair',                () => A.logout()],
    ];
    cmds.filter(c => !text || norm(c[1]).includes(norm(text)))
        .forEach(c => items.push({ icon: c[0], title: c[1], hint: '', run: c[2] }));
    sel = Math.min(sel, Math.max(items.length - 1, 0));
    paint();
  }

  function paint(): void {
    clist.innerHTML = '';
    items.forEach((it, k) => {
      const li = document.createElement('li');
      li.className = 'b-pi' + (k === sel ? ' on' : '');
      const i = document.createElement('i'); i.textContent = it.icon;
      const b = document.createElement('b'); b.textContent = it.title;
      const s = document.createElement('small'); s.textContent = it.hint;
      li.append(i, b, s);
      li.addEventListener('click', () => run(k));
      li.addEventListener('mousemove', () => { if (sel !== k) { sel = k; paint(); } });
      clist.append(li);
    });
  }

  function run(k: number): void {
    const it = items[k];
    if (!it) return;
    closeCmd();
    it.run();
  }
  function openCmd(): void { cmd.hidden = false; cin.value = ''; sel = 0; buildItems(); cin.focus(); }
  function closeCmd(): void { cmd.hidden = true; }

  cin.addEventListener('input', () => { sel = 0; buildItems(); }, opts);
  cin.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(items.length, 1); paint(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(items.length, 1); paint(); }
    if (e.key === 'Enter')     { e.preventDefault(); run(sel); }
  }, opts);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (cmd.hidden) openCmd(); else closeCmd(); }
    if (e.key === 'Escape' && !cmd.hidden) closeCmd();
  }, opts);

  return {
    update,
    getView: () => (grid.dataset['view'] ?? 'all') as ViewId,
    destroy: () => { ac.abort(); root.innerHTML = ''; syncFab('all'); },
  };
}
