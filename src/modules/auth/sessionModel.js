const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  orgCode: { type: String, required: true, index: true },
  branchId: { type: String, required: true },
  token: { type: String, required: true, unique: true },
  deviceId: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  lastActiveAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);