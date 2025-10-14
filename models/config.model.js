const mongoose = require("mongoose");

const ConfigSchema = new mongoose.Schema({
  chatId: { type: String, unique: true, required: true },
  feeRate: { type: Number, default: 0 },
  inRate: { type: Number, default: 0 },
  outRate: { type: Number, default: 0 },
  buyRate: { type: Number, default: 0 },
  sellRate: { type: Number, default: 0 },
  handlingFee: { type: Number, default: 0 },
  operators: [String],
  isOpen: { type: Boolean, default: false },
  lastReset: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ConfigSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Config", ConfigSchema);
