export interface Task {
  _id:    string;
  title:  string;
  note?:  string;
  done:   boolean;
  doneAt: number | null;
  listId?: string;
}

export interface TaskList {
  _id:   string;
  name:  string;
  emoji: string;
}

export interface Recurring {
  _id:       string;
  name:      string;
  amount:    number;
  dueDay?:   number;
  variable?: boolean;
}

export interface Payment {
  _id:          string;
  description:  string;
  amount:       number;
  month:        string;
  paid:         boolean;
  recurringId?: string;
  dueDay?:      number;
  edited?:          boolean;
  amountConfirmed?: boolean;
}

// 'all' = todas · 'none' = sem lista · qualquer outro valor = id de uma lista
export type Filter = string;
export type LayoutId = 'b' | 'c';

export interface SyncInfo {
  state: 'syncing' | 'ok' | 'error';
  label: string;
}

export interface AppState {
  tasks:           Task[];
  lists:           TaskList[];
  recurring:       Recurring[];
  payments:        Payment[];
  filter:          Filter;
  payYear:         number;
  payMonth:        number;
  manageRecurring: boolean;
  user:            { name: string; photo: string };
  sync:            SyncInfo;
}

export interface AppActions {
  setFilter:           (f: Filter) => void;
  toggleDone:          (id: string) => void;
  deleteTask:          (id: string) => void;
  addTask:             (title: string, note: string, listId: string | null) => Promise<void>;
  toggleRecurringPaid: (recId: string, paymentId: string) => void;
  toggleOneOffPaid:    (id: string) => void;
  deletePayment:       (id: string) => void;
  addOneOffPayment:    (description: string, amount: number, dueDay: number) => Promise<void>;
  shiftMonth:          (delta: number) => void;
  toggleManage:        () => void;
  openTaskModal:       () => void;
  openPaymentModal:    (id?: string) => void;
  openRecurringModal:  (id?: string) => void;
  openMonthModal:      (recId: string) => void;
  deleteRecurring:     (id: string) => void;
  openListModal:       (id?: string) => void;
  deleteList:          (id: string) => void;
  cycleTheme:          () => void;
  logout:              () => void;
  toast:               (msg: string) => void;
}

export interface Ctx {
  state:   () => AppState;
  actions: AppActions;
}

export type ViewId = 'all' | 'tasks' | 'pay';

export interface Layout {
  update:  () => void;
  destroy: () => void;
  getView: () => ViewId;
}
