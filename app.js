/**
 * Cash App / PayPal Tracker — Main Application
 *
 * Architecture:
 *  - All CSV parsing is client-side (FileReader + PapaParse)
 *  - Normalized transactions stored in IndexedDB (persists across sessions)
 *  - User edits (client, category, notes) saved back to IndexedDB
 *  - Reports rendered from in-memory state, rebuilt on each tab switch
 */

// ─── Contractor category list ────────────────────────────────────────────────
const CATEGORIES = [
  // Income
  'Contract Income',
  'Recurring Income',
  'Other Income',
  // Expenses — contractor-specific
  'Materials & Supplies',
  'Labor (Paid)',
  'Subcontractor',
  'Equipment',
  'Fuel & Transportation',
  'Tools & Equipment',
  'Permits & Fees',
  'Business Expense',
  'Other Expense',
  // Non-income
  'Transfer In',
  'Transfer Out',
  'Refund',
  'Bitcoin',
];

// ─── State ───────────────────────────────────────────────────────────────────
let db = null;
let allTransactions = []; // in-memory working set

// ─── IndexedDB setup ─────────────────────────────────────────────────────────
async function initDB() {
  db = await idb.openDB('cashtracker', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('transactions')) {
        const store = database.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('date',   'date',   { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }
    },
  });
}

async function loadAllFromDB() {
  allTransactions = await db.getAll('transactions');
  allTransactions.sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

async function saveToDB(txn) {
  await db.put('transactions', txn);
}

async function clearDB() {
  await db.clear('transactions');
  allTransactions = [];
}

// ─── CSV Upload & Parsing ────────────────────────────────────────────────────
function detectParser(headers) {
  if (window.CashAppParser.detect(headers)) return window.CashAppParser;
  if (window.PayPalParser.detect(headers))  return window.PayPalParser;
  return null;
}

async function processCSVFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        if (!results.data.length) {
          reject(new Error('CSV is empty or unreadable.'));
          return;
        }
        const headers = results.meta.fields || [];
        const parser  = detectParser(headers);
        if (!parser) {
          reject(new Error(`Could not detect CSV format. Headers found: ${headers.slice(0,6).join(', ')}`));
          return;
        }
        const parsed = parser.parse(results.data);
        resolve({ parsed, source: parser === window.CashAppParser ? 'Cash App' : 'PayPal' });
      },
      error(err) { reject(err); },
    });
  });
}

async function handleFiles(files) {
  const statusEl = document.getElementById('upload-status');
  statusEl.className = 'upload-status';
  statusEl.classList.remove('hidden');

  let totalNew = 0, totalSkipped = 0;

  for (const file of files) {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.CSV')) {
      showStatus(`Skipped "${file.name}" — not a CSV file.`, 'error');
      continue;
    }

    try {
      const { parsed, source } = await processCSVFile(file);
      const existing = new Set(allTransactions.map(t => t.id));

      for (const txn of parsed) {
        if (existing.has(txn.id)) {
          totalSkipped++;
          continue;
        }
        // Merge any persisted user edits that may exist under the same ID
        const persisted = await db.get('transactions', txn.id);
        const merged = persisted
          ? { ...txn, userCategory: persisted.userCategory, userClient: persisted.userClient, notes: persisted.notes }
          : txn;
        await saveToDB(merged);
        allTransactions.push(merged);
        totalNew++;
        existing.add(txn.id);
      }

      showStatus(
        `Imported ${totalNew} new transaction(s) from ${source}${totalSkipped ? ` (${totalSkipped} duplicates skipped)` : ''}.`,
        'success'
      );
    } catch (err) {
      showStatus(`Error processing "${file.name}": ${err.message}`, 'error');
    }
  }

  allTransactions.sort((a, b) => b.date.localeCompare(a.date));
  onDataChanged();
}

function showStatus(msg, type) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.className = `upload-status ${type}`;
  el.classList.remove('hidden');
}

// ─── UI: tabs ────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add('active');
      renderActiveReport(tab);
    });
  });
}

function renderActiveReport(tab) {
  const txns = allTransactions;
  if (tab === 'by-client')  window.ByClientReport.render(txns);
  if (tab === 'by-month')   window.ByMonthReport.render(txns);
  if (tab === 'schedule-c') window.ScheduleCReport.render(txns);
}

// ─── UI: transaction table ───────────────────────────────────────────────────
function getFilters() {
  return {
    source:   document.getElementById('filter-source').value,
    category: document.getElementById('filter-category').value,
    client:   document.getElementById('filter-client').value.toLowerCase(),
    month:    document.getElementById('filter-month').value,
  };
}

function filteredTransactions() {
  const f = getFilters();
  return allTransactions.filter(t => {
    if (f.source   && t.source !== f.source)                                   return false;
    if (f.category && (t.userCategory || t.autoCategory) !== f.category)       return false;
    if (f.client   && !(t.userClient || t.counterparty || '').toLowerCase().includes(f.client)) return false;
    if (f.month    && !t.date.startsWith(f.month))                             return false;
    return true;
  });
}

function renderTransactionTable() {
  const tbody = document.getElementById('txn-body');
  const empty = document.getElementById('txn-empty');
  const rows  = filteredTransactions();

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = rows.map(t => {
    const cat     = t.userCategory || t.autoCategory;
    const client  = t.userClient   || '';
    const notes   = t.notes        || '';
    const cp      = t.counterparty || '';
    const rowCls  = t.isBitcoin ? 'bitcoin-row' : '';

    return `
      <tr class="${rowCls}" data-id="${esc(t.id)}">
        <td>${t.date}</td>
        <td>${sourceBadge(t.source)}</td>
        <td>${esc(t.type)}</td>
        <td class="num ${t.gross >= 0 ? 'amount-pos' : 'amount-neg'}">${money(t.gross)}</td>
        <td class="num ${t.fee < 0 ? 'amount-neg' : ''}">${money(t.fee)}</td>
        <td class="num ${t.net >= 0 ? 'amount-pos' : 'amount-neg'}">${money(t.net)}</td>
        <td>${esc(cp)}</td>
        <td class="editable ${client ? 'has-value' : ''}" data-field="userClient" data-type="client"
            title="Click to assign client name">${esc(client) || '—'}</td>
        <td class="editable has-value" data-field="userCategory" data-type="category"
            title="Click to change category">${catBadge(cat)}</td>
        <td class="editable ${notes ? 'has-value' : ''}" data-field="notes" data-type="notes"
            title="Click to add notes">${esc(notes) || '—'}</td>
      </tr>
    `;
  }).join('');

  // Attach click handlers for editable cells
  tbody.querySelectorAll('td.editable').forEach(cell => {
    cell.addEventListener('click', e => {
      const row   = cell.closest('tr');
      const id    = row.dataset.id;
      const field = cell.dataset.field;
      const type  = cell.dataset.type;
      openEditor(cell, id, field, type);
    });
  });
}

// ─── Summary bar ─────────────────────────────────────────────────────────────
function updateSummaryBar() {
  const active = allTransactions.filter(t => !t.excluded && !t.isBitcoin);
  const income = active.filter(t => {
    const cat = t.userCategory || t.autoCategory;
    return ['Contract Income','Other Income','Recurring Income'].includes(cat);
  });
  const totalIncome = income.reduce((s, t) => s + t.net, 0);
  const totalFees   = active.reduce((s, t) => s + t.fee, 0);
  const hasBitcoin  = allTransactions.some(t => t.isBitcoin);

  document.getElementById('summary-income').innerHTML =
    `Net Income: <strong>${money(totalIncome)}</strong>`;
  document.getElementById('summary-fees').innerHTML =
    `Platform Fees: <strong>${money(totalFees)}</strong>`;
  document.getElementById('summary-txns').innerHTML =
    `Transactions: <strong>${allTransactions.length}</strong>`;

  document.getElementById('bitcoin-notice').classList.toggle('hidden', !hasBitcoin);
}

// ─── Inline editor ────────────────────────────────────────────────────────────
let currentEditId    = null;
let currentEditField = null;
let currentEditCell  = null;

function openEditor(cell, id, field, type) {
  currentEditId    = id;
  currentEditField = field;
  currentEditCell  = cell;

  const txn   = allTransactions.find(t => t.id === id);
  const value = txn ? (txn[field] || '') : '';

  const popup   = document.getElementById('editor-popup');
  const overlay = document.getElementById('editor-overlay');
  const label   = document.getElementById('editor-label');
  const input   = document.getElementById('editor-input');
  const sug     = document.getElementById('editor-suggestions');

  label.textContent = type === 'client' ? 'Client Name'
    : type === 'category' ? 'Category'
    : 'Notes';

  input.value = type === 'category' ? (txn?.userCategory || txn?.autoCategory || '') : value;

  // Position popup near the cell
  const rect = cell.getBoundingClientRect();
  const top  = Math.min(rect.bottom + 4, window.innerHeight - 220);
  const left = Math.min(rect.left, window.innerWidth - 320);
  popup.style.top  = `${top + window.scrollY}px`;
  popup.style.left = `${left}px`;
  popup.style.position = 'absolute';

  popup.classList.remove('hidden');
  overlay.classList.remove('hidden');
  input.focus();
  input.select();

  // Suggestions
  sug.innerHTML = '';
  sug.className = 'editor-suggestions';

  if (type === 'category') {
    showSuggestions(CATEGORIES, input.value);
  } else if (type === 'client') {
    const knownClients = [...new Set(
      allTransactions
        .map(t => t.userClient || t.counterparty)
        .filter(Boolean)
    )].sort();
    showSuggestions(knownClients, input.value);
  }

  input.addEventListener('input', () => {
    if (type === 'category') {
      showSuggestions(CATEGORIES, input.value);
    } else if (type === 'client') {
      const known = [...new Set(
        allTransactions.map(t => t.userClient || t.counterparty).filter(Boolean)
      )].sort();
      showSuggestions(known, input.value);
    }
  }, { once: false });
}

function showSuggestions(list, filter) {
  const sug = document.getElementById('editor-suggestions');
  const q   = filter.toLowerCase();
  const matches = list.filter(s => s.toLowerCase().includes(q));
  if (!matches.length) { sug.className = 'editor-suggestions'; return; }

  sug.className = 'editor-suggestions has-items';
  sug.innerHTML = matches.map(s =>
    `<div class="suggestion-item">${esc(s)}</div>`
  ).join('');

  sug.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      document.getElementById('editor-input').value = item.textContent;
      saveEdit();
    });
  });
}

async function saveEdit() {
  const input = document.getElementById('editor-input');
  const value = input.value.trim();

  closeEditor();

  const idx = allTransactions.findIndex(t => t.id === currentEditId);
  if (idx < 0) return;

  const txn = { ...allTransactions[idx], [currentEditField]: value || null };
  allTransactions[idx] = txn;
  await saveToDB(txn);

  renderTransactionTable();
  updateSummaryBar();
}

function closeEditor() {
  document.getElementById('editor-popup').classList.add('hidden');
  document.getElementById('editor-overlay').classList.add('hidden');
  document.getElementById('editor-suggestions').innerHTML = '';
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  const rows = filteredTransactions();
  if (!rows.length) { alert('No transactions to export.'); return; }

  const headers = ['Date','Source','Type','Gross','Fee','Net','Counterparty',
    'Client','Category','Notes','Raw Notes','Is Bitcoin'];
  const csv = [
    headers.join(','),
    ...rows.map(t => [
      t.date,
      t.source,
      t.type,
      t.gross,
      t.fee,
      t.net,
      csvEsc(t.counterparty),
      csvEsc(t.userClient || ''),
      csvEsc(t.userCategory || t.autoCategory),
      csvEsc(t.notes),
      csvEsc(t.rawNotes),
      t.isBitcoin ? 'yes' : 'no',
    ].join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
function onDataChanged() {
  const hasData = allTransactions.length > 0;

  document.getElementById('main-nav').classList.toggle('hidden', !hasData);
  document.getElementById('summary-bar').classList.toggle('hidden', !hasData);
  document.getElementById('upload-actions').classList.toggle('hidden', !hasData);

  renderTransactionTable();
  updateSummaryBar();

  // Re-render whichever report tab is active
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab && activeTab !== 'transactions') renderActiveReport(activeTab);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function csvEsc(s) {
  const str = String(s || '');
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function money(n) {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function sourceBadge(source) {
  const cls = source === 'Cash App' ? 'source-cashapp' : 'source-paypal';
  return `<span class="source-badge ${cls}">${esc(source)}</span>`;
}

function catBadge(cat) {
  const cls = catClass(cat);
  return `<span class="cat-badge ${cls}">${esc(cat)}</span>`;
}

function catClass(cat) {
  if (['Contract Income','Other Income','Recurring Income'].includes(cat)) return 'cat-income';
  if (cat === 'Refund')  return 'cat-refund';
  if (cat === 'Bitcoin') return 'cat-bitcoin';
  if (['Transfer In','Transfer Out'].includes(cat)) return 'cat-transfer';
  if (['Materials & Supplies','Labor (Paid)','Subcontractor','Equipment',
       'Fuel & Transportation','Tools & Equipment','Permits & Fees',
       'Business Expense','Other Expense'].includes(cat)) return 'cat-expense';
  return 'cat-other';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await initDB();
  await loadAllFromDB();

  initTabs();

  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
    fileInput.value = '';
  });
  dropZone.addEventListener('click', e => {
    if (e.target.tagName !== 'LABEL') fileInput.click();
  });

  // Filters
  ['filter-source','filter-category','filter-client','filter-month'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTransactionTable);
  });
  document.getElementById('filter-reset').addEventListener('click', () => {
    document.getElementById('filter-source').value   = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-client').value   = '';
    document.getElementById('filter-month').value    = '';
    renderTransactionTable();
  });

  // Editor popup buttons
  document.getElementById('editor-save').addEventListener('click', saveEdit);
  document.getElementById('editor-cancel').addEventListener('click', closeEditor);
  document.getElementById('editor-overlay').addEventListener('click', closeEditor);
  document.getElementById('editor-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  saveEdit();
    if (e.key === 'Escape') closeEditor();
  });

  // Export / Print / Clear
  document.getElementById('export-btn').addEventListener('click', exportCSV);
  document.getElementById('print-btn').addEventListener('click', () => window.print());
  document.getElementById('clear-all-btn').addEventListener('click', async () => {
    if (!confirm('Delete all imported transactions and user edits? This cannot be undone.')) return;
    await clearDB();
    document.getElementById('upload-status').classList.add('hidden');
    onDataChanged();
  });

  // If we already have data from a previous session, show it
  onDataChanged();
}

init().catch(console.error);
