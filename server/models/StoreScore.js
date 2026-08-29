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

const historyEntrySchema = new mongoose.Schema(
  {
    score: { type: Number, required: true },
    recommendation: { type: String, required: true },
    computedAt: { type: Date, required: true },
    alertGenerated: { type: String, default: null },
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
    model: {
      type: new mongoose.Schema(
        {
          score: { type: Number, required: true },
          recommendation: { type: String, required: true },
          suggestedLoanRange: { type: [Number], required: true },
          factors: { type: [factorSchema], default: [] },
          computedAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    avgDailySales: { type: Number, required: true },
    avgMonthlyRevenue: { type: Number, required: true },
    dataFingerprint: { type: String },
    computedAt: { type: Date, required: true },
    history: { type: [historyEntrySchema], default: [] },
    latestAlert: { type: String, default: null },
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