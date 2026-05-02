const mongoose = require('mongoose');

const WarehouseSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  locationId: { type: String }, // branchId reference
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

WarehouseSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Warehouse', WarehouseSchema);