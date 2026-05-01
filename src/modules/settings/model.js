const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, unique: true, index: true },
  
  // Pillar 1: Demand & Inventory Planning
  inventory: {
    defaultSafetyStockDays: { type: Number, default: 7 },
    reorderPointThreshold: { type: Number, default: 20, min: 0, max: 100 },
    demandForecastHorizon: { type: Number, default: 14, enum: [7, 14, 30] },
    stockoutRiskAlertDays: { type: Number, default: 3 }
  },
  
  // Pillar 2: Procurement Optimization
  procurement: {
    preferredOrderCadence: { type: String, default: 'weekly', enum: ['weekly', 'bi-weekly', 'monthly'] },
    bulkOrderMinimum: { type: Number, default: 50000 },
    autoApprovalThreshold: { type: Number, default: 10000 },
    defaultLeadTimeDays: { type: Number, default: 5 }
  },
  
  // Pillar 3: Supplier Comparison
  supplier: {
    comparisonWeightage: {
      price: { type: Number, default: 50, min: 0, max: 100 },
      deliveryTime: { type: Number, default: 30, min: 0, max: 100 },
      reliability: { type: Number, default: 20, min: 0, max: 100 }
    },
    minRatingToConsider: { type: Number, default: 3, min: 0, max: 5 },
    preferredSuppliers: [{ type: String }]
  },
  
  // Pillar 4: Logistics / Routing
  logistics: {
    vehicleCapacity: { type: Number, default: 1000 },
    fuelCostPerKm: { type: Number, default: 150 },
    maxDeliveryStopsPerRoute: { type: Number, default: 10 },
    depotLocations: [{
      name: String,
      lat: Number,
      lng: Number,
      address: String
    }]
  },
  
  // Pillar 5: Cost Simulation (Killer Feature)
  costSimulation: {
    discountTiers: [{
      minUnits: Number,
      maxUnits: Number,
      discountPercent: Number
    }],
    holdingCostPercent: { type: Number, default: 15, min: 0, max: 100 },
    urgentShippingMarkupPercent: { type: Number, default: 50 }
  },
  
  // Pillar 6: Emissions Estimation
  emissions: {
    co2FactorPerKm: { type: Number, default: 0.12 },
    fuelTypes: [{
      name: { type: String, enum: ['petrol', 'diesel', 'electric', 'cng'] },
      co2Factor: Number
    }],
    reportingUnit: { type: String, default: 'kg', enum: ['kg', 'tons'] }
  },
  
  // Pillar 7: Insights & Reports
  reports: {
    defaultReportPeriod: { type: String, default: '30days', enum: ['30days', 'quarter', 'year'] },
    wasteAlertThreshold: { type: Number, default: 5, min: 0, max: 100 }
  },
  
  // Global Settings (only decision rules, no regional data)
  global: {
    fiscalYearStart: { type: String, default: 'Jan 1' },
    lowStockNotificationEmail: { type: String },
    engineAutoRunSchedule: { type: String, default: 'daily', enum: ['daily', 'weekly', 'manual'] }
  },
  
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);