/**
 * By-Client report renderer
 */

window.ByClientReport = {

  /**
   * Render the by-client report into #by-client-content.
   * @param {object[]} txns - All normalized transactions
   */
  render(txns) {
    const el = document.getElementById('by-client-content');
    const income = txns.filter(t => !t.excluded && !t.isBitcoin && isIncome(t));

    if (!income.length) {
      el.innerHTML = '<p class="empty-msg">No income transactions yet. Upload a CSV and tag your clients.</p>';
      return;
    }

    // Group by effective client name
    const byClient = {};
    for (const t of income) {
      const client = t.userClient || t.counterparty || '(Unassigned)';
      if (!byClient[client]) byClient[client] = [];
      byClient[client].push(t);
    }

    // Sort clients by total gross descending
    const sorted = Object.entries(byClient).sort(
      ([, a], [, b]) => sumNet(b) - sumNet(a)
    );

    const totalGross = income.reduce((s, t) => s + t.gross, 0);
    const totalFees  = income.reduce((s, t) => s + t.fee,   0);
    const totalNet   = income.reduce((s, t) => s + t.net,   0);

    let html = `
      <div class="report-section">
        <h2>Income by Client</h2>
        <div class="report-grid">
          <div class="stat-card">
            <div class="label">Total Gross Income</div>
            <div class="value">${fmt(totalGross)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Platform Fees</div>
            <div class="value negative">${fmt(totalFees)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Net Income</div>
            <div class="value">${fmt(totalNet)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Clients</div>
            <div class="value neutral">${sorted.length}</div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th>Client</th>
              <th class="num">Transactions</th>
              <th class="num">Gross</th>
              <th class="num">Fees</th>
              <th class="num">Net</th>
              <th class="num">% of Income</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const [client, rows] of sorted) {
      const g = rows.reduce((s, t) => s + t.gross, 0);
      const f = rows.reduce((s, t) => s + t.fee,   0);
      const n = rows.reduce((s, t) => s + t.net,   0);
      const pct = totalGross > 0 ? ((g / totalGross) * 100).toFixed(1) : '0.0';
      html += `
        <tr>
          <td>${esc(client)}</td>
          <td class="num">${rows.length}</td>
          <td class="num amount-pos">${fmt(g)}</td>
          <td class="num amount-neg">${fmt(f)}</td>
          <td class="num amount-pos">${fmt(n)}</td>
          <td class="num">${pct}%</td>
        </tr>
      `;
    }

    html += `
            <tr class="total-row">
              <td>Total</td>
              <td class="num">${income.length}</td>
              <td class="num amount-pos">${fmt(totalGross)}</td>
              <td class="num amount-neg">${fmt(totalFees)}</td>
              <td class="num amount-pos">${fmt(totalNet)}</td>
              <td class="num">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    // Per-client detail tables
    for (const [client, rows] of sorted) {
      const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      html += `
        <div class="report-section">
          <h2>${esc(client)}</h2>
          <table class="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Notes</th>
                <th class="num">Gross</th>
                <th class="num">Fee</th>
                <th class="num">Net</th>
              </tr>
            </thead>
            <tbody>
      `;
      for (const t of sortedRows) {
        html += `
          <tr>
            <td>${t.date}</td>
            <td>${badge(t.source)}</td>
            <td>${esc(t.notes || t.rawNotes || '')}</td>
            <td class="num amount-pos">${fmt(t.gross)}</td>
            <td class="num amount-neg">${fmt(t.fee)}</td>
            <td class="num amount-pos">${fmt(t.net)}</td>
          </tr>
        `;
      }
      const rowNet = rows.reduce((s, t) => s + t.net, 0);
      html += `
              <tr class="total-row">
                <td colspan="5">Total</td>
                <td class="num amount-pos">${fmt(rowNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }

    el.innerHTML = html;
  },
};

function isIncome(t) {
  const incomeCategories = [
    'Contract Income', 'Other Income', 'Recurring Income',
  ];
  const cat = t.userCategory || t.autoCategory;
  return incomeCategories.includes(cat) || t.gross > 0 && !['Transfer In','Transfer Out','Refund','Bitcoin'].includes(cat);
}

function sumNet(rows) { return rows.reduce((s, t) => s + t.net, 0); }
function fmt(n) { return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function badge(source) {
  const cls = source === 'Cash App' ? 'source-cashapp' : 'source-paypal';
  return `<span class="source-badge ${cls}">${esc(source)}</span>`;
}
