const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  branchId: { type: String, required: true },
  pin: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String },
  avatar: {
    url: { type: String },
    publicId: { type: String },
    optimizedUrl: { type: String }
  },
  role: { 
    type: String, 
    enum: ['owner', 'manager', 'procurement', 'analyst', 'staff'],
    required: true
  },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  lastLoginIP: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String }
}, { timestamps: true });

UserSchema.index({ orgCode: 1, pin: 1 });
UserSchema.index({ orgCode: 1, branchId: 1 });
UserSchema.index({ orgCode: 1, role: 1 });

module.exports = mongoose.model('User', UserSchema);