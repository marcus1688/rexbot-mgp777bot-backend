const mongoose = require("mongoose");

const DailyReportSchema = new mongoose.Schema({
  chatId: String,
  date: String,
  totalInAmount: Number,
  totalInUsdt: Number,
  totalOutUsdt: Number,
  transactionCount: {
    入款: Number,
    下发: Number,
  },
  report: String,
  createdAt: { type: Date, default: Date.now },
});

DailyReportSchema.index({ chatId: 1, date: -1 });
DailyReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model("DailyReport", DailyReportSchema);
