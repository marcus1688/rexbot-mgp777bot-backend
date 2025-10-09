const mongoose = require("mongoose");

const RiskControlSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  remark: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

RiskControlSchema.index({ timestamp: -1 });

module.exports = mongoose.model("RiskControl", RiskControlSchema);
