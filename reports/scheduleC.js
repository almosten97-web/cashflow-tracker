/**
 * Schedule C report renderer — contractor-focused
 *
 * Maps app categories → IRS Schedule C line items for self-employed contractors.
 * Reference: Form 1040 Schedule C, Part I (Income) and Part II (Expenses)
 */

window.ScheduleCReport = {

  render(txns) {
    const el = document.getElementById('schedule-c-content');
    const active = txns.filter(t => !t.excluded && !t.isBitcoin);

    if (!active.length) {
      el.innerHTML = '<p class="empty-msg">No transactions yet.</p>';
      return;
    }

    // ── Income (Part I) ──────────────────────────────────────────
    const incomeCategories = ['Contract Income', 'Other Income', 'Recurring Income'];
    const income = active.filter(t => incomeCategories.includes(t.userCategory || t.autoCategory));
    const grossIncome = income.reduce((s, t) => s + t.gross, 0);
    const totalFees   = active.reduce((s, t) => s + t.fee, 0); // negative numbers

    // ── Expenses (Part II) ────────────────────────────────────────
    // IRS Schedule C expense lines relevant to contractors
    const EXPENSE_MAP = {
      'Materials & Supplies': { line: '22', label: 'Supplies (materials bought for jobs)' },
      'Labor (Paid)':         { line: '26', label: 'Wages paid (labor)' },
      'Subcontractor':        { line: '11', label: 'Contract labor (subcontractors)' },
      'Equipment':            { line: '13', label: 'Depreciation / equipment rental' },
      'Fuel & Transportation':{ line: '9',  label: 'Car and truck expenses (fuel)' },
      'Tools & Equipment':    { line: '22', label: 'Tools & small equipment (supplies)' },
      'Permits & Fees':       { line: '23', label: 'Taxes and licenses (permits)' },
      'Business Expense':     { line: '27', label: 'Other expenses' },
      'Other Expense':        { line: '27', label: 'Other expenses' },
    };

    // Group expenses by Schedule C line
    const byLine = {};
    for (const t of active) {
      const cat = t.userCategory || t.autoCategory;
      const mapping = EXPENSE_MAP[cat];
      if (!mapping) continue;
      const key = `${mapping.line}-${mapping.label}`;
      if (!byLine[key]) byLine[key] = { ...mapping, total: 0, txns: [] };
      byLine[key].total += Math.abs(t.gross);
      byLine[key].txns.push(t);
    }

    const totalExpenses = Object.values(byLine).reduce((s, g) => s + g.total, 0);
    const platformFeeDeduction = Math.abs(totalFees); // Cash App/PayPal fees are deductible (line 10 / bank charges)
    const netProfit = grossIncome - totalExpenses - platformFeeDeduction;

    // ── Refunds ──────────────────────────────────────────────────
    const refunds = active.filter(t => (t.userCategory || t.autoCategory) === 'Refund');
    const totalRefunds = Math.abs(refunds.reduce((s, t) => s + t.gross, 0));

    // ── Bitcoin notice ───────────────────────────────────────────
    const bitcoinRows = txns.filter(t => t.isBitcoin);

    let html = `
      <div class="report-section">
        <h2>Schedule C Summary — Self-Employed Contractor</h2>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px;">
          This is an estimate based on your tagged transactions. Verify with a tax professional before filing.
        </p>

        <!-- Part I: Income -->
        <h3>Part I — Gross Income</h3>
        <table class="report-table" style="margin-bottom:24px;">
          <thead>
            <tr><th>Line</th><th>Description</th><th class="num">Amount</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Gross receipts (contract payments received)</td>
              <td class="num amount-pos">${fmt(grossIncome)}</td>
            </tr>
            ${totalRefunds > 0 ? `
            <tr>
              <td>2</td>
              <td>Returns and allowances (refunds issued)</td>
              <td class="num amount-neg">(${fmt(totalRefunds)})</td>
            </tr>
            <tr>
              <td>3</td>
              <td>Net gross income after refunds</td>
              <td class="num amount-pos">${fmt(grossIncome - totalRefunds)}</td>
            </tr>` : ''}
            <tr class="total-row">
              <td colspan="2">Total Gross Income</td>
              <td class="num amount-pos">${fmt(grossIncome - totalRefunds)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Part II: Expenses -->
        <h3>Part II — Expenses</h3>
        <table class="report-table" style="margin-bottom:24px;">
          <thead>
            <tr><th>Line</th><th>Description</th><th class="num">Amount</th></tr>
          </thead>
          <tbody>
    `;

    // Sort by line number
    const linesSorted = Object.values(byLine).sort((a, b) =>
      parseInt(a.line) - parseInt(b.line)
    );

    for (const group of linesSorted) {
      html += `
        <tr>
          <td>${group.line}</td>
          <td>${esc(group.label)}</td>
          <td class="num amount-neg">${fmt(group.total)}</td>
        </tr>
      `;
    }

    if (platformFeeDeduction > 0) {
      html += `
        <tr>
          <td>10</td>
          <td>Commissions and fees (Cash App / PayPal transaction fees)</td>
          <td class="num amount-neg">${fmt(platformFeeDeduction)}</td>
        </tr>
      `;
    }

    html += `
            <tr class="total-row">
              <td colspan="2">Total Expenses</td>
              <td class="num amount-neg">${fmt(totalExpenses + platformFeeDeduction)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Net Profit -->
        <h3>Net Profit / Loss</h3>
        <table class="report-table" style="margin-bottom:24px;">
          <tbody>
            <tr>
              <td>Gross Income</td>
              <td class="num amount-pos">${fmt(grossIncome - totalRefunds)}</td>
            </tr>
            <tr>
              <td>Total Expenses</td>
              <td class="num amount-neg">(${fmt(totalExpenses + platformFeeDeduction)})</td>
            </tr>
            <tr class="total-row">
              <td><strong>Net Profit (Line 31)</strong></td>
              <td class="num ${netProfit >= 0 ? 'amount-pos' : 'amount-neg'}">
                <strong>${netProfit >= 0 ? '' : '('}${fmt(netProfit)}${netProfit < 0 ? ')' : ''}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Estimated Self-Employment Tax -->
        <h3>Estimated Self-Employment Tax (15.3%)</h3>
        <table class="report-table" style="margin-bottom:24px;">
          <tbody>
            <tr>
              <td>Net profit × 92.35% (SE income)</td>
              <td class="num">${fmt(Math.max(0, netProfit) * 0.9235)}</td>
            </tr>
            <tr>
              <td>SE tax (15.3%)</td>
              <td class="num amount-neg">${fmt(Math.max(0, netProfit) * 0.9235 * 0.153)}</td>
            </tr>
            <tr>
              <td>SE tax deduction (½ of SE tax, Schedule 1)</td>
              <td class="num amount-pos">${fmt(Math.max(0, netProfit) * 0.9235 * 0.153 * 0.5)}</td>
            </tr>
          </tbody>
        </table>
    `;

    if (bitcoinRows.length > 0) {
      html += `
        <div class="upload-status" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;margin-top:8px;">
          <strong>⚠ ${bitcoinRows.length} Bitcoin transaction(s) excluded from this report.</strong>
          Bitcoin gains/losses are reported on Schedule D (capital gains), not Schedule C. Consult a tax professional.
        </div>
      `;
    }

    html += `</div>`;

    // Expense transaction detail
    if (linesSorted.length > 0) {
      html += `<div class="report-section"><h2>Expense Transaction Detail</h2>`;
      for (const group of linesSorted) {
        html += `
          <h3 style="margin-bottom:8px;">Line ${group.line} — ${esc(group.label)} (${fmt(group.total)})</h3>
          <table class="report-table" style="margin-bottom:20px;">
            <thead>
              <tr><th>Date</th><th>Source</th><th>Counterparty</th><th>Notes</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
        `;
        for (const t of group.txns) {
          html += `
            <tr>
              <td>${t.date}</td>
              <td>${badge(t.source)}</td>
              <td>${esc(t.userClient || t.counterparty || '')}</td>
              <td>${esc(t.notes || t.rawNotes || '')}</td>
              <td class="num amount-neg">${fmt(Math.abs(t.gross))}</td>
            </tr>
          `;
        }
        html += `</tbody></table>`;
      }
      html += `</div>`;
    }

    el.innerHTML = html;
  },
};

function fmt(n) { return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function badge(source) {
  const cls = source === 'Cash App' ? 'source-cashapp' : 'source-paypal';
  return `<span class="source-badge ${cls}">${esc(source)}</span>`;
}
