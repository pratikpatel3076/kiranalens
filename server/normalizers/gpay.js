// Google Pay "Get Statement" PDF export normalizer.
//
// The statement is a table with three effective columns:
//   Date & Time          full date with year, time in AM/PM
//   Transaction Details  free text: "Paid to <name>" / "Received from <name>",
//                        a UPI transaction ID, and a bank line with last-4
//                        account digits
//   Amount               ₹ amount (rendered green/black by direction — color
//                        does not survive text extraction, so direction is
//                        parsed from the Details text instead)
//
// Extraction uses pdfjs-dist (legacy build) because its per-item text
// coordinates let us rebuild table rows geometrically: items are clustered
// into visual lines by baseline y, and a new logical row starts at each
// date/time line. Detail cells wrap across multiple physical lines and can
// continue onto the next page, so row state persists across pages.
//
// Privacy: only per-row amounts + dates are kept. Bank names, account
// digits, UPI transaction IDs and free-text details are never stored or
// logged. Only "Received from" rows count as store revenue; "Paid to" rows
// are tallied but excluded.

import { UploadError } from "./errors.js";

const MAX_PDF_PAGES = 200;

// "24 Aug 2026, 9:14 pm" / "24 August 26, 9:14 PM" / numeric "24/08/2026, 21:14"
const DATE_LINE_RE =
  /^(?<d>\d{1,2})\s+(?<mon>[A-Za-z]{3,12})\s+(?<y>\d{4})\s*,?\s+(?<t>\d{1,2}:\d{2}(?::\d{2})?)\s*(?<ampm>am|pm)?|^((?<d2>\d{1,2})[/.-](?<mon2>\d{1,2})[/.-](?<y2>\d{2,4}))\s*,?\s+((?<t2>\d{1,2}:\d{2}(?::\d{2})?)\s*(?<ampm2>am|pm)?)/i;

const AMOUNT_RE = /(?:₹|Rs\.?|INR)\s?([0-9][\d,]*(?:\.[0-9]{1,2})?)/i;
const RECEIVED_RE = /\breceived\s+from\b/i;
const PAID_RE = /\bpaid\s+to\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthToNumber(name) {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i === -1 ? null : i + 1;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toIsoDate({ d, monName, monNum, y }) {
  const month = monName ? monthToNumber(monName) : Number(monNum);
  if (!month || !d || !y) return null;
  const year = Number(y);
  const fullYear = year < 100 ? 2000 + year : year;
  return `${fullYear}-${pad2(month)}-${pad2(Number(d))}`;
}

// Cluster a page's text items into visual lines: group by baseline y
// (tolerance derived from font size), order left-to-right within a line.
function extractLines(textContent) {
  const items = [];
  for (const it of textContent.items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    items.push({ x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || 10, str: it.str.trim() });
  }
  if (!items.length) return [];

  const typicalH = items.map((i) => i.h).sort((a, b) => a - b)[Math.floor(items.length / 2)];
  const tol = Math.max(3, typicalH * 0.35);

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const item of items) {
    if (cur && cur.y - item.y <= tol) cur.parts.push(item);
    else {
      cur = { y: item.y, parts: [item] };
      lines.push(cur);
    }
  }
  return lines.map((l) =>
    l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export const gpay = {
  name: "gpay",
  description: 'Google Pay "Get Statement" PDF export',
  matchesFilename(filename, mimetype) {
    return /\.pdf$/i.test(filename) || String(mimetype || "").includes("pdf");
  },

  // Returns { transactions, stats } where transactions are canonical daily
  // rows ready for Store.create().
  async normalizeFromPdf(buffer) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    let doc;
    let loadingTask;
    try {
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useWorkerFetch: false,
        disableFontFace: true,
        verbosity: 0,
      });
      doc = await loadingTask.promise;
    } catch (err) {
      throw new UploadError(400, `Could not read PDF statement: ${err.message}`);
    }

    const stats = { receivedTxns: 0, ignoredPaidToTxns: 0, unparsedLines: 0 };
    const receiptsByDate = new Map();

    const closeRow = (row) => {
      if (!row) return;
      if (RECEIVED_RE.test(row.text)) {
        const amtMatch = AMOUNT_RE.exec(row.text);
        if (!amtMatch) {
          stats.unparsedLines++;
          return;
        }
        const amount = parseFloat(amtMatch[1].replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount < 0) {
          stats.unparsedLines++;
          return;
        }
        const day = receiptsByDate.get(row.dateIso) || { upiAmount: 0, upiTxnCount: 0 };
        day.upiAmount += amount;
        day.upiTxnCount += 1;
        receiptsByDate.set(row.dateIso, day);
        stats.receivedTxns++;
      } else if (PAID_RE.test(row.text)) {
        // Money out (supplier payments etc.) is not store revenue.
        stats.ignoredPaidToTxns++;
      } else {
        stats.unparsedLines++; // headers, footers, unrecognized shapes
      }
    };

    try {
      const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);
      let open = null;
      for (let p = 1; p <= pageCount; p++) {
        const page = await doc.getPage(p);
        const textContent = await page.getTextContent();
        // Row state intentionally persists across pages: a transaction's
        // detail/amount lines may continue past the page break.
        for (const line of extractLines(textContent)) {
          const m = DATE_LINE_RE.exec(line);
          if (m && m.groups) {
            const dateIso = toIsoDate({
              d: m.groups.d ?? m.groups.d2,
              monName: m.groups.mon,
              monNum: m.groups.mon2,
              y: m.groups.y ?? m.groups.y2,
            });
            if (!dateIso) {
              stats.unparsedLines++; // dated line whose date we couldn't normalize
              continue;
            }
            closeRow(open);
            open = { dateIso, text: line.slice(m[0].length) };
          } else if (open) {
            open.text += " " + line;
          } else {
            stats.unparsedLines++; // preamble before first dated row
          }
        }
      }
      closeRow(open);
    } finally {
      await loadingTask.destroy().catch(() => {});
    }

    if (receiptsByDate.size === 0) {
      throw new UploadError(
        400,
        "No Google Pay transactions recognized in this PDF — expected the GPay 'Get Statement' export format."
      );
    }

    const transactions = [...receiptsByDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, agg]) => ({
        date,
        upiAmount: Math.round(agg.upiAmount),
        cashAmount: 0, // GPay statements carry UPI transactions only
        totalAmount: Math.round(agg.upiAmount),
        upiTxnCount: agg.upiTxnCount,
        cashTxnCount: 0,
      }));

    return { transactions, stats };
  },
};
