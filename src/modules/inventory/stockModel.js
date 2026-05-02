const mongoose = require('mongoose');

const StockStateSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true }, // branchId string
  
  // Core stock metrics
  physicalStock: { type: Number, default: 0 },
  reservedStock: { type: Number, default: 0 },
  inTransitStock: { type: Number, default: 0 },
  availableStock: { type: Number, default: 0 },
  
  // Stock configuration
  reorderPoint: { type: Number, default: 0 },
  safetyStock: { type: Number, default: 0 },
  maxStockLevel: { type: Number, default: 0 },
  
  // Unit of Measure
  unit: { type: String, default: 'pcs' },
  conversionRate: { type: Number, default: 1 },
  
  // Batch/Lot tracking
  batchNumber: { type: String },
  expiryDate: { type: Date },
  
  // Timestamps
  lastTransactionAt: { type: Date },
  lastCalculatedAt: { type: Date, default: Date.now },
  
  // Version for optimistic locking
  version: { type: Number, default: 1 }
}, { timestamps: true });

// Indexes
StockStateSchema.index({ orgCode: 1, productId: 1, variantId: 1, locationId: 1 }, { unique: true });
StockStateSchema.index({ orgCode: 1, locationId: 1, availableStock: 1 });
StockStateSchema.index({ orgCode: 1, productId: 1, batchNumber: 1 });

module.exports = mongoose.model('StockState', StockStateSchema);