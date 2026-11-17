import type { AppState, Ctx, Layout } from './types';
import {
  escHtml, money, monthSummary, visibleTasks, filterListId, hashIndex, cap, dueText, monthShort, syncFab,
  type MonthSummary, type PayRow,
} from './util';
import './layout-c.css';

const COLORS = ['#ffd23f', '#ff8fb1', '#b79cff', '#7ae582', '#ff9f5a', '#6ec1ff'];
const TILTS  = ['-2deg', '1.5deg', '-1deg', '2deg', '-1.5deg', '1deg'];
const CONFETTI = ['#ffd23f', '#ff8fb1', '#6ec1ff', '#7ae582', '#ff9f5a', '#b79cff'];

function amountText(r: PayRow): string {
  if (r.noValue)   return 'a informar';
  if (r.estimated) return `~${money(r.amount)}`;
  return money(r.amount);
}

type View = 'all' | 'tasks' | 'pay';
const PREVIEW_TASKS = 6;
const PREVIEW_PAY   = 5;

const EYES = {
  normal: '<circle cx="51" cy="22" r="3.6" fill="#121212"/><circle cx="52.3" cy="20.8" r="1.1" fill="#fff"/>',
  happy:  '<path d="M46.5 23.5q4.5-6 9 0" fill="none" stroke="#121212" stroke-width="3.2" stroke-linecap="round"/><circle cx="54" cy="31" r="3.4" fill="#ff8fb1" opacity=".85"/>',
  worry:  '<circle cx="51" cy="22" r="3.6" fill="#121212"/><circle cx="52.3" cy="20.8" r="1.1" fill="#fff"/><path d="M45 15l8-3" stroke="#121212" stroke-width="2.6" stroke-linecap="round"/><path d="M61 6q3.6 4.2 0 7q-3.6-2.8 0-7z" fill="#6ec1ff" stroke="#121212" stroke-width="1.6"/>',
};

const SHELL = `
<div class="c-root">
  <div class="c-ticker"><div class="c-track" id="c-track"></div></div>

  <header class="c-hero">
    <svg id="c-mascot" viewBox="0 0 80 72" aria-hidden="true">
      <g stroke="#121212" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M30 57v10M41 57v10" fill="none"/>
        <polygon points="15,38 3,53 21,53" fill="#ff8fb1"/>
        <rect x="14" y="32" width="38" height="26" rx="11" fill="#ffd23f" transform="rotate(-8 33 45)"/>
        <polygon points="20,39 45,33 43,45 20,47" fill="#6ec1ff"/>
        <circle cx="47" cy="24" r="14" fill="#ffd23f"/>
        <polygon points="59,22 73,26 59,31" fill="#ff9f5a"/>
      </g>
      <g id="c-face"></g>
    </svg>
    <div class="c-title">
      <h1>Birdy</h1>
      <p class="c-tagline">pendências &amp; contas, sem drama. <span class="c-sync" id="c-sync"></span></p>
    </div>
    <div class="c-speech" id="c-speech"></div>
    <div class="c-hero-r">
      <div class="c-stk pink"><small>pendências</small><b id="c-spend">0</b></div>
      <div class="c-stk red" id="c-slate" hidden><small>atrasadas</small><b id="c-slate-n">0</b></div>
      <div class="c-stk blue"><small>a pagar</small><b class="c-mono" id="c-sleft">R$ 0</b></div>
      <div class="c-stk date" id="c-date"></div>
      <div class="c-tools">
        <button class="c-tbtn" data-a="theme" title="Alternar tema" aria-label="Alternar tema"><i class="ti ti-brightness-auto js-theme-icon"></i></button>
        <button class="c-tbtn" data-a="logout" title="Sair" aria-label="Sair"><i class="ti ti-logout"></i></button>
      </div>
    </div>
  </header>

  <nav class="c-nav" id="c-nav" aria-label="Telas">
    <button class="c-tab on" data-a="view" data-v="all"><i class="ti ti-layout-dashboard"></i> Painel geral</button>
    <button class="c-tab" data-a="view" data-v="tasks"><i class="ti ti-checklist"></i> Pendências <i class="c-tabn" id="c-tn-tasks">0</i></button>
    <button class="c-tab" data-a="view" data-v="pay"><i class="ti ti-wallet"></i> Pagamentos <i class="c-tabn" id="c-tn-pay">0</i></button>
  </nav>

  <main class="c-board" id="c-board" data-view="all">
    <aside class="c-lists" id="c-lists"></aside>

    <section class="c-tasks">
      <h2><span>Pendências</span><i class="c-badge" id="c-tbadge">0</i></h2>
      <div class="c-qa">
        <input id="c-qin" placeholder="O que precisa ser feito?" autocomplete="off">
        <button class="c-add c-press" data-a="add">ADD ↵</button>
      </div>
      <div class="c-note" id="c-qnote" hidden><input id="c-qnin" placeholder="Detalhes (opcional)…" autocomplete="off"></div>
      <p class="c-hintl"><kbd>↵</kbd> adiciona · <kbd>Tab</kbd> abre detalhes · concluídas somem em 24h</p>
      <ul class="c-tlist" id="c-tlist"></ul>
    </section>

    <section class="c-pay" id="c-pay"></section>
  </main>
</div>`;

export function mountC(root: HTMLElement, ctx: Ctx): Layout {
  const ac   = new AbortController();
  const opts = { signal: ac.signal };
  root.innerHTML = SHELL;

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const mascot = q<HTMLElement>('#c-mascot');
  const qin    = q<HTMLInputElement>('#c-qin');
  const qnote  = q('#c-qnote');
  const qnin   = q<HTMLInputElement>('#c-qnin');

  const board = q('#c-board');
  let view: View = 'all';
  let lastMood   = '';
  let lastTicker = '';

  function setView(v: View): void {
    view = v;
    board.dataset['view'] = v;
    root.querySelectorAll<HTMLElement>('#c-nav .c-tab').forEach(b => b.classList.toggle('on', b.dataset['v'] === v));
    syncFab(v);
    update();
    q('#c-nav').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── efeitos ───
  function hop(): void {
    mascot.classList.remove('hop');
    void mascot.getBoundingClientRect();
    mascot.classList.add('hop');
  }
  function burst(x: number, y: number): void {
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('i');
      p.className = 'c-cf';
      const ang = Math.random() * Math.PI * 2;
      const d   = 60 + Math.random() * 100;
      p.style.cssText = `left:${x}px;top:${y}px;background:${CONFETTI[i % 6]};--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d - 50}px;--rot:${Math.random() * 720 - 360}deg`;
      document.body.append(p);
      setTimeout(() => p.remove(), 900);
    }
  }
  function celebrate(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    hop();
  }

  // ─── adicionar pendência ───
  async function addFromInput(): Promise<void> {
    const title = qin.value.trim();
    if (!title) { qin.focus(); return; }
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
    switch (a) {
      case 'view':       setView((el.dataset['v'] ?? 'all') as View); break;
      case 'add':        void addFromInput(); break;
      case 'filter':     A.setFilter(el.dataset['f'] ?? 'all'); break;
      case 'done': {
        const t = ctx.state().tasks.find(x => x._id === id);
        if (t && !t.done) celebrate(el);
        A.toggleDone(id);
        break;
      }
      case 'del-task':   A.deleteTask(id); break;
      case 'rec-paid':   if (el.dataset['paid'] === '0') celebrate(el); A.toggleRecurringPaid(id, el.dataset['pid'] ?? ''); break;
      case 'one-paid':   if (el.dataset['paid'] === '0') celebrate(el); A.toggleOneOffPaid(id); break;
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
    }
  }, opts);

  // ─── render ───
  function renderHero(s: AppState, sum: MonthSummary): void {
    const total = s.tasks.length;
    const done  = s.tasks.filter(t => t.done).length;
    const pend  = total - done;
    const happy = total > 0 && (pend === 0 || done / total >= 0.5);
    const late = sum.overdue.length;
    const moodKey: keyof typeof EYES = late ? 'worry' : happy ? 'happy' : 'normal';
    if (moodKey !== lastMood) { q('#c-face').innerHTML = EYES[moodKey]; lastMood = moodKey; }

    q('#c-speech').textContent =
      late        ? `Opa! ${late} conta${late === 1 ? '' : 's'} atrasada${late === 1 ? '' : 's'}. Bora pagar?` :
      total === 0 ? 'Nenhuma pendência. Que paz!' :
      pend === 0  ? 'Tudo riscado! Hora de um café ☕' :
      happy       ? `Mais da metade! Faltam só ${pend}.` :
                    `Faltam ${pend} pendência${pend === 1 ? '' : 's'}. Bora?`;
    q('#c-slate').hidden = !late;
    q('#c-slate-n').textContent = String(late);

    q('#c-spend').textContent = String(pend);
    q('#c-sleft').textContent = money(sum.left, 0);
    q('#c-tbadge').textContent = String(pend);
    q('#c-tn-tasks').textContent = String(pend);
    const openPay = sum.rows.filter(r => !r.paid).length;
    const tnPay = q('#c-tn-pay');
    tnPay.textContent = String(openPay);
    tnPay.classList.toggle('late', late > 0);

    const now = new Date();
    q('#c-date').innerHTML = `<small>${now.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small><b>${now.getDate()}</b><small>${now.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</small>`;

    const sy = q('#c-sync');
    sy.className = 'c-sync ' + s.sync.state;
    sy.textContent = s.sync.label.toLowerCase();

    const mName = new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase();
    const msgs = [
      ...(late ? [`⚠ ${late} CONTA${late === 1 ? '' : 'S'} ATRASADA${late === 1 ? '' : 'S'}`] : []),
      'BIRDY',
      `${pend} PENDÊNCIA${pend === 1 ? '' : 'S'} ABERTA${pend === 1 ? '' : 'S'}`,
      'BORA RISCAR COISAS',
      sum.rows.length ? `${money(sum.left, 0)} A PAGAR EM ${mName}` : `${mName} TÁ ACABANDO`,
      'UMA PENDÊNCIA DE CADA VEZ',
      'CONTA PAGA É CONTA DORMINDO EM PAZ',
    ];
    const key = msgs.join('|');
    if (key !== lastTicker) {
      lastTicker = key;
      q('#c-track').innerHTML = [...msgs, ...msgs, ...msgs, ...msgs].map(m => `<span>${m}</span><span>✦</span>`).join('');
    }
  }

  function renderLists(s: AppState): void {
    const open = s.tasks.filter(t => !t.done);
    const chip = (id: string, emoji: string, name: string, color: string, tilt: string, n: number, editable: boolean): string =>
      `<div class="c-chip${s.filter === id ? ' on' : ''}" style="--c:${color};--r:${tilt}" data-a="filter" data-f="${id}" role="button" tabindex="0">
        <span class="e">${emoji}</span><span class="nm">${escHtml(name)}</span>
        ${editable ? `<span class="c-chip-act">
          <button data-a="edit-list" data-id="${id}" aria-label="Editar lista"><i class="ti ti-pencil"></i></button>
          <button data-a="del-list" data-id="${id}" aria-label="Excluir lista"><i class="ti ti-trash"></i></button></span>` : ''}
        <span class="n">${n}</span>
      </div>`;
    q('#c-lists').innerHTML = `<h3>Listas</h3>` +
      chip('all',  '📌', 'Todas', '#6ec1ff', '1deg',   open.length, false) +
      chip('none', '📥', 'Geral', '#f4ecd8', '-1deg',  open.filter(t => !t.listId).length, false) +
      s.lists.map(l => {
        const i = hashIndex(l._id, COLORS.length);
        return chip(l._id, escHtml(l.emoji ?? '📋'), l.name, COLORS[i]!, TILTS[i]!, open.filter(t => t.listId === l._id).length, true);
      }).join('') +
      `<button class="c-chip new" data-a="new-list">+ nova lista</button>`;
  }

  function renderTasks(s: AppState): void {
    const vis  = visibleTasks(s);
    const open = vis.filter(t => !t.done);
    const done = vis.filter(t => t.done);
    const row = (t: typeof vis[number]): string => {
      const lst   = t.listId ? s.lists.find(l => l._id === t.listId) : undefined;
      const color = lst ? COLORS[hashIndex(lst._id, COLORS.length)]! : '#ffd23f';
      const pill  = s.filter === 'all' && lst
        ? `<span class="c-pill" style="--c:${color}">${escHtml(lst.emoji ?? '')} ${escHtml(lst.name)}</span>` : '';
      return `<li class="c-tk${t.done ? ' done' : ''}" style="--c:${color}">
        <button class="c-cb" data-a="done" data-id="${t._id}" aria-label="${t.done ? 'Reabrir' : 'Concluir'}"></button>
        <div class="c-tx"><b>${escHtml(t.title)}</b>${t.note ? `<small>${escHtml(t.note)}</small>` : ''}${t.done ? '<small>some em 24h</small>' : ''}</div>
        ${pill}
        <button class="c-del" data-a="del-task" data-id="${t._id}" aria-label="Excluir"><i class="ti ti-x"></i></button>
      </li>`;
    };
    // No painel geral mostra só as abertas mais recentes; a aba Pendências mostra tudo.
    const overview = view === 'all';
    const shown    = overview ? open.slice(0, PREVIEW_TASKS) : [...open, ...done];
    const hidden   = overview ? open.length - shown.length : 0;
    let html: string;
    if (!vis.length)        html = `<li class="c-empty"><span>📝</span>Nada por aqui ainda.<br>Escreva ali em cima e aperte Enter.</li>`;
    else if (!shown.length) html = `<li class="c-empty"><span>🎉</span>Tudo riscado por aqui!</li>`;
    else                    html = shown.map(row).join('');
    if (overview && (hidden > 0 || done.length > 0)) {
      html += `<li class="c-morewrap"><button class="c-dashbtn c-press" data-a="view" data-v="tasks">ver todas as pendências${hidden ? ` (+${hidden})` : ''} →</button></li>`;
    }
    q('#c-tlist').innerHTML = html;
  }

  function renderPay(s: AppState, sum: MonthSummary): void {
    const label = cap(new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    const short = new Date(s.payYear, s.payMonth, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const manage = s.manageRecurring;

    let html = `<h2><span>Contas</span><i class="c-badge green">${short}</i></h2>
      <div class="c-mnav">
        <button class="c-sq" data-a="month" data-d="-1" aria-label="Mês anterior"><i class="ti ti-chevron-left"></i></button>
        <b>${label}</b>
        <button class="c-sq" data-a="month" data-d="1" aria-label="Próximo mês"><i class="ti ti-chevron-right"></i></button>
        <button class="c-manage${manage ? ' on' : ''}" data-a="manage">${manage ? 'pronto ✓' : 'fixas'}</button>
      </div>`;

    if (manage) {
      html += `<div class="c-addrow top"><button class="c-dashbtn c-press" data-a="new-rec">+ nova despesa fixa</button></div>
      <div class="c-tickets">${s.recurring.length ? s.recurring.map(r => `
        <div class="c-ticket upcoming">
          <div class="c-dd ${r.dueDay ? 'upcoming' : 'none'}"><b>${r.dueDay ?? '?'}</b><span>${r.dueDay ? 'todo mês' : 'sem dia'}</span></div>
          <div class="c-l"><b>${escHtml(r.name)}</b><small>${r.dueDay ? `vence todo dia ${r.dueDay}` : 'vencimento a definir em cada mês'}${r.variable || !r.amount ? ' · valor variável' : ''}</small></div>
          <div class="c-r"><span class="v">${r.amount ? money(r.amount) : 'sem valor'}</span>
            <span class="c-mact"><button class="c-sq sm" data-a="edit-rec" data-id="${r._id}" aria-label="Editar"><i class="ti ti-pencil"></i></button>
            <button class="c-sq sm" data-a="del-rec" data-id="${r._id}" aria-label="Excluir"><i class="ti ti-trash"></i></button></span></div>
        </div>`).join('') : '<div class="c-card c-emptyp">Nenhuma despesa fixa ainda.</div>'}</div>`;
      q('#c-pay').innerHTML = html;
      return;
    }

    if (!sum.rows.length) {
      html += `<div class="c-card c-emptyp"><span>🧾</span>Nenhum lançamento neste mês.
        <div class="c-addrow"><button class="c-dashbtn c-press" data-a="new-rec">+ fixa</button><button class="c-dashbtn c-press" data-a="new-pay">+ avulso</button></div></div>`;
      q('#c-pay').innerHTML = html;
      return;
    }

    const ratio = sum.total > 0 ? sum.paid / sum.total : 0;
    const dd = (r: PayRow): string => r.dueDate
      ? `<div class="c-dd ${r.status}"><b>${r.dueDate.getDate()}</b><span>${monthShort(r.dueDate)}</span></div>`
      : `<div class="c-dd none"><b>?</b><span>sem</span></div>`;
    const ticket = (r: PayRow): string => `
      <div class="c-ticket ${r.status}${r.estimated ? ' est' : ''}">
        ${dd(r)}
        <div class="c-l"><b>${escHtml(r.name)}</b><small>${r.kind === 'rec' ? (r.variable ? 'valor variável' : 'todo mês') : 'avulso'}${r.adjusted ? ' · ajustado' : ''} · ${dueText(r)}</small></div>
        <div class="c-r"><span class="v">${amountText(r)}</span>
          <span class="c-mact">
            ${r.estimated
              ? `<button class="c-paybtn fill c-press" data-a="edit-month" data-id="${r.id}">informar valor</button>`
              : `<button class="c-paybtn c-press" data-a="${r.kind === 'rec' ? 'rec-paid' : 'one-paid'}" data-id="${r.id}" data-pid="${r.payDocId}" data-paid="${r.paid ? '1' : '0'}">${r.paid ? 'PAGO ✓' : 'pagar'}</button>`}
            ${r.kind === 'rec' && !r.estimated ? `<button class="c-sq sm" data-a="edit-month" data-id="${r.id}" aria-label="Ajustar valor e vencimento só deste mês"><i class="ti ti-pencil"></i></button>` : ''}
            ${r.kind === 'one' ? `<button class="c-sq sm" data-a="edit-pay" data-id="${r.id}" aria-label="Editar / definir vencimento"><i class="ti ti-pencil"></i></button>
            <button class="c-sq sm" data-a="del-pay" data-id="${r.id}" aria-label="Excluir"><i class="ti ti-x"></i></button>` : ''}
          </span></div>
      </div>`;
    const openRows = sum.rows.filter(r => !r.paid);
    const paidRows = sum.rows.filter(r => r.paid);
    // No painel geral só as contas em aberto mais urgentes; a aba Pagamentos mostra tudo.
    const overview  = view === 'all';
    const shownOpen = overview ? openRows.slice(0, PREVIEW_PAY) : openRows;
    const hiddenPay = overview ? openRows.length - shownOpen.length : 0;
    const openBlock = shownOpen.length
      ? `<div class="c-sec">Em aberto · por vencimento</div>${shownOpen.map(ticket).join('')}`
      : (overview ? '<div class="c-card c-emptyp"><span>🎉</span>Tudo pago neste mês!</div>' : '');
    const moreBtn = overview && (hiddenPay > 0 || paidRows.length > 0)
      ? `<button class="c-dashbtn c-press" data-a="view" data-v="pay">ver todos os pagamentos${hiddenPay ? ` (+${hiddenPay})` : ''} →</button>` : '';

    html += `
      <div class="c-addrow top"><button class="c-dashbtn c-press" data-a="new-pay">+ pagamento avulso</button><button class="c-dashbtn c-press" data-a="new-rec">+ despesa fixa</button></div>
      <div class="c-card c-meter">
        <div class="c-row"><div><small>Falta pagar</small><div class="c-big">${money(sum.left)}</div></div><div class="c-pct">${Math.round(ratio * 100)}% pago</div></div>
        <div class="c-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>
      </div>
      <div class="c-tickets">
        ${openBlock}
        ${!overview && paidRows.length ? `<div class="c-sec">Pagas</div>${paidRows.map(ticket).join('')}` : ''}
        ${moreBtn}
        ${!overview && sum.estimatedCount ? `<p class="c-hintl">🧾 ${sum.estimatedCount} despesa${sum.estimatedCount === 1 ? '' : 's'} aguardando o valor real${sum.estimatedAmount ? ` (previsão de ${money(sum.estimatedAmount)} já está no total)` : ''}. Toque em “informar valor”.</p>` : ''}
        ${!overview && sum.undated ? `<p class="c-hintl">📅 ${sum.undated} lançamento${sum.undated === 1 ? '' : 's'} sem vencimento. Toque no lápis (ou em “fixas”) e defina o dia.</p>` : ''}
      </div>
      <div class="c-total"><div><small>Total do mês</small><b class="c-mono">${money(sum.total)}</b></div><div style="text-align:right"><small>já pago</small><b class="c-mono sm">${money(sum.paid)}</b></div></div>`;
    q('#c-pay').innerHTML = html;
  }

  function update(): void {
    const s   = ctx.state();
    const sum = monthSummary(s);
    renderHero(s, sum);
    renderLists(s);
    renderTasks(s);
    renderPay(s, sum);
  }

  return {
    update,
    getView: () => view,
    destroy: () => { ac.abort(); root.innerHTML = ''; syncFab('all'); },
  };
}
