const mongoose = require('mongoose');

const CostScenarioSchema = new mongoose.Schema({
  scenarioId: { type: String, required: true, unique: true }, // unique: true already creates an index
  orgCode: { type: String, required: true, index: true },
  
  // Scenario metadata
  name: { type: String, required: true },
  description: { type: String },
  
  // Input parameters
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  quantity: { type: Number, required: true, min: 1 },
  destinationLocationId: { type: String, required: true }, // warehouse/branch ID
  urgency: { type: String, enum: ['routine', 'expedited', 'emergency'], default: 'routine' },
  currency: { type: String, default: 'KES' },
  
  // Comparison parameters
  compareQuantities: [{ type: Number }], // Alternative quantities to compare
  compareSuppliers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' }],
  
  // Results (cached)
  results: {
    currentCost: {
      total: { type: Number },
      perUnit: { type: Number },
      breakdown: {
        productCost: { type: Number },
        transportCost: { type: Number },
        handlingCost: { type: Number },
        dutyCost: { type: Number }
      }
    },
    comparisons: [{
      type: { type: String, enum: ['quantity', 'supplier', 'cadence'] },
      label: { type: String },
      quantity: { type: Number },
      supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
      totalCost: { type: Number },
      perUnitCost: { type: Number },
      savings: { type: Number },
      savingsPercent: { type: Number },
      breakdown: {
        productCost: { type: Number },
        transportCost: { type: Number },
        handlingCost: { type: Number },
        dutyCost: { type: Number }
      }
    }],
    recommendation: { type: String },
    bestOption: { type: String },
    executedAt: { type: Date, default: Date.now }
  },
  
  // Metadata
  isActive: { type: Boolean, default: true },
  createdBy: { type: String, required: true },
  updatedBy: { type: String }
}, { timestamps: true });

// Only define indexes that are NOT already defined in the schema
// Remove the duplicate scenarioId index since unique: true already creates it
CostScenarioSchema.index({ orgCode: 1, createdAt: -1 });
CostScenarioSchema.index({ orgCode: 1, productId: 1 });
// REMOVED: CostScenarioSchema.index({ scenarioId: 1 }, { unique: true }); - already covered by unique: true in field definition

module.exports = mongoose.model('CostScenario', CostScenarioSchema);