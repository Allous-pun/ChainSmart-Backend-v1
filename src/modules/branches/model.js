const mongoose = require('mongoose');

const BranchSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  branchId: { type: String, required: true, unique: true },
  branchName: { type: String, required: true },
  branchCode: { type: String, required: true },
  
  // Location fields
  address: { type: String, required: true },
  city: { type: String, required: true },
  region: { type: String },
  country: { type: String, default: 'Kenya' },
  coordinates: {
    lat: { type: Number },
    lng: { type: Number }
  },
  formattedAddress: { type: String },
  
  // Warehouse flag
  isWarehouse: { type: Boolean, default: false },  // ← ADD THIS
  
  // Branch metadata
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  
  // Contact
  phone: { type: String },
  email: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
BranchSchema.index({ orgCode: 1, branchId: 1 });
BranchSchema.index({ orgCode: 1, isWarehouse: 1 });  // ← ADD THIS
BranchSchema.index({ orgCode: 1, isDefault: 1 });
BranchSchema.index({ orgCode: 1, isActive: 1 });
BranchSchema.index({ coordinates: '2dsphere' });

module.exports = mongoose.model('Branch', BranchSchema);