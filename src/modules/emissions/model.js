const mongoose = require('mongoose');

// Emission record for shipments, transfers, purchase orders
const EmissionRecordSchema = new mongoose.Schema({
  recordId: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  
  // Reference to source
  referenceId: { type: String, required: true },
  referenceType: { 
    type: String, 
    enum: ['shipment', 'transfer', 'purchase_order', 'supplier_delivery'],
    required: true 
  },
  
  // Product information
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String },
  quantity: { type: Number, default: 1 },
  weightKg: { type: Number, default: 0 },
  volumeM3: { type: Number, default: 0 },
  
  // Route information
  fromLocationId: { type: String },
  toLocationId: { type: String },
  distanceKm: { type: Number, required: true },
  
  // Transport details
  transportMode: { 
    type: String, 
    enum: ['road', 'rail', 'air', 'sea'],
    default: 'road'
  },
  fuelType: { 
    type: String, 
    enum: ['petrol', 'diesel', 'electric', 'cng', 'unknown'],
    default: 'diesel'
  },
  vehicleType: { type: String }, // truck, van, motorcycle, etc.
  
  // Emission calculation
  co2Emitted: { type: Number, required: true }, // in kg
  co2PerKm: { type: Number },
  co2PerUnit: { type: Number },
  co2PerKg: { type: Number },
  
  // Calculation method
  calculationMethod: { 
    type: String, 
    enum: ['osrm_exact', 'estimated', 'supplier_provided', 'default_factor'],
    default: 'osrm_exact'
  },
  
  // For comparison/verification
  baselineCo2: { type: Number }, // if alternative route exists
  savingsCo2: { type: Number },
  savingsPercent: { type: Number },
  
  // Metadata
  calculatedAt: { type: Date, default: Date.now },
  calculatedBy: { type: String }, // userId or 'system'
  
  // Carbon offset
  offsetStatus: { 
    type: String, 
    enum: ['not_offset', 'pending', 'offset'],
    default: 'not_offset'
  },
  offsetCost: { type: Number },
  offsetCurrency: { type: String, default: 'KES' }
}, { timestamps: true });

EmissionRecordSchema.index({ orgCode: 1, referenceId: 1, referenceType: 1 });
EmissionRecordSchema.index({ orgCode: 1, calculatedAt: -1 });
EmissionRecordSchema.index({ orgCode: 1, productId: 1 });

// Supplier carbon score
const SupplierCarbonSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, unique: true },
  
  // Carbon score (0-100, lower is better)
  carbonScore: { type: Number, default: 100, min: 0, max: 100 },
  rating: { type: String, enum: ['A', 'B', 'C', 'D', 'F', 'unknown'], default: 'unknown' },
  
  // Emission factors
  emissionFactors: {
    perKg: { type: Number },     // kg CO2 per kg of product
    perKm: { type: Number },     // kg CO2 per km
    perUnit: { type: Number }    // kg CO2 per unit
  },
  
  // Certification
  isCertified: { type: Boolean, default: false },
  certifyingBody: { type: String },
  certificateValidUntil: { type: Date },
  
  // Assessment
  lastAssessmentAt: { type: Date },
  assessmentMethod: { type: String, enum: ['self_declared', 'audited', 'estimated'] },
  
  // Renewable energy usage
  renewableEnergyPercent: { type: Number, default: 0, min: 0, max: 100 },
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

SupplierCarbonSchema.index({ orgCode: 1, carbonScore: 1 });

// Monthly emissions summary
const MonthlyEmissionSummarySchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  
  totalCO2: { type: Number, default: 0 },
  
  byType: {
    shipment: { type: Number, default: 0 },
    transfer: { type: Number, default: 0 },
    purchase_order: { type: Number, default: 0 },
    supplier_delivery: { type: Number, default: 0 }
  },
  
  byTransportMode: {
    road: { type: Number, default: 0 },
    rail: { type: Number, default: 0 },
    air: { type: Number, default: 0 },
    sea: { type: Number, default: 0 }
  },
  
  topProducts: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String },
    co2Emitted: { type: Number }
  }],
  
  topLocations: [{
    locationId: { type: String },
    locationName: { type: String },
    co2Emitted: { type: Number }
  }],
  
  estimatedOffsetCost: { type: Number },
  currency: { type: String, default: 'KES' },
  
  calculatedAt: { type: Date, default: Date.now }
});

MonthlyEmissionSummarySchema.index({ orgCode: 1, year: 1, month: 1 }, { unique: true });

module.exports = {
  EmissionRecord: mongoose.model('EmissionRecord', EmissionRecordSchema),
  SupplierCarbon: mongoose.model('SupplierCarbon', SupplierCarbonSchema),
  MonthlyEmissionSummary: mongoose.model('MonthlyEmissionSummary', MonthlyEmissionSummarySchema)
};