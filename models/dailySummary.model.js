const mongoose = require("mongoose");

const GroupSummarySchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true },
    groupName: String,
    incomingCount: { type: Number, default: 0 },
    incomingAmount: { type: Number, default: 0 },
    incomingUsdt: { type: Number, default: 0 },
    actualIncomingUsdt: { type: Number, default: 0 },
    sellUsdt: { type: Number, default: 0 },
    sellProfit: { type: Number, default: 0 },
    outgoingCount: { type: Number, default: 0 },
    outgoingUsdt: { type: Number, default: 0 },
    payoutCount: { type: Number, default: 0 },
    payoutAmount: { type: Number, default: 0 },
    payoutFees: { type: Number, default: 0 },
    payoutUsdt: { type: Number, default: 0 },
    payoutCommission: { type: Number, default: 0 },
    shouldIssued: { type: Number, default: 0 },
    pendingUsdt: { type: Number, default: 0 },
    wallet: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
  },
  { _id: false }
);

const DailySummarySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  groups: [GroupSummarySchema],
  totals: {
    incomingCount: { type: Number, default: 0 },
    incomingAmount: { type: Number, default: 0 },
    incomingUsdt: { type: Number, default: 0 },
    actualIncomingUsdt: { type: Number, default: 0 },
    sellUsdt: { type: Number, default: 0 },
    sellProfit: { type: Number, default: 0 },
    outgoingCount: { type: Number, default: 0 },
    outgoingUsdt: { type: Number, default: 0 },
    payoutCount: { type: Number, default: 0 },
    payoutAmount: { type: Number, default: 0 },
    payoutFees: { type: Number, default: 0 },
    payoutUsdt: { type: Number, default: 0 },
    payoutCommission: { type: Number, default: 0 },
    shouldIssued: { type: Number, default: 0 },
    pendingUsdt: { type: Number, default: 0 },
    wallet: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
  },
  lastUpdated: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },
});

DailySummarySchema.index({ date: -1 });
DailySummarySchema.index({ "groups.chatId": 1 });

module.exports = mongoose.model("DailySummary", DailySummarySchema);
