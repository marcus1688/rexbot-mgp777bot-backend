const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  chatId: String,
  groupName: String,
  type: { type: String, enum: ["入款", "下发", "代付"] },
  amount: { type: Number, default: 0 },
  usdt: { type: Number, default: 0 },
  rate: Number,
  feeRate: { type: Number, default: 0 },
  fee: { type: Number, default: 0 },
  messageId: Number,
  username: String,
  displayName: String,
  remark: String,
  timestamp: { type: Date, default: Date.now },
  date: String,
  calculatedUsdt: Number,
});

TransactionSchema.index({ chatId: 1, date: -1 });
TransactionSchema.index({ chatId: 1, timestamp: -1 });
TransactionSchema.index({ chatId: 1, type: 1, date: -1 });
TransactionSchema.index({ chatId: 1, messageId: 1 });
TransactionSchema.index({ timestamp: -1 });
TransactionSchema.index({ displayName: 1 });
TransactionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 31536000 });

module.exports = mongoose.model("Transaction", TransactionSchema);
