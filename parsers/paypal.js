/**
 * PayPal CSV parser
 * Key columns: Date, Name, Type, Status, Currency, Gross, Fee, Net,
 *              From Email Address, To Email Address, Invoice Number, Subject, Note
 */

window.PayPalParser = {

  /**
   * Detect if a parsed CSV looks like a PayPal export.
   * @param {string[]} headers
   * @returns {boolean}
   */
  detect(headers) {
    const h = headers.map(s => s.trim().toLowerCase());
    return h.includes('from email address') || h.includes('to email address') ||
           (h.includes('type') && h.includes('status') && h.includes('gross') && h.includes('fee'));
  },

  /**
   * Parse PapaParse rows into normalized transactions.
   * @param {object[]} rows
   * @returns {object[]}
   */
  parse(rows) {
    const txns = [];

    for (const row of rows) {
      const status = (row['Status'] || '').trim();
      // Skip pending, reversed, denied, cancelled
      if (!['Completed', 'Partially Refunded', 'Refunded'].includes(status)) continue;

      const type   = (row['Type'] || row['Transaction Type'] || '').trim();
      const name   = (row['Name'] || '').trim();
      const date   = parsePayPalDate(row['Date'] || '');
      const gross  = parseMoney(row['Gross'] || '0');
      const fee    = parseMoney(row['Fee']   || '0');
      const net    = parseMoney(row['Net']   || '0');
      const subj   = (row['Subject'] || row['Item Title'] || '').trim();
      const note   = (row['Note']    || '').trim();
      const inv    = (row['Invoice Number'] || '').trim();

      if (!date) continue;

      const autoCategory = classifyPayPal(type, gross, status);
      const rawNotes = [subj, note, inv ? `Inv# ${inv}` : ''].filter(Boolean).join(' | ');

      const id = `paypal-${date}-${gross}-${type}-${name}`.replace(/\s+/g, '_');

      txns.push({
        id,
        source:        'PayPal',
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
        rawNotes,
        isBitcoin:     false,
        excluded:      false,
      });
    }

    return txns;
  },
};

function classifyPayPal(type, gross, status) {
  const t = type.toLowerCase();

  if (status === 'Refunded' || t.includes('refund') || t.includes('reversal')) {
    return 'Refund';
  }

  // Outgoing transfers / withdrawals
  if (t.includes('withdrawal') || t.includes('bank deposit to paypal') ||
      t.includes('debit card') || t.includes('transfer')) {
    return gross < 0 ? 'Transfer Out' : 'Transfer In';
  }

  if (t.includes('credit card deposit') || t.includes('add funds')) {
    return 'Transfer In';
  }

  // Payments received
  if (t.includes('payment') || t.includes('checkout') || t.includes('invoice') ||
      t.includes('website') || t.includes('pos')) {
    if (gross >= 0) return 'Contract Income';
    // Outgoing payment — likely a business purchase
    return 'Materials & Supplies';
  }

  if (t.includes('subscription')) {
    return gross >= 0 ? 'Contract Income' : 'Other Expense';
  }

  if (t.includes('reward') || t.includes('cashback') || t.includes('referral')) {
    return 'Other Income';
  }

  return gross >= 0 ? 'Contract Income' : 'Other Expense';
}

function parseMoney(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parsePayPalDate(str) {
  if (!str) return null;

  // MM/DD/YYYY HH:MM:SS or MM/DD/YYYY
  const mdy = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

  // ISO: 2024-01-15
  const iso = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}
