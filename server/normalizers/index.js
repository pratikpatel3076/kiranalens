// Shared helpers + format registry for transaction-history uploads.

export const MAX_UPLOAD_ROWS = 100000;

export class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const REQUIRED_FIELDS = ["date", "upiAmount", "cashAmount"];

function toNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UploadError(400, `Invalid number for "${field}": ${JSON.stringify(value)}`);
  return n;
}

// Validates one already-normalized daily row and fills defaults.
export function validateDailyRow(row) {
  for (const field of REQUIRED_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === "") {
      throw new UploadError(400, `Missing required field "${field}"`);
    }
  }
  const upiAmount = Math.max(0, toNumber(row.upiAmount, "upiAmount"));
  const cashAmount = Math.max(0, toNumber(row.cashAmount, "cashAmount"));
  return {
    date: String(row.date),
    upiAmount,
    cashAmount,
    totalAmount: upiAmount + cashAmount,
    upiTxnCount: Math.max(0, Math.round(toNumber(row.upiTxnCount ?? 0, "upiTxnCount"))),
    cashTxnCount: Math.max(0, Math.round(toNumber(row.cashTxnCount ?? 0, "cashTxnCount"))),
  };
}

// Merge normalized rows into one record per calendar day (an export may
// contain multiple entries for the same day). Output is sorted by date so
// trend/bad-patch features behave like generated data.
export function aggregateDaily(rows) {
  const byDate = new Map();
  for (const raw of rows.slice(0, MAX_UPLOAD_ROWS)) {
    const row = validateDailyRow(raw);
    const existing = byDate.get(row.date);
    if (existing) {
      existing.upiAmount += row.upiAmount;
      existing.cashAmount += row.cashAmount;
      existing.totalAmount += row.totalAmount;
      existing.upiTxnCount += row.upiTxnCount;
      existing.cashTxnCount += row.cashTxnCount;
    } else {
      byDate.set(row.date, row);
    }
  }
  if (byDate.size === 0) throw new UploadError(400, "Upload contained no usable transactions");
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Canonical KiranaLens daily-aggregate CSV — our own documented column set,
// also the output shape every vendor normalizer must produce.
const dailyCsv = {
  name: "kiranalens-daily",
  description: "KiranaLens canonical daily aggregates (date, upiAmount, cashAmount, upiTxnCount, cashTxnCount)",
  matches(headers) {
    const lower = headers.map((h) => h.trim().toLowerCase());
    return ["date", "upiamount", "cashamount"].every((c) => lower.includes(c));
  },
  normalize(rows) {
    return rows.map((r) => ({
      date: r.date,
      upiAmount: r.upiAmount,
      cashAmount: r.cashAmount,
      upiTxnCount: r.upiTxnCount ?? 0,
      cashTxnCount: r.cashTxnCount ?? 0,
    }));
  },
};

// Vendor normalizers are registered here as they gain real column mappings.
export const NORMALIZERS = [dailyCsv];

// Route parsed CSV rows to the right normalizer based on header names.
export function normalizeRows(headers, rows) {
  const match = NORMALIZERS.find((n) => n.matches(headers));
  if (!match) {
    throw new UploadError(
      415,
      `Unsupported CSV format (headers: ${headers.join(", ")}). Supported: ` +
        NORMALIZERS.map((n) => n.name).join(", ") +
        ". PhonePe/GPay statement import is not wired yet — paste a sample export to add it."
    );
  }
  return aggregateDaily(match.normalize(rows));
}
