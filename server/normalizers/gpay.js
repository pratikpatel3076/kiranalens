// Google Pay transaction-history CSV normalizer.
//
// TODO: fill in matches()/normalize() against a REAL GPay export.
// Needed from a sample statement (amounts redacted is fine):
//   1. The exact header row (column names + order).
//   2. 2-3 sample data rows, so date format / amount formatting
//      ("INR 1,234.00"? plain digits?) and status column values are known.
// Do NOT guess column names — wire this only after the sample lands.

export const gpay = {
  name: "gpay",
  description: "Google Pay transaction-history CSV export",
  matches(_headers) {
    // TODO: return true when headers match the real GPay export signature.
    return false;
  },
  normalize(_rows) {
    throw new Error(
      "GPay normalizer not implemented yet — paste a sample transaction-history export to define the real columns."
    );
  },
};
