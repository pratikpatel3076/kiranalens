import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    upiAmount: { type: Number, required: true },
    cashAmount: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    upiTxnCount: { type: Number, required: true },
    cashTxnCount: { type: Number, required: true },
  },
  { _id: false }
);

const restockSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    restockValue: { type: Number, required: true },
  },
  { _id: false }
);

const storeSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, unique: true },
    storeName: { type: String, required: true },
    generatedAt: { type: Date },
    transactions: { type: [transactionSchema], default: [] },
    restocks: { type: [restockSchema], default: [] },
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

export default mongoose.model("Store", storeSchema);
