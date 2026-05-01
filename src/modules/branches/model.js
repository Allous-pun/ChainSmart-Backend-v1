const mongoose = require('mongoose');

const BranchSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  branchId: { type: String, required: true, unique: true },
  branchName: { type: String, required: true },
  branchCode: { type: String, required: true }, // Short code e.g., NBI-HQ, NBI-WH
  
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
  
  // Branch metadata
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  
  // Contact
  phone: { type: String },
  email: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String }, // userId
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
BranchSchema.index({ orgCode: 1, branchId: 1 });
BranchSchema.index({ orgCode: 1, isDefault: 1 });
BranchSchema.index({ orgCode: 1, isActive: 1 });
BranchSchema.index({ coordinates: '2dsphere' }); // For geospatial queries

module.exports = mongoose.model('Branch', BranchSchema);
