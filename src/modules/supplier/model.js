const mongoose = require('mongoose');
const { calculateDrivingDistance } = require('../../utils/geocoding');

/* -------------------------
   FLEXIBLE ATTRIBUTES
-------------------------- */
const AttributeSchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  type: { 
    type: String, 
    enum: ['string', 'number', 'date', 'boolean'], 
    default: 'string' 
  }
}, { _id: false });

/* -------------------------
   CURRENCY EXCHANGE RATES (Normalization)
-------------------------- */
const ExchangeRateSchema = new mongoose.Schema({
  baseCurrency: { type: String, default: 'USD' },
  targetCurrency: { type: String, required: true },
  rate: { type: Number, required: true },
  effectiveFrom: { type: Date, default: Date.now },
  effectiveUntil: { type: Date },
  volatilityBuffer: { type: Number, default: 0.01 }
}, { timestamps: true });

ExchangeRateSchema.index({ baseCurrency: 1, targetCurrency: 1, effectiveFrom: -1 });

/* -------------------------
   SUPPLIER LOCATION (Geospatial Intelligence)
-------------------------- */
const SupplierLocationSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['factory', 'warehouse', 'distributor', 'office'],
    default: 'warehouse'
  },
  address: { type: String, required: true },
  
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  
  region: { type: String },
  country: { type: String, required: true },
  city: { type: String },
  
  contactPerson: { type: String },
  contactEmail: { type: String },
  contactPhone: { type: String },
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

SupplierLocationSchema.index({ location: '2dsphere' });
SupplierLocationSchema.index({ orgCode: 1, country: 1 });

/* -------------------------
   STANDALONE VARIANT MODEL (Fixed referencing)
-------------------------- */
const VariantSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  attributes: [AttributeSchema],
  standardCost: { type: Number },
  weight: { type: Number },
  volume: { type: Number },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

VariantSchema.index({ orgCode: 1, sku: 1 });
VariantSchema.index({ productId: 1, isActive: 1 });

/* -------------------------
   PRODUCT-SPECIFIC PERFORMANCE METRICS (Time-series, per product)
-------------------------- */
const ProductPerformanceMetricsSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  supplyOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplyOffer' },
  
  period: { type: String, enum: ['monthly', 'quarterly', 'yearly'], required: true },
  periodDate: { type: Date, required: true },
  
  onTimeDeliveryRate: { type: Number, default: 100, min: 0, max: 100 },
  orderFillRate: { type: Number, default: 100, min: 0, max: 100 },
  avgLeadTimeAchieved: { type: Number },
  
  qualityScore: { type: Number, default: 100, min: 0, max: 100 },
  defectRate: { type: Number, default: 0 },
  returnRate: { type: Number, default: 0 },
  
  cancellationRate: { type: Number, default: 0 },
  lateDeliveryRate: { type: Number, default: 0 },
  
  weightedScore: { type: Number, default: 100 }
}, { timestamps: true });

ProductPerformanceMetricsSchema.index({ supplierId: 1, productId: 1, periodDate: -1 });
ProductPerformanceMetricsSchema.index({ orgCode: 1, productId: 1 });

/* -------------------------
   ENHANCED COMPARISON CONTEXT (Enforced everywhere)
-------------------------- */
const ComparisonContextSchema = new mongoose.Schema({
  asOfDate: { type: Date, required: true, default: Date.now },
  currency: { type: String, required: true, default: 'USD' },
  destinationLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierLocation', required: true },
  quantity: { type: Number, required: true, min: 1 },
  urgency: { type: String, enum: ['routine', 'expedited', 'emergency'], default: 'routine' },
  maxLeadTimeDays: { type: Number },
  riskTolerance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  exchangeVolatilityBuffer: { type: Number, default: 0.01 }
}, { _id: false });

/* -------------------------
   UNIFIED TRANSPORT CALCULATION
-------------------------- */
const TransportOptionSchema = new mongoose.Schema({
  mode: { type: String, enum: ['air', 'sea', 'road', 'rail'], required: true },
  baseCostPerKm: { type: Number, required: true },
  costPerKg: { type: Number, default: 0 },
  costPerM3: { type: Number, default: 0 },
  fixedCostPerShipment: { type: Number, default: 0 },
  leadTimeDays: { type: Number, required: true },
  reliability: { type: Number, default: 0.95, min: 0, max: 1 },
  carbonFootprintPerKgPerKm: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { _id: false });

/* -------------------------
   SUPPLY OFFER (THE HEART)
-------------------------- */
const PriceBreakSchema = new mongoose.Schema({
  minQuantity: { type: Number, required: true },
  maxQuantity: { type: Number },
  unitPrice: { type: Number, required: true },
  currency: { type: String, default: 'USD' }
}, { _id: false });

const SupplyOfferSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierLocation', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
  
  // ===== PRICING (Quantity-aware) =====
  basePrice: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  priceBreaks: [PriceBreakSchema],
  
  // ===== LEAD TIME =====
  minLeadTimeDays: { type: Number, required: true },
  maxLeadTimeDays: { type: Number, required: true },
  avgLeadTimeDays: { type: Number, required: true },
  leadTimeVariability: { type: Number, default: 0 },
  
  // ===== UNIFIED TRANSPORT (One system, not competing) =====
  transportOptions: [TransportOptionSchema],
  
  // ===== ORDER CONSTRAINTS =====
  moq: { type: Number, default: 1 },
  orderMultiple: { type: Number, default: 1 },
  maxOrderQuantity: { type: Number },
  maxMonthlyCapacity: { type: Number },
  
  // ===== OTHER COSTS =====
  handlingCostPerUnit: { type: Number, default: 0 },
  dutyTaxRate: { type: Number, default: 0 },
  incoterm: { 
    type: String, 
    enum: ['EXW', 'FOB', 'CIF', 'DAP', 'DDP'],
    default: 'EXW'
  },
  
  // ===== STRATEGIC FLAGS =====
  sourcingStrategy: {
    type: String,
    enum: ['primary', 'secondary', 'backup', 'exclusive', 'contract_only'],
    default: 'secondary'
  },
  
  isPreferred: { type: Boolean, default: false },
  contractReference: { type: String },
  contractValidUntil: { type: Date },
  
  // ===== RISK MODELING =====
  riskScore: { type: Number, default: 0, min: 0, max: 100 },
  geopoliticalRisk: { type: Number, default: 0, min: 0, max: 100 },
  supplyDisruptionProbability: { type: Number, default: 0, min: 0, max: 1 },
  isSingleSource: { type: Boolean, default: false },
  
  // ===== VALIDITY =====
  validFrom: { type: Date, default: Date.now },
  validUntil: { type: Date },
  
  // ===== COMPUTED SCORES =====
  reliabilityScore: { type: Number, default: 100 },
  costScore: { type: Number, default: 100 },
  leadTimeScore: { type: Number, default: 100 },
  
  isActive: { type: Boolean, default: true },
  
  createdBy: { type: String, required: true },
  updatedBy: { type: String }
}, { timestamps: true });

// Critical indexes
SupplyOfferSchema.index({ orgCode: 1, supplierId: 1, productId: 1 });
SupplyOfferSchema.index({ orgCode: 1, productId: 1, isActive: 1 });
SupplyOfferSchema.index({ productId: 1, isActive: 1, validFrom: -1 });
SupplyOfferSchema.index({ productId: 1, isActive: 1, riskScore: 1 });
SupplyOfferSchema.index({ productId: 1, avgLeadTimeDays: 1 });
SupplyOfferSchema.index({ sourcingStrategy: 1 });
SupplyOfferSchema.index({ isPreferred: 1 });

/* -------------------------
   FIXED #1: Unified cost calculation (single source of truth)
-------------------------- */
SupplyOfferSchema.methods.calculateFullCost = async function(quantity, context, exchangeRateService, destinationLocation, productWeight, routeInfo = null) {
  // 1. Unit price with quantity breaks
  let unitPrice = this.basePrice;
  if (this.priceBreaks && this.priceBreaks.length > 0) {
    const sortedBreaks = [...this.priceBreaks].sort((a, b) => a.minQuantity - b.minQuantity);
    const validBreaks = sortedBreaks.filter(b => 
      quantity >= b.minQuantity && 
      (!b.maxQuantity || quantity <= b.maxQuantity)
    );
    if (validBreaks.length > 0) {
      const bestBreak = validBreaks.sort((a, b) => b.minQuantity - a.minQuantity)[0];
      unitPrice = bestBreak.unitPrice;
    }
  }
  
  // 2. Supplier cost with currency conversion
  let supplierCost = unitPrice * quantity;
  if (context.currency !== this.currency && exchangeRateService) {
    const rate = await exchangeRateService.getRate(this.currency, context.currency);
    const volatilityBuffer = context.exchangeVolatilityBuffer || 0.01;
    supplierCost = supplierCost * rate * (1 + volatilityBuffer);
  }
  
  // 3. Add handling and duty
  const handlingCost = (this.handlingCostPerUnit || 0) * quantity;
  const dutyCost = this.dutyTaxRate ? (unitPrice * quantity) * (this.dutyTaxRate / 100) : 0;
  supplierCost += handlingCost + dutyCost;
  
  // 4. Transport cost
  let transportCost = 0;
  let effectiveLeadTime = this.avgLeadTimeDays;
  let transportReliability = 0.95;
  let carbonFootprint = 0;
  
  if (destinationLocation) {
    const sourceLocation = await mongoose.model('SupplierLocation').findById(this.locationId);
    if (sourceLocation) {
      let route = routeInfo;
      if (!route) {
        route = await calculateDrivingDistance(
          sourceLocation.location.coordinates[1],
          sourceLocation.location.coordinates[0],
          destinationLocation.location.coordinates[1],
          destinationLocation.location.coordinates[0]
        );
      }
      
      const km = route?.distanceKm || 0;
      const durationHours = route?.durationHours || 0;
      
      const transportOption = this.transportOptions?.find(opt => opt.mode === 'road' && opt.isActive);
      if (transportOption) {
        transportCost = (transportOption.fixedCostPerShipment || 0) +
          km * (transportOption.baseCostPerKm || 0) +
          (productWeight || 1) * (transportOption.costPerKg || 0);
        effectiveLeadTime = durationHours > 0 
          ? Math.ceil(durationHours / 24) + transportOption.leadTimeDays
          : this.avgLeadTimeDays;
        transportReliability = transportOption.reliability;
        carbonFootprint = km * (productWeight || 1) * (transportOption.carbonFootprintPerKgPerKm || 0);
      }
    }
  }
  
  // 5. Unified risk calculation
  const effectiveRisk = Math.min(100, 
    (this.riskScore * 0.5) +
    (this.geopoliticalRisk * 0.3) +
    (context.urgency === 'emergency' ? 10 : 0) +
    (context.urgency === 'expedited' ? 5 : 0)
  );
  
  return {
    unitPrice,
    supplierCost,
    transportCost,
    handlingCost,
    dutyCost,
    totalLandedCost: supplierCost + transportCost,
    effectiveLeadTime,
    effectiveRisk,
    transportReliability,
    carbonFootprint,
    costPerUnit: (supplierCost + transportCost) / quantity
  };
};

/* -------------------------
   FIXED #2: Correct $or query with proper null handling
-------------------------- */
SupplyOfferSchema.statics.findValidOffers = async function(productId, context) {
  const asOfDate = context.asOfDate || new Date();
  
  const baseQuery = {
    productId: productId,
    isActive: true,
    validFrom: { $lte: asOfDate },
    $and: [
      {
        $or: [
          { validUntil: { $gte: asOfDate } },
          { validUntil: null }
        ]
      },
      {
        $or: [
          { contractValidUntil: { $gte: asOfDate } },
          { contractValidUntil: null }
        ]
      }
    ]
  };
  
  // Only apply MOQ if quantity is provided
  if (context.quantity) {
    baseQuery.moq = { $lte: context.quantity };
  }
  
  // Only apply lead time filter if provided
  if (context.maxLeadTimeDays) {
    baseQuery.avgLeadTimeDays = { $lte: context.maxLeadTimeDays };
  }
  
  // Only apply risk filter if riskTolerance specified
  if (context.riskTolerance === 'low') {
    baseQuery.riskScore = { $lte: 20 };
  } else if (context.riskTolerance === 'medium') {
    baseQuery.riskScore = { $lte: 50 };
  }
  
  // FIXED: Don't filter maxMonthlyCapacity in MongoDB query
  // Instead, fetch all and filter in memory (treat null as unlimited)
  const offers = await this.find(baseQuery);
  
  // Post-filter for capacity (null = unlimited capacity)
  return offers.filter(offer => {
    // If quantity is not specified, include all
    if (!context.quantity) return true;
    
    // If maxMonthlyCapacity is null/undefined, treat as unlimited
    if (offer.maxMonthlyCapacity === null || offer.maxMonthlyCapacity === undefined) {
      return true;
    }
    
    // Otherwise check capacity
    return offer.maxMonthlyCapacity >= context.quantity;
  });
};

/* -------------------------
   SIMPLIFIED: Ranked offers using unified calculation
-------------------------- */
SupplyOfferSchema.statics.getRankedOffers = async function(productId, context, weights = null, exchangeRateService = null) {
  const offers = await this.findValidOffers(productId, context);
  if (offers.length === 0) return [];
  
  const Variant = mongoose.model('Variant');
  const variantIds = offers.map(o => o.variantId).filter(Boolean);
  const variants = await Variant.find({ _id: { $in: variantIds } });
  const variantMap = new Map(variants.map(v => [v._id.toString(), v]));
  
  for (const offer of offers) {
    if (offer.variantId && !variantMap.has(offer.variantId.toString())) {
      throw new Error(`Missing variant for offer ${offer._id}`);
    }
  }
  
  const destinationLocation = await mongoose.model('SupplierLocation').findById(context.destinationLocationId);
  if (!destinationLocation) {
    throw new Error('Destination location not found');
  }
  
  const routesCache = new Map();
  
  const defaultWeights = {
    routine: { cost: 0.5, leadTime: 0.2, risk: 0.2, reliability: 0.1 },
    expedited: { cost: 0.2, leadTime: 0.5, risk: 0.2, reliability: 0.1 },
    emergency: { cost: 0.1, leadTime: 0.7, risk: 0.1, reliability: 0.1 }
  };
  
  const activeWeights = weights || defaultWeights[context.urgency] || defaultWeights.routine;
  
  const results = await Promise.all(offers.map(async (offer) => {
    const variant = offer.variantId ? variantMap.get(offer.variantId.toString()) : null;
    const productWeight = variant?.weight || 1;
    
    let route = routesCache.get(offer.locationId.toString());
    if (!route) {
      const sourceLocation = await mongoose.model('SupplierLocation').findById(offer.locationId);
      if (sourceLocation) {
        route = await calculateDrivingDistance(
          sourceLocation.location.coordinates[1],
          sourceLocation.location.coordinates[0],
          destinationLocation.location.coordinates[1],
          destinationLocation.location.coordinates[0]
        );
        routesCache.set(offer.locationId.toString(), route);
      }
    }
    
    const cost = await offer.calculateFullCost(context.quantity, context, exchangeRateService, destinationLocation, productWeight, route);
    
    return {
      supplyOffer: offer,
      costPerUnit: cost.costPerUnit,
      supplierCost: cost.supplierCost,
      transportCost: cost.transportCost,
      totalLandedCost: cost.totalLandedCost,
      effectiveLeadTime: cost.effectiveLeadTime,
      effectiveRisk: cost.effectiveRisk,
      costScore: 0,
      leadTimeScore: 0,
      riskScore: 0,
      reliabilityScore: cost.transportReliability * 100,
      compositeScore: 0,
      carbonFootprint: cost.carbonFootprint,
      meetsUrgency: context.maxLeadTimeDays ? cost.effectiveLeadTime <= context.maxLeadTimeDays : true,
      meetsCapacity: context.quantity ? 
        (offer.maxMonthlyCapacity === null || offer.maxMonthlyCapacity === undefined ? 
        true : 
        offer.maxMonthlyCapacity >= context.quantity) 
    : true
    };
  }));
  
  const costs = results.map(r => r.totalLandedCost);
  const leadTimes = results.map(r => r.effectiveLeadTime);
  const risks = results.map(r => r.effectiveRisk);
  
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const costRange = maxCost === minCost ? 1 : maxCost - minCost;
  
  const minLeadTime = Math.min(...leadTimes);
  const maxLeadTime = Math.max(...leadTimes);
  const leadTimeRange = maxLeadTime === minLeadTime ? 1 : maxLeadTime - minLeadTime;
  
  const minRisk = Math.min(...risks);
  const maxRisk = Math.max(...risks);
  const riskRange = maxRisk === minRisk ? 1 : maxRisk - minRisk;
  
  const rankedResults = results.map((item, index) => {
    const costScore = 100 * (1 - (item.totalLandedCost - minCost) / costRange);
    const leadTimeScore = 100 * (1 - (item.effectiveLeadTime - minLeadTime) / leadTimeRange);
    const riskScore = maxRisk === minRisk ? 100 : 100 * (1 - (risks[index] - minRisk) / riskRange);
    
    const compositeScore = 
      (activeWeights.cost || 0) * costScore +
      (activeWeights.leadTime || 0) * leadTimeScore +
      (activeWeights.risk || 0) * riskScore +
      (activeWeights.reliability || 0) * item.reliabilityScore;
    
    return { ...item, costScore, leadTimeScore, riskScore, compositeScore };
  });
  
  return rankedResults.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) {
      return b.compositeScore - a.compositeScore;
    }
    return a.totalLandedCost - b.totalLandedCost;
  });
};

/* -------------------------
   EXECUTABLE SOURCING RULES
-------------------------- */
const SourcingRuleSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  
  rules: [{
    condition: { type: String, enum: ['always', 'cost_below', 'leadtime_under', 'risk_below', 'capacity_available'], required: true },
    threshold: { type: Number },
    supplyOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplyOffer', required: true },
    priority: { type: Number, default: 1 }
  }],
  
  fallbackStrategy: {
    type: String,
    enum: ['cheapest', 'fastest', 'safest', 'balanced'],
    default: 'balanced'
  },
  
  lastEvaluatedAt: { type: Date },
  activeAllocation: [{
    supplyOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplyOffer' },
    percentage: Number,
    reason: String
  }]
}, { timestamps: true });

SourcingRuleSchema.index({ orgCode: 1, productId: 1 });

SourcingRuleSchema.methods.evaluate = async function(context, exchangeRateService = null) {
  const SupplyOffer = mongoose.model('SupplyOffer');
  const rankedOffers = await SupplyOffer.getRankedOffers(this.productId, context, null, exchangeRateService);
  
  const matchedAllocations = [];
  
  for (const rule of this.rules) {
    const matchingOffer = rankedOffers.find(r => r.supplyOffer._id.equals(rule.supplyOfferId));
    if (!matchingOffer) continue;
    
    let conditionMet = false;
    switch (rule.condition) {
      case 'always': conditionMet = true; break;
      case 'cost_below': conditionMet = matchingOffer.costPerUnit <= (rule.threshold || Infinity); break;
      case 'leadtime_under': conditionMet = matchingOffer.effectiveLeadTime <= (rule.threshold || Infinity); break;
      case 'risk_below': conditionMet = matchingOffer.effectiveRisk <= (rule.threshold || Infinity); break;
      case 'capacity_available': conditionMet = matchingOffer.meetsCapacity; break;
    }
    
    if (conditionMet) {
      matchedAllocations.push({
        supplyOfferId: rule.supplyOfferId,
        percentage: 100 / this.rules.filter(r => this.evaluateConditionQuick(r, rankedOffers)).length,
        reason: `Condition met: ${rule.condition}`
      });
    }
  }
  
  if (matchedAllocations.length === 0) {
    return this.applyFallbackStrategy(rankedOffers, context);
  }
  
  this.activeAllocation = matchedAllocations;
  this.lastEvaluatedAt = new Date();
  await this.save();
  
  return matchedAllocations;
};

SourcingRuleSchema.methods.evaluateConditionQuick = function(rule, rankedOffers) {
  const matchingOffer = rankedOffers.find(r => r.supplyOffer._id.equals(rule.supplyOfferId));
  if (!matchingOffer) return false;
  
  switch (rule.condition) {
    case 'always': return true;
    case 'cost_below': return matchingOffer.costPerUnit <= (rule.threshold || Infinity);
    case 'leadtime_under': return matchingOffer.effectiveLeadTime <= (rule.threshold || Infinity);
    case 'risk_below': return matchingOffer.effectiveRisk <= (rule.threshold || Infinity);
    case 'capacity_available': return matchingOffer.meetsCapacity;
    default: return false;
  }
};

SourcingRuleSchema.methods.applyFallbackStrategy = function(rankedOffers, context) {
  let selectedOffer = null;
  
  switch (this.fallbackStrategy) {
    case 'cheapest':
      selectedOffer = rankedOffers.sort((a, b) => a.costPerUnit - b.costPerUnit)[0];
      break;
    case 'fastest':
      selectedOffer = rankedOffers.sort((a, b) => a.effectiveLeadTime - b.effectiveLeadTime)[0];
      break;
    case 'safest':
      selectedOffer = rankedOffers.sort((a, b) => b.reliabilityScore - a.reliabilityScore)[0];
      break;
    case 'balanced':
    default:
      selectedOffer = rankedOffers.sort((a, b) => b.compositeScore - a.compositeScore)[0];
      break;
  }
  
  if (selectedOffer) {
    return [{
      supplyOfferId: selectedOffer.supplyOffer._id,
      percentage: 100,
      reason: `Fallback strategy: ${this.fallbackStrategy}`
    }];
  }
  
  return [];
};

/* -------------------------
   MAIN SUPPLIER SCHEMA
-------------------------- */
const SupplierSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  supplierCode: { type: String, required: true },
  name: { type: String, required: true },
  
  status: {
    type: String,
    enum: ['active', 'blocked', 'preferred', 'inactive'],
    default: 'active'
  },
  
  email: { type: String },
  phone: { type: String },
  
  attributes: [AttributeSchema],
  
  performanceSummary: {
    overallScore: { type: Number, default: 100 },
    onTimeRate: { type: Number, default: 100 },
    qualityScore: { type: Number, default: 100 },
    lastUpdated: { type: Date }
  },
  
  version: { type: Number, default: 1 },
  
  createdBy: { type: String, required: true },
  updatedBy: { type: String }
}, { 
  timestamps: true,
  versionKey: false
});

SupplierSchema.index({ orgCode: 1, supplierCode: 1 }, { unique: true });
SupplierSchema.index({ orgCode: 1, status: 1 });

/* -------------------------
   EXPORT
-------------------------- */
module.exports = {
  Supplier: mongoose.model('Supplier', SupplierSchema),
  SupplierLocation: mongoose.model('SupplierLocation', SupplierLocationSchema),
  SupplyOffer: mongoose.model('SupplyOffer', SupplyOfferSchema),
  ProductPerformanceMetrics: mongoose.model('ProductPerformanceMetrics', ProductPerformanceMetricsSchema),
  SourcingRule: mongoose.model('SourcingRule', SourcingRuleSchema),
  ExchangeRate: mongoose.model('ExchangeRate', ExchangeRateSchema),
  Variant: mongoose.model('Variant', VariantSchema)
};