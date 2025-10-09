const mongoose = require("mongoose");

const GlobalConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("GlobalConfig", GlobalConfigSchema);
