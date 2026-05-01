const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  branchId: { type: String, required: true },
  pin: { type: String, required: true }, // bcrypt hashed
  name: { type: String, required: true },
  email: { type: String }, // Optional for employees
  role: { 
    type: String, 
    enum: ['owner', 'manager', 'procurement', 'analyst', 'staff'],
    required: true
  },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  lastLoginIP: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String } // userId of who created this user
}, { timestamps: true });

UserSchema.index({ orgCode: 1, pin: 1 });
UserSchema.index({ orgCode: 1, branchId: 1 });
UserSchema.index({ orgCode: 1, role: 1 });

module.exports = mongoose.model('User', UserSchema);