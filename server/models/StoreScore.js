import mongoose from "mongoose";

const factorSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    detail: { type: String, required: true },
    points: { type: Number, required: true },
    maxPoints: { type: Number, required: true },
  },
  { _id: false }
);

const storeScoreSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, unique: true },
    score: { type: Number, required: true },
    recommendation: { type: String, required: true },
    suggestedLoanRange: { type: [Number], required: true },
    factors: { type: [factorSchema], default: [] },
    avgDailySales: { type: Number, required: true },
    avgMonthlyRevenue: { type: Number, required: true },
    dataFingerprint: { type: String },
    computedAt: { type: Date, required: true },
  },
  {
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  }
);

export default mongoose.model("StoreScore", storeScoreSchema);
