/**
 * Cash App CSV parser
 * Columns: Date, Transaction Type, Currency, Amount, Fee, Net Amount,
 *          Asset Type, Asset Price, Shares, Notes, Name, Account, App
 */

window.CashAppParser = {

  /**
   * Detect if a parsed CSV looks like a Cash App export.
   * @param {string[]} headers - Array of column header strings
   * @returns {boolean}
   */
  detect(headers) {
    const h = headers.map(s => s.trim().toLowerCase());
    return h.includes('transaction type') && h.includes('net amount') && h.includes('asset type');
  },

  /**
   * Parse PapaParse result rows into normalized transactions.
   * @param {object[]} rows - PapaParse data rows (objects keyed by header)
   * @returns {object[]} Normalized transaction objects
   */
  parse(rows) {
    const txns = [];

    for (const row of rows) {
      const type   = (row['Transaction Type'] || '').trim();
      const notes  = (row['Notes']  || '').trim();
      const name   = (row['Name']   || '').trim();
      const date   = parseDate(row['Date'] || '');
      const gross  = parseMoney(row['Amount']     || '0');
      const fee    = parseMoney(row['Fee']        || '0');
      const net    = parseMoney(row['Net Amount'] || '0');
      const asset  = (row['Asset Type'] || '').trim();

      if (!date) continue; // skip blank/header rows

      const isBitcoin = asset.toLowerCase() !== 'usd' && asset !== '';
      const autoCategory = isBitcoin
        ? 'Bitcoin'
        : classifyCashApp(type, gross);

      const id = `cashapp-${date}-${gross}-${type}-${name}`.replace(/\s+/g, '_');

      txns.push({
        id,
        source:        'Cash App',
        date,
        type,
        autoCategory,
        userCategory:  null,
        gross,
        fee,
        net,
        counterparty:  name,
        userClient:    null,
        notes:         '',
        rawNotes:      notes,
        isBitcoin,
        excluded:      false,
      });
    }

    return txns;
  },
};

function classifyCashApp(type, gross) {
  const t = type.toLowerCase();

  if (t.includes('bitcoin buy'))   return 'Bitcoin';
  if (t.includes('bitcoin sale'))  return 'Bitcoin';
  if (t.includes('bitcoin boost')) return 'Bitcoin';

  if (t === 'cash out')            return 'Transfer Out';
  if (t === 'cash in')             return 'Transfer In';
  if (t === 'referral bonus')      return 'Other Income';

  if (t === 'payment') {
    return gross >= 0 ? 'Contract Income' : 'Materials & Supplies';
  }

  if (t.includes('payroll'))       return 'Contract Income';
  if (t.includes('refund'))        return 'Refund';

  return gross >= 0 ? 'Contract Income' : 'Other Expense';
}

function parseMoney(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseDate(str) {
  if (!str) return null;
  // Cash App format: "2024-01-15" or "01/15/2024"
  const iso = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

  return null;
}
