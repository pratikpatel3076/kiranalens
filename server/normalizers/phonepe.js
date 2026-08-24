// PhonePe transaction-history CSV normalizer.
//
// TODO: fill in matches()/normalize() against a REAL PhonePe export.
// Needed from a sample statement (amounts redacted is fine):
//   1. The exact header row (column names + order).
//   2. 2-3 sample data rows, so date format / amount formatting
//      ("₹1,234.56"? plain digits?) and debit/credit encoding are known.
// Do NOT guess column names — wire this only after the sample lands.

export const phonePe = {
  name: "phonepe",
  description: "PhonePe transaction-history CSV export",
  matches(_headers) {
    // TODO: return true when headers match the real PhonePe export signature.
    return false;
  },
  normalize(_rows) {
    throw new Error(
      "PhonePe normalizer not implemented yet — paste a sample transaction-history export to define the real columns."
    );
  },
};
