/**
 * By-Month report renderer
 */

window.ByMonthReport = {

  render(txns) {
    const el = document.getElementById('by-month-content');
    const active = txns.filter(t => !t.excluded && !t.isBitcoin);

    if (!active.length) {
      el.innerHTML = '<p class="empty-msg">No transactions yet.</p>';
      return;
    }

    // Group all transactions by YYYY-MM
    const byMonth = {};
    for (const t of active) {
      const month = t.date.slice(0, 7); // "2024-01"
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(t);
    }

    const months = Object.keys(byMonth).sort();

    // Summary table across all months
    let html = `<div class="report-section"><h2>Monthly Summary</h2>
      <table class="report-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num">Gross Income</th>
            <th class="num">Expenses</th>
            <th class="num">Platform Fees</th>
            <th class="num">Net</th>
            <th class="num">Transactions</th>
          </tr>
        </thead>
        <tbody>
    `;

    let totGross = 0, totExp = 0, totFees = 0, totNet = 0;

    for (const month of months) {
      const rows    = byMonth[month];
      const income  = rows.filter(t => isIncome(t));
      const expense = rows.filter(t => isExpense(t));
      const gross   = income.reduce((s, t) => s + t.gross, 0);
      const exp     = Math.abs(expense.reduce((s, t) => s + t.gross, 0));
      const fees    = rows.reduce((s, t) => s + t.fee, 0);
      const net     = gross - exp + fees; // fees are negative already

      totGross += gross; totExp += exp; totFees += fees; totNet += net;

      const label = formatMonth(month);
      html += `
        <tr>
          <td>${label}</td>
          <td class="num amount-pos">${fmt(gross)}</td>
          <td class="num amount-neg">${fmt(exp)}</td>
          <td class="num amount-neg">${fmt(Math.abs(fees))}</td>
          <td class="num ${net >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(net)}</td>
          <td class="num">${rows.length}</td>
        </tr>
      `;
    }

    html += `
          <tr class="total-row">
            <td>Total</td>
            <td class="num amount-pos">${fmt(totGross)}</td>
            <td class="num amount-neg">${fmt(totExp)}</td>
            <td class="num amount-neg">${fmt(Math.abs(totFees))}</td>
            <td class="num ${totNet >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(totNet)}</td>
            <td class="num">${active.length}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

    // Per-month breakdown sections
    for (const month of months) {
      const rows = [...byMonth[month]].sort((a, b) => a.date.localeCompare(b.date));
      html += `
        <div class="report-section">
          <h2>${formatMonth(month)}</h2>
          <table class="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Client / Counterparty</th>
                <th>Category</th>
                <th>Notes</th>
                <th class="num">Gross</th>
                <th class="num">Net</th>
              </tr>
            </thead>
            <tbody>
      `;
      for (const t of rows) {
        const cat = t.userCategory || t.autoCategory;
        const client = t.userClient || t.counterparty || '';
        html += `
          <tr>
            <td>${t.date}</td>
            <td>${badge(t.source)}</td>
            <td>${esc(client)}</td>
            <td>${catBadge(cat)}</td>
            <td>${esc(t.notes || t.rawNotes || '')}</td>
            <td class="num ${t.gross >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(t.gross)}</td>
            <td class="num ${t.net >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(t.net)}</td>
          </tr>
        `;
      }
      html += `</tbody></table></div>`;
    }

    el.innerHTML = html;
  },
};

function isIncome(t) {
  const cat = t.userCategory || t.autoCategory;
  return ['Contract Income', 'Other Income', 'Recurring Income'].includes(cat);
}

function isExpense(t) {
  const cat = t.userCategory || t.autoCategory;
  return [
    'Materials & Supplies', 'Labor (Paid)', 'Subcontractor',
    'Equipment', 'Fuel & Transportation', 'Tools & Equipment',
    'Permits & Fees', 'Other Expense', 'Business Expense',
  ].includes(cat);
}

function formatMonth(ym) {
  const [y, m] = ym.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m) - 1]} ${y}`;
}

function fmt(n) { return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function badge(source) {
  const cls = source === 'Cash App' ? 'source-cashapp' : 'source-paypal';
  return `<span class="source-badge ${cls}">${esc(source)}</span>`;
}
function catBadge(cat) {
  const cls = catClass(cat);
  return `<span class="cat-badge ${cls}">${esc(cat)}</span>`;
}
function catClass(cat) {
  if (['Contract Income','Other Income','Recurring Income'].includes(cat)) return 'cat-income';
  if (cat === 'Refund') return 'cat-refund';
  if (cat === 'Bitcoin') return 'cat-bitcoin';
  if (['Transfer In','Transfer Out'].includes(cat)) return 'cat-transfer';
  if (cat.includes('Expense') || cat === 'Materials & Supplies' || cat === 'Labor (Paid)' ||
      cat === 'Subcontractor' || cat === 'Equipment' || cat === 'Fuel & Transportation' ||
      cat === 'Tools & Equipment' || cat === 'Permits & Fees') return 'cat-expense';
  return 'cat-other';
}
