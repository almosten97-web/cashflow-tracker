/**
 * PDF Statement Parser — Cash App & PayPal monthly statements
 *
 * Uses PDF.js to extract text with positions, reconstructs table rows
 * from y-coordinate clustering, then applies source-specific parsers.
 *
 * NOTE: PDF parsing is best-effort. Always review imported rows and
 * delete any that were incorrectly parsed.
 */

window.PDFParser = {

  /** Set PDF.js worker URL once on load */
  init() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  },

  /** @param {File} file */
  async parse(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js not loaded. Check your internet connection and reload the page.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extract all text items with positions across all pages
    const allItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      const vp      = page.getViewport({ scale: 1 });

      for (const item of content.items) {
        const text = item.str.trim();
        if (!text) continue;
        allItems.push({
          text,
          x:    Math.round(item.transform[4]),
          y:    Math.round(vp.height - item.transform[5]),
          page: p,
        });
      }
    }

    // Cluster into visual rows by y-coordinate
    const rows = clusterRows(allItems);
    const fullText = rows.map(r => r.text).join('\n');

    // Detect source
    const source = detectSource(fullText);

    let txns;
    if (source === 'Cash App') {
      txns = parseCashAppRows(rows);
    } else if (source === 'PayPal') {
      txns = parsePayPalRows(rows);
    } else {
      txns = parseGeneric(rows);
    }

    if (!txns.length) {
      throw new Error(
        `No transactions found in this PDF.\n\n` +
        `Detected source: ${source || 'Unknown'}.\n\n` +
        `Tip: For best results use the CSV export — PDF parsing only works with ` +
        `official Cash App and PayPal monthly statement PDFs.`
      );
    }

    return { parsed: txns, source };
  },
};

// ─── Row clustering ───────────────────────────────────────────────────────────

function clusterRows(items, yTolerance = 4) {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));

  const rows  = [];
  let curY    = null;
  let curPage = null;
  let curRow  = [];

  const flush = () => {
    if (!curRow.length) return;
    const byX = curRow.sort((a, b) => a.x - b.x);
    rows.push({ y: curY, page: curPage, text: byX.map(i => i.text).join(' '), items: byX });
    curRow = [];
  };

  for (const item of sorted) {
    if (curY === null || item.page !== curPage || Math.abs(item.y - curY) > yTolerance) {
      flush();
      curY    = item.y;
      curPage = item.page;
    }
    curRow.push(item);
  }
  flush();

  return rows;
}

// ─── Source detection ─────────────────────────────────────────────────────────

function detectSource(text) {
  const lower = text.toLowerCase();
  if (lower.includes('cash app'))           return 'Cash App';
  if (lower.includes('cashapp'))            return 'Cash App';
  if (lower.includes('paypal'))             return 'PayPal';
  if (lower.includes('pay pal'))            return 'PayPal';
  return null;
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

// Match dates: 01/15/2024  or  Jan 15, 2024  or  Jan 15 2024  or  2024-01-15
const DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4})\b/i;

// Match dollar amounts: $42.00  or  -$42.00  or  +$1,234.56
const AMOUNT_RE = /([-+]?\$[\d,]+\.\d{2})/g;

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const named  = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (named) {
    const m = String(months[named[1].toLowerCase()]).padStart(2,'0');
    const d = named[2].padStart(2,'0');
    return `${named[3]}-${m}-${d}`;
  }
  return null;
}

function parseMoney(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Cash App PDF parser ──────────────────────────────────────────────────────
//
// Cash App monthly statements typically look like:
//   Date           Transaction           Amount
//   01/15/2024     Payment to Jane       +$42.00
//   01/16/2024     Cash Out              -$100.00

function parseCashAppRows(rows) {
  const txns = [];

  for (const row of rows) {
    const dateMatch = row.text.match(DATE_RE);
    if (!dateMatch) continue;
    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    // Find all amounts in the row
    const amounts = [...row.text.matchAll(AMOUNT_RE)].map(m => parseMoney(m[1]));
    if (!amounts.length) continue;

    // Use the last amount as the transaction amount (balance column may appear too)
    // If multiple amounts: first is the tx amount, last is running balance — use first
    const gross = amounts[0];

    // Description: text between the date and the amount
    const descRaw = row.text
      .replace(dateMatch[0], '')
      .replace(/[-+]?\$[\d,]+\.\d{2}/g, '')
      .trim();

    const isBitcoin  = /bitcoin|btc/i.test(descRaw);
    const autoCategory = isBitcoin ? 'Bitcoin' : classifyCashAppDesc(descRaw, gross);

    const id = `cashapp-pdf-${date}-${gross}-${descRaw.slice(0,20)}`.replace(/\s+/g,'_');

    txns.push({
      id,
      source:       'Cash App',
      date,
      type:         descRaw || 'Payment',
      autoCategory,
      userCategory: null,
      gross,
      fee:          0,
      net:          gross,
      counterparty: '',
      userClient:   null,
      notes:        '',
      rawNotes:     descRaw,
      isBitcoin,
      excluded:     false,
      fromPDF:      true,
    });
  }

  return txns;
}

function classifyCashAppDesc(desc, gross) {
  const d = desc.toLowerCase();
  if (d.includes('cash out') || d.includes('transfer out')) return 'Transfer Out';
  if (d.includes('cash in')  || d.includes('transfer in'))  return 'Transfer In';
  if (d.includes('bitcoin') || d.includes('btc'))           return 'Bitcoin';
  if (d.includes('refund') || d.includes('reversal'))       return 'Refund';
  return gross >= 0 ? 'Contract Income' : 'Materials & Supplies';
}

// ─── PayPal PDF parser ────────────────────────────────────────────────────────
//
// PayPal monthly statements look like:
//   Date         Name           Type                  Gross     Fee      Net
//   Dec 1, 2023  John Smith     Express Checkout      $42.00   -$1.22   $40.78
//
// PayPal PDFs are multi-column; PDF.js gives us positional x values.
// We use column x-positions from the header row to split values.

function parsePayPalRows(rows) {
  const txns = [];

  // Find the header row to identify column x-positions
  let headerRow = null;
  for (const row of rows) {
    const t = row.text.toLowerCase();
    if ((t.includes('gross') || t.includes('amount')) &&
        (t.includes('date') || t.includes('name') || t.includes('type'))) {
      headerRow = row;
      break;
    }
  }

  // Build column position map from header if found
  const colPositions = headerRow ? buildColMap(headerRow) : null;

  for (const row of rows) {
    const dateMatch = row.text.match(DATE_RE);
    if (!dateMatch) continue;
    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    // Extract all dollar amounts in the row
    const amounts = [...row.text.matchAll(AMOUNT_RE)].map(m => parseMoney(m[1]));
    if (!amounts.length) continue;

    let gross = amounts[0];
    let fee   = 0;
    let net   = amounts[0];

    // If 3+ amounts: typically Gross, Fee, Net
    if (amounts.length >= 3) {
      gross = amounts[amounts.length - 3];
      fee   = amounts[amounts.length - 2];
      net   = amounts[amounts.length - 1];
    } else if (amounts.length === 2) {
      gross = amounts[0];
      net   = amounts[1];
    }

    // Description: remove date, amounts, get the middle text
    const descRaw = row.text
      .replace(dateMatch[0], '')
      .replace(/[-+]?\$[\d,]+\.\d{2}/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Try to extract name (first token cluster before known type keywords)
    const typeKeywords = /payment|withdrawal|deposit|subscription|refund|reversal|checkout|transfer/i;
    let name = '';
    let type = descRaw;
    const typeIdx = descRaw.search(typeKeywords);
    if (typeIdx > 0) {
      name = descRaw.slice(0, typeIdx).trim();
      type = descRaw.slice(typeIdx).trim();
    }

    const autoCategory = classifyPayPalDesc(type, gross);

    const id = `paypal-pdf-${date}-${gross}-${descRaw.slice(0,20)}`.replace(/\s+/g,'_');

    txns.push({
      id,
      source:       'PayPal',
      date,
      type,
      autoCategory,
      userCategory: null,
      gross,
      fee,
      net,
      counterparty: name,
      userClient:   null,
      notes:        '',
      rawNotes:     descRaw,
      isBitcoin:    false,
      excluded:     false,
      fromPDF:      true,
    });
  }

  return txns;
}

function classifyPayPalDesc(desc, gross) {
  const d = desc.toLowerCase();
  if (d.includes('refund') || d.includes('reversal'))       return 'Refund';
  if (d.includes('withdrawal') || d.includes('transfer'))   return gross < 0 ? 'Transfer Out' : 'Transfer In';
  if (d.includes('deposit') || d.includes('add funds'))     return 'Transfer In';
  if (d.includes('subscription'))                           return gross >= 0 ? 'Recurring Income' : 'Other Expense';
  if (d.includes('payment') || d.includes('checkout'))      return gross >= 0 ? 'Contract Income' : 'Materials & Supplies';
  return gross >= 0 ? 'Contract Income' : 'Other Expense';
}

// ─── Generic fallback parser ──────────────────────────────────────────────────

function parseGeneric(rows) {
  const txns = [];
  for (const row of rows) {
    const dateMatch = row.text.match(DATE_RE);
    if (!dateMatch) continue;
    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    const amounts = [...row.text.matchAll(AMOUNT_RE)].map(m => parseMoney(m[1]));
    if (!amounts.length) continue;

    const gross   = amounts[0];
    const descRaw = row.text.replace(dateMatch[0], '').replace(/[-+]?\$[\d,]+\.\d{2}/g,'').trim();
    const id      = `pdf-${date}-${gross}-${descRaw.slice(0,20)}`.replace(/\s+/g,'_');

    txns.push({
      id, source: 'PDF', date,
      type: descRaw || 'Transaction',
      autoCategory: gross >= 0 ? 'Contract Income' : 'Other Expense',
      userCategory: null, gross, fee: 0, net: gross,
      counterparty: '', userClient: null,
      notes: '', rawNotes: descRaw,
      isBitcoin: false, excluded: false, fromPDF: true,
    });
  }
  return txns;
}

// ─── Column map (PayPal header detection) ─────────────────────────────────────

function buildColMap(headerRow) {
  const map = {};
  for (const item of headerRow.items) {
    const t = item.text.toLowerCase();
    if (t === 'date')                map.date  = item.x;
    else if (t === 'name')           map.name  = item.x;
    else if (t === 'type')           map.type  = item.x;
    else if (t === 'gross')          map.gross = item.x;
    else if (t === 'fee')            map.fee   = item.x;
    else if (t === 'net')            map.net   = item.x;
  }
  return map;
}
