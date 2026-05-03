const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// ========== FIRST: Import ALL dependent models to ensure they're registered ==========

require('../products/model');           // Product model
require('../supplier/model');           // Supplier, SupplyOffer models
require('./transactionModel');          // InventoryTransaction model
require('./stockModel');                // StockState model
require('./warehouseModel');            // Warehouse model
require('./transferModel');             // Transfer model
require('./purchaseOrderModel');        // PurchaseOrder model

/* -------------------------
   HELPER: Quantity Rounding
   Decides rounding policy at domain boundary
-------------------------- */
const roundQty = (q) => Math.ceil(q); // Always round up to avoid shortages

/* -------------------------
   HELPER: VariantId Normalization (Consistent - returns ObjectId or null)
   Fixes MongoDB mixed type matching bug consistently
-------------------------- */
const normalizeVariant = (variantId) => {
  if (!variantId) return null;
  if (variantId instanceof mongoose.Types.ObjectId) return variantId;
  if (typeof variantId === 'string' && mongoose.Types.ObjectId.isValid(variantId)) {
    return new mongoose.Types.ObjectId(variantId);
  }
  return null;
};

/* -------------------------
   HELPER: Zero Demand Guard
-------------------------- */
const isDormant = (totalSales) => totalSales === 0;

/* -------------------------
   HELPER: Stockout Probability (Smooth curve)
-------------------------- */
const calculateStockoutProbability = (daysOfCover) => {
  if (daysOfCover <= 0) return 0.99;
  return Math.min(0.99, Math.exp(-daysOfCover / 5));
};

/* -------------------------
   HELPER: Exponential Moving Average for Forecast Smoothing
-------------------------- */
const calculateEMA = (previousAvg, newValue, alpha = 0.3) => {
  if (previousAvg === null || previousAvg === undefined) return newValue;
  if (previousAvg === 0 && newValue === 0) return 0;
  return (alpha * newValue) + ((1 - alpha) * previousAvg);
};

/* -------------------------
   HELPER: Clamp value between min and max
-------------------------- */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* -------------------------
   HELPER: Clamp seasonality ratio to prevent extreme values
-------------------------- */
const clampSeasonality = (ratio) => clamp(ratio, 0.5, 2.0);

/* -------------------------
   EVENT IDENTITY & DEDUPE MODELS
-------------------------- */

// Processed Events for deduplication (atomic insert)
const ProcessedEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true, index: true },
  orgCode: { type: String, required: true, index: true },
  entityId: { type: String, index: true },
  correlationId: { type: String, index: true },
  processedAt: { type: Date, default: Date.now },
  ttl: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
});

ProcessedEventSchema.index({ ttl: 1 }, { expireAfterSeconds: 0 });
const ProcessedEvent = mongoose.model('ProcessedEvent', ProcessedEventSchema);

// Decision Lock for race condition prevention (with atomic acquisition)
const DecisionLockSchema = new mongoose.Schema({
  lockKey: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  entityType: { type: String, enum: ['po', 'transfer', 'reorder', 'batch'], required: true },
  entityId: { type: String },
  forecastVersion: { type: Number },
  lockedAt: { type: Date, default: Date.now },
  lockedBy: { type: String, default: 'optimizer' },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 5 * 60 * 1000) }
});

DecisionLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const DecisionLock = mongoose.model('DecisionLock', DecisionLockSchema);

// Decision Queue for async processing (decouples health from optimization)
const DecisionQueueSchema = new mongoose.Schema({
  queueId: { type: String, required: true, unique: true },
  correlationId: { type: String, required: true, index: true },
  orgCode: { type: String, required: true, index: true },
  decisionType: { type: String, enum: ['purchase_order', 'transfer', 'reorder', 'batch'], required: true },
  priority: { type: Number, default: 5, min: 1, max: 10 },
  
  eventData: { type: mongoose.Schema.Types.Mixed, required: true },
  
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed', 'retry'],
    default: 'pending'
  },
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  lastError: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  scheduledFor: { type: Date, default: Date.now }
});

DecisionQueueSchema.index({ status: 1, priority: -1, scheduledFor: 1 });
const DecisionQueue = mongoose.model('DecisionQueue', DecisionQueueSchema);

// Decision Log for explainability
const DecisionLogSchema = new mongoose.Schema({
  decisionId: { type: String, required: true, unique: true },
  correlationId: { type: String, required: true, index: true },
  orgCode: { type: String, required: true, index: true },
  decisionType: { type: String, enum: ['purchase_order', 'transfer', 'reorder', 'batch'], required: true },
  
  forecastVersion: { type: Number },
  healthVersion: { type: Number },
  
  forecastId: { type: mongoose.Schema.Types.ObjectId },
  healthId: { type: mongoose.Schema.Types.ObjectId },
  stockId: { type: String },
  
  decision: {
    productId: { type: mongoose.Schema.Types.ObjectId },
    locationId: { type: String },
    quantity: { type: Number },
    urgency: { type: String },
    reason: { type: String },
    fromWarehouseId: { type: String },
    toWarehouseId: { type: String }
  },
  
  outcome: {
    success: { type: Boolean },
    resultId: { type: String },
    error: { type: String }
  },
  
  createdAt: { type: Date, default: Date.now }
});

DecisionLogSchema.index({ correlationId: 1, createdAt: -1 });
DecisionLogSchema.index({ orgCode: 1, decisionType: 1, createdAt: -1 });
const DecisionLog = mongoose.model('DecisionLog', DecisionLogSchema);

/* -------------------------
   LOCK HELPER FUNCTIONS (Atomic)
-------------------------- */
const acquireLock = async (lockKey, entityType, orgCode, entityId, forecastVersion = null, ttlSeconds = 300) => {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const now = new Date();
  
  try {
    const lock = new DecisionLock({
      lockKey,
      orgCode,
      entityType,
      entityId,
      forecastVersion,
      lockedAt: now,
      lockedBy: 'optimizer',
      expiresAt
    });
    
    await lock.save();
    return true;
  } catch (error) {
    if (error.code === 11000) {
      const existingLock = await DecisionLock.findOne({ lockKey });
      
      if (existingLock && existingLock.expiresAt < now) {
        await DecisionLock.deleteOne({ lockKey });
        try {
          const newLock = new DecisionLock({
            lockKey,
            orgCode,
            entityType,
            entityId,
            forecastVersion,
            lockedAt: now,
            lockedBy: 'optimizer',
            expiresAt
          });
          await newLock.save();
          return true;
        } catch (retryError) {
          if (retryError.code === 11000) return false;
          throw retryError;
        }
      }
      return false;
    }
    throw error;
  }
};

const releaseLock = async (lockKey) => {
  await DecisionLock.deleteOne({ lockKey });
};

/* -------------------------
   DECISION QUEUE HELPER
-------------------------- */
const enqueueDecision = async (decisionType, eventData, orgCode, correlationId, priority = 5) => {
  const queueId = uuidv4();
  const queueItem = new DecisionQueue({
    queueId,
    correlationId,
    orgCode,
    decisionType,
    priority,
    eventData,
    status: 'pending'
  });
  await queueItem.save();
  return queueItem;
};

// FIX #1: Atomic queue processing - prevents duplicate execution across workers
const processDecisionQueue = async (optimizationService, batchSize = 10) => {
  const results = [];
  
  for (let i = 0; i < batchSize; i++) {
    // Atomic claim: find one pending item and mark it as processing in a single operation
    const item = await DecisionQueue.findOneAndUpdate(
      {
        status: 'pending',
        scheduledFor: { $lte: new Date() }
      },
      {
        $set: { status: 'processing' }
      },
      {
        sort: { priority: -1, createdAt: 1 },
        returnDocument: 'after'
      }
    );
    
    if (!item) break; // No more items to process
    
    try {
      let result;
      if (item.decisionType === 'purchase_order') {
        result = await optimizationService.createPurchaseOrderFromHealth(item.eventData);
      } else if (item.decisionType === 'transfer') {
        result = await optimizationService.findAndCreateTransferFromHealth(item.eventData);
      } else if (item.decisionType === 'batch') {
        result = await optimizationService.batchOptimize();
      }
      
      item.status = 'completed';
      item.processedAt = new Date();
      await item.save();
      results.push({ success: true, result, queueId: item.queueId });
    } catch (error) {
      console.error(`[DecisionQueue] Failed to process ${item.queueId}:`, error.message);
      item.retryCount += 1;
      
      if (item.retryCount >= item.maxRetries) {
        item.status = 'failed';
        item.lastError = error.message;
      } else {
        item.status = 'retry';
        item.scheduledFor = new Date(Date.now() + Math.pow(2, item.retryCount) * 1000); // Exponential backoff
      }
      await item.save();
      results.push({ success: false, error: error.message, queueId: item.queueId });
    }
  }
  
  return results;
};

/* -------------------------
   SUPPLY CHAIN OPTIMIZER LAYER
-------------------------- */

// ========== FORECAST CONTEXT (with versioning) ==========
const DemandForecastSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true },
  
  version: { type: Number, default: 1 },
  lastVersionReason: { type: String },
  
  isDormant: { type: Boolean, default: false },
  dailyAvgDemand: { type: Number, default: 0 },
  weeklyAvgDemand: { type: Number, default: 0 },
  monthlyAvgDemand: { type: Number, default: 0 },
  
  previousDailyAvg: { type: Number, default: 0 },
  
  seasonalityFactors: {
    monday: { type: Number, default: 1 },
    tuesday: { type: Number, default: 1 },
    wednesday: { type: Number, default: 1 },
    thursday: { type: Number, default: 1 },
    friday: { type: Number, default: 1 },
    saturday: { type: Number, default: 1 },
    sunday: { type: Number, default: 1 }
  },
  
  salesVelocity: { type: Number, default: 0 },
  inboundVelocity: { type: Number, default: 0 },
  stockoutProbability: { type: Number, default: 0 },
  
  lastCalculatedAt: { type: Date, default: Date.now },
  calculationWindow: { type: Number, default: 30 }
}, { timestamps: true });

DemandForecastSchema.index({ orgCode: 1, productId: 1, locationId: 1, variantId: 1 }, { unique: true });
DemandForecastSchema.index({ stockoutProbability: -1 });

// ========== HEALTH CONTEXT (with versioning) ==========
const InventoryHealthSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true },
  
  version: { type: Number, default: 1 },
  basedOnForecastVersion: { type: Number },
  
  daysOfCover: { type: Number, default: 0 },
  riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
  excessStock: { type: Number, default: 0, min: 0 },
  shortageQuantity: { type: Number, default: 0, min: 0 },
  
  healthScore: { type: Number, default: 100, min: 0, max: 100 },
  criticalityScore: { type: Number, default: 0, min: 0, max: 100 },
  
  recommendedAction: { 
    type: String, 
    enum: ['reorder', 'transfer_in', 'transfer_out', 'reduce', 'do_nothing'],
    default: 'do_nothing'
  },
  recommendedQuantity: { type: Number, default: 0, min: 0 },
  priority: { type: Number, default: 0, min: 0, max: 10 },
  
  lastEvaluatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// FIX #5: Add missing compound index for reorder queries
InventoryHealthSchema.index({ orgCode: 1, recommendedAction: 1, priority: -1 });
InventoryHealthSchema.index({ orgCode: 1, productId: 1, locationId: 1, variantId: 1 }, { unique: true });
InventoryHealthSchema.index({ riskLevel: 1, priority: -1 });
InventoryHealthSchema.index({ healthScore: 1 });

// Register models
const DemandForecast = mongoose.model('DemandForecast', DemandForecastSchema);
const InventoryHealth = mongoose.model('InventoryHealth', InventoryHealthSchema);

/* -------------------------
   CONTEXT 1: FORECASTING CONTEXT
-------------------------- */

class DemandForecastModel {
  constructor(data) {
    this.productId = data.productId;
    this.variantId = normalizeVariant(data.variantId);
    this.locationId = data.locationId;
    this.orgCode = data.orgCode;
    this.isDormant = data.isDormant || false;
    this.dailyAvg = data.dailyAvg;
    this.previousDailyAvg = data.previousDailyAvg || 0;
    this.weeklyAvg = data.weeklyAvg;
    this.monthlyAvg = data.monthlyAvg;
    this.seasonality = data.seasonality;
    this.velocity = data.velocity;
    this.stockoutProbability = data.stockoutProbability;
    this.calculatedAt = data.calculatedAt;
  }
  
  static fromAggregation(salesByDay, totalSales, stock, productId, variantId, locationId, orgCode, previousForecast = null, orgSettings = null) {
    if (isDormant(totalSales)) {
      return new DemandForecastModel({
        productId, variantId, locationId, orgCode,
        isDormant: true,
        dailyAvg: 0, weeklyAvg: 0, monthlyAvg: 0,
        seasonality: {}, velocity: 0, stockoutProbability: 0,
        calculatedAt: new Date()
      });
    }
    
    // Use 30-day window consistently, not active days
    const rawDailyAvg = totalSales / 30;
    
    const previousAvg = previousForecast?.dailyAvgDemand;
    const dailyAvg = Math.ceil(calculateEMA(previousAvg, rawDailyAvg, 0.3));
    
    // Clamp seasonality ratios to prevent extreme values
    const seasonality = {};
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 1; i <= 7; i++) {
      const ratio = salesByDay[i] / Math.max(1, dailyAvg);
      seasonality[dayNames[i - 1]] = clampSeasonality(ratio);
    }
    
    const safeDailyAvg = Math.max(0.001, dailyAvg);
    const daysOfCover = stock?.availableStock / safeDailyAvg || 0;
    const stockoutProbability = calculateStockoutProbability(daysOfCover);
    
    return new DemandForecastModel({
      productId, variantId, locationId, orgCode,
      isDormant: false,
      dailyAvg,
      previousDailyAvg: previousAvg || 0,
      weeklyAvg: dailyAvg * 7,
      monthlyAvg: dailyAvg * 30,
      seasonality,
      velocity: dailyAvg,
      stockoutProbability,
      calculatedAt: new Date()
    });
  }
  
  toDocument(version = 1, reason = 'initial') {
    return {
      orgCode: this.orgCode,
      productId: this.productId instanceof mongoose.Types.ObjectId ? this.productId : new mongoose.Types.ObjectId(this.productId),
      variantId: normalizeVariant(this.variantId),
      locationId: this.locationId,
      isDormant: this.isDormant,
      dailyAvgDemand: this.dailyAvg,
      previousDailyAvg: this.previousDailyAvg,
      weeklyAvgDemand: this.weeklyAvg,
      monthlyAvgDemand: this.monthlyAvg,
      seasonalityFactors: this.seasonality,
      salesVelocity: this.velocity,
      stockoutProbability: this.stockoutProbability,
      lastCalculatedAt: this.calculatedAt,
      calculationWindow: 30,
      version,
      lastVersionReason: reason
    };
  }
}

class ForecastingService {
  constructor(orgCode, inventoryPort, orgSettingsService = null) {
    this.orgCode = orgCode;
    this.inventoryPort = inventoryPort;
    this.orgSettingsService = orgSettingsService;
    this.eventEmitter = null;
  }
  
  setEventEmitter(emitter) { this.eventEmitter = emitter; }
  
  async calculateAndPersist(productId, locationId, variantId = null, correlationId = null) {
    const Transaction = mongoose.model('InventoryTransaction');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const normalizedVariant = normalizeVariant(variantId);
    const productObjectId = new mongoose.Types.ObjectId(productId);
    
    const sales = await Transaction.aggregate([
      { $match: {
          orgCode: this.orgCode,
          productId: productObjectId,
          locationId: locationId,
          variantId: normalizedVariant,
          type: 'OUT_SALE',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      { $group: { _id: { $dayOfWeek: "$createdAt" }, totalSales: { $sum: "$quantity" } } }
    ]);
    
    const salesByDay = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const sale of sales) salesByDay[sale._id] = Math.abs(sale.totalSales);
    
    const totalSales = Object.values(salesByDay).reduce((sum, v) => sum + v, 0);
    const stock = await this.inventoryPort.getStock(productId, locationId, variantId);
    
    const existingForecast = await DemandForecast.findOne({
      orgCode: this.orgCode,
      productId: productObjectId,
      variantId: normalizedVariant,
      locationId
    });
    
    const orgSettings = this.orgSettingsService ? await this.orgSettingsService.getOrganizationSettings(this.orgCode) : null;
    
    const forecastModel = DemandForecastModel.fromAggregation(
      salesByDay, totalSales, stock,
      productObjectId, normalizedVariant, locationId, this.orgCode,
      existingForecast, orgSettings
    );
    
    if (forecastModel.isDormant) {
      await DemandForecast.deleteOne({
        orgCode: this.orgCode,
        productId: productObjectId,
        variantId: normalizedVariant,
        locationId
      });
      return null;
    }
    
    const filter = {
      orgCode: this.orgCode,
      productId: productObjectId,
      variantId: normalizedVariant,
      locationId
    };
    
    const newVersion = (existingForecast?.version || 0) + 1;
    const forecastDoc = forecastModel.toDocument(newVersion, 'recalculated_from_sales_data');
    
    const persisted = await DemandForecast.findOneAndUpdate(
      filter,
      { $set: forecastDoc },
      { upsert: true, returnDocument: 'after' }
    );
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit({
        type: 'forecast.updated',
        eventId: uuidv4(),
        correlationId: correlationId || uuidv4(),
        orgCode: this.orgCode,
        productId: productId.toString(),
        variantId: normalizedVariant?.toString(),
        locationId: locationId,
        version: persisted.version,
        forecast: persisted,
        timestamp: new Date()
      });
    }
    
    return persisted;
  }
}

/* -------------------------
   CONTEXT 2: HEALTH CONTEXT
-------------------------- */

class InventoryHealthModel {
  constructor(data) {
    this.orgCode = data.orgCode;
    this.productId = data.productId;
    this.variantId = normalizeVariant(data.variantId);
    this.locationId = data.locationId;
    this.daysOfCover = data.daysOfCover;
    this.excessStock = data.excessStock;
    this.shortageQuantity = data.shortageQuantity;
    this.healthScore = data.healthScore;
    this.riskLevel = data.riskLevel;
    this.priority = data.priority;
    this.recommendedAction = data.recommendedAction;
    this.recommendedQuantity = data.recommendedQuantity;
  }
  
  static fromStockAndForecast(stock, forecast, orgSettings = null) {
    const defaultLeadTimeDays = orgSettings?.procurement?.defaultLeadTimeDays || 5;
    const defaultSafetyStockDays = orgSettings?.inventory?.defaultSafetyStockDays || 7;
    
    const dailyAvgDemand = Math.max(0.001, forecast.dailyAvgDemand);
    const daysOfCover = stock.availableStock / dailyAvgDemand;
    const excessStock = Math.max(0, stock.physicalStock - (stock.maxStockLevel || Infinity));
    
    const safetyStock = dailyAvgDemand * defaultSafetyStockDays;
    const reorderPoint = (dailyAvgDemand * defaultLeadTimeDays) + safetyStock;
    const shortageQuantity = Math.max(0, roundQty(reorderPoint - stock.availableStock));
    
    let riskLevel = 'low';
    let baseHealthScore = 100;
    
    if (daysOfCover < 1) {
      riskLevel = 'critical';
      baseHealthScore = 10;
    } else if (daysOfCover < 3) {
      riskLevel = 'high';
      baseHealthScore = 30;
    } else if (daysOfCover < 7) {
      riskLevel = 'medium';
      baseHealthScore = 60;
    }
    
    let healthScore = clamp(baseHealthScore, 0, 100);
    
    if (excessStock > 0) {
      const excessPenalty = Math.min(30, (excessStock / Math.max(1, stock.physicalStock)) * 50);
      healthScore = clamp(healthScore - excessPenalty, 0, 100);
    }
    
    let recommendedAction = 'do_nothing';
    let recommendedQuantity = 0;
    let priority = 0;
    
    if (shortageQuantity > 0) {
      const daysUntilStockout = stock.availableStock / dailyAvgDemand;
      if (daysUntilStockout < 1) priority = 10;
      else if (daysUntilStockout < 3) priority = 8;
      else if (daysUntilStockout < 5) priority = 6;
      else if (daysUntilStockout < 7) priority = 4;
      else priority = 2;
      
      recommendedAction = 'reorder';
      recommendedQuantity = roundQty(shortageQuantity + (dailyAvgDemand * defaultLeadTimeDays));
    } else if (excessStock > 0) {
      recommendedAction = 'transfer_out';
      recommendedQuantity = roundQty(excessStock);
      priority = Math.min(5, Math.floor(excessStock / Math.max(1, dailyAvgDemand)));
    }
    
    return new InventoryHealthModel({
      orgCode: stock.orgCode,
      productId: stock.productId,
      variantId: stock.variantId,
      locationId: stock.locationId,
      daysOfCover: roundQty(daysOfCover),
      excessStock: roundQty(excessStock),
      shortageQuantity: roundQty(shortageQuantity),
      healthScore: clamp(healthScore, 0, 100),
      riskLevel,
      priority: clamp(priority, 0, 10),
      recommendedAction,
      recommendedQuantity
    });
  }
  
  toDocument(version = 1, basedOnForecastVersion = 1) {
    return {
      orgCode: this.orgCode,
      productId: this.productId instanceof mongoose.Types.ObjectId ? this.productId : new mongoose.Types.ObjectId(this.productId),
      variantId: normalizeVariant(this.variantId),
      locationId: this.locationId,
      daysOfCover: this.daysOfCover,
      riskLevel: this.riskLevel,
      excessStock: this.excessStock,
      shortageQuantity: this.shortageQuantity,
      healthScore: clamp(this.healthScore, 0, 100),
      criticalityScore: clamp((1 - Math.min(1, this.daysOfCover / 30)) * 100, 0, 100),
      recommendedAction: this.recommendedAction,
      recommendedQuantity: this.recommendedQuantity,
      priority: clamp(this.priority, 0, 10),
      lastEvaluatedAt: new Date(),
      version,
      basedOnForecastVersion
    };
  }
}

class HealthService {
  constructor(orgCode, inventoryPort, orgSettingsService = null) {
    this.orgCode = orgCode;
    this.inventoryPort = inventoryPort;
    this.orgSettingsService = orgSettingsService;
    this.eventEmitter = null;
  }
  
  setEventEmitter(emitter) { this.eventEmitter = emitter; }
  
  async calculateAndPersistWithForecast(productId, locationId, variantId, forecastDoc, orgSettings = null, correlationId = null) {
    const stock = await this.inventoryPort.getStock(productId, locationId, variantId);
    if (!stock) return null;
    
    const normalizedVariant = normalizeVariant(variantId);
    const productObjectId = new mongoose.Types.ObjectId(productId);
    
    const filter = {
      orgCode: this.orgCode,
      productId: productObjectId,
      variantId: normalizedVariant,
      locationId
    };
    
    const healthModel = InventoryHealthModel.fromStockAndForecast(stock, forecastDoc, orgSettings);
    const newVersion = (forecastDoc.version || 1);
    const healthDoc = healthModel.toDocument(newVersion, forecastDoc.version);
    
    const persisted = await InventoryHealth.findOneAndUpdate(
      filter,
      { $set: healthDoc },
      { upsert: true, returnDocument: 'after' }
    );
    
    // FIX #2: Prevent duplicate enqueue storms with lock
    if (this.eventEmitter && persisted.recommendedAction !== 'do_nothing' && persisted.priority >= 7) {
      const lockKey = `${this.orgCode}:${productId}:${locationId}:${normalizedVariant?.toString() || 'no-variant'}`;
      const locked = await acquireLock(lockKey, 'reorder', this.orgCode, productId, null, 120);
      
      if (locked) {
        await enqueueDecision(
          persisted.recommendedAction === 'reorder' ? 'purchase_order' : 'transfer',
          {
            type: 'health.updated',
            productId: productId.toString(),
            variantId: normalizedVariant?.toString(),
            locationId: locationId,
            recommendedAction: persisted.recommendedAction,
            recommendedQuantity: persisted.recommendedQuantity,
            riskLevel: persisted.riskLevel,
            priority: persisted.priority,
            basedOnForecastVersion: forecastDoc.version,
            correlationId: correlationId || uuidv4()
          },
          this.orgCode,
          correlationId || uuidv4(),
          persisted.priority
        );
        await releaseLock(lockKey);
      }
    }
    
    // Still emit event for other listeners
    if (this.eventEmitter) {
      await this.eventEmitter.emit({
        type: 'health.updated',
        eventId: uuidv4(),
        correlationId: correlationId || uuidv4(),
        orgCode: this.orgCode,
        productId: productId.toString(),
        variantId: normalizedVariant?.toString(),
        locationId: locationId,
        version: newVersion,
        basedOnForecastVersion: forecastDoc.version,
        riskLevel: healthModel.riskLevel,
        priority: healthModel.priority,
        recommendedAction: healthModel.recommendedAction,
        recommendedQuantity: healthModel.recommendedQuantity,
        healthScore: healthModel.healthScore,
        daysOfCover: healthModel.daysOfCover,
        timestamp: new Date()
      });
    }
    
    return persisted;
  }
  
  async onForecastUpdated(event) {
    const currentForecast = await DemandForecast.findOne({
      orgCode: event.orgCode,
      productId: new mongoose.Types.ObjectId(event.productId),
      variantId: normalizeVariant(event.variantId),
      locationId: event.locationId
    });
    
    if (currentForecast && event.version < currentForecast.version) {
      console.log(`[Health] Ignoring stale forecast event v${event.version} (current v${currentForecast.version})`);
      return null;
    }
    
    // FIX #3: Prevent stale forecast overwrite by age check
    const now = Date.now();
    const forecastUpdatedAt = event.forecast?.updatedAt ? new Date(event.forecast.updatedAt).getTime() : now;
    const forecastAge = now - forecastUpdatedAt;
    
    if (forecastAge > 60 * 1000) {
      console.log(`[Health] Stale forecast ignored (age: ${forecastAge}ms)`);
      return null;
    }
    
    return this.calculateAndPersistWithForecast(
      event.productId, event.locationId, event.variantId,
      event.forecast, null, event.correlationId
    );
  }
  
  async getHealthReport(productId = null, locationId = null, limit = 20) {
    const query = { orgCode: this.orgCode };
    if (productId) query.productId = new mongoose.Types.ObjectId(productId);
    if (locationId) query.locationId = locationId;
    
    return await InventoryHealth.find(query).sort({ priority: -1, healthScore: 1 }).limit(limit);
  }
}

/* -------------------------
   CONTEXT 3: OPTIMIZATION CONTEXT
-------------------------- */

class TransferDecision {
  constructor(sourceId, targetId, productId, variantId, quantity, transportCost) {
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.productId = productId;
    this.variantId = normalizeVariant(variantId);
    this.quantity = roundQty(quantity);
    this.transportCost = transportCost;
  }
  
  static fromHealthEvent(sourceHealth, targetHealth, quantity, transportCost) {
    return new TransferDecision(
      sourceHealth.locationId,
      targetHealth.locationId,
      targetHealth.productId,
      targetHealth.variantId,
      quantity,
      transportCost
    );
  }
}

class PurchaseDecision {
  constructor(productId, variantId, locationId, quantity, urgency, priority) {
    this.productId = productId;
    this.variantId = normalizeVariant(variantId);
    this.locationId = locationId;
    this.quantity = roundQty(quantity);
    this.urgency = urgency;
    this.priority = priority;
  }
  
  static fromHealthEvent(health) {
    const urgency = health.riskLevel === 'critical' ? 'emergency' :
                    health.riskLevel === 'high' ? 'expedited' : 'routine';
    return new PurchaseDecision(
      health.productId,
      health.variantId,
      health.locationId,
      roundQty(health.recommendedQuantity),
      urgency,
      health.priority
    );
  }
}

class OptimizationService {
  constructor(orgCode, inventoryPort, supplierPort, transferPort, poPort) {
    this.orgCode = orgCode;
    this.inventoryPort = inventoryPort;
    this.supplierPort = supplierPort;
    this.transferPort = transferPort;
    this.poPort = poPort;
    this.eventEmitter = null;
    this.options = {
      batchingWindowMinutes: 120,
      maxTransferCost: 10000,
      maxTransfersPerBatch: 10,
      maxPOsPerBatch: 5
    };
  }
  
  setEventEmitter(emitter) { this.eventEmitter = emitter; }
  setOptions(options) { this.options = { ...this.options, ...options }; }
  
  async onHealthUpdated(event) {
    // This is now primarily for events, but actual execution goes through queue
    console.log(`[Optimization] Health updated: ${event.recommendedAction}, priority: ${event.priority}`);
    // Queue processing happens separately via processDecisionQueue()
  }
  
  async logDecision(decisionId, correlationId, orgCode, decisionType, decision, outcome, additionalData = {}) {
    await DecisionLog.create({
      decisionId,
      correlationId,
      orgCode,
      decisionType,
      decision: {
        productId: decision.productId ? new mongoose.Types.ObjectId(decision.productId) : null,
        locationId: decision.locationId,
        quantity: decision.quantity,
        urgency: decision.urgency,
        reason: decision.reason,
        ...additionalData
      },
      outcome
    });
  }
  
  async createPurchaseOrderFromHealth(healthEvent) {
    const decisionId = uuidv4();
    const correlationId = healthEvent.correlationId || uuidv4();
    
    const healthLike = {
      productId: healthEvent.productId,
      variantId: healthEvent.variantId,
      locationId: healthEvent.locationId,
      recommendedQuantity: healthEvent.recommendedQuantity,
      riskLevel: healthEvent.riskLevel,
      priority: healthEvent.priority
    };
    
    const decision = PurchaseDecision.fromHealthEvent(healthLike);
    
    const bestOffer = await this.supplierPort.getBestOffer(
      decision.productId, decision.quantity, decision.locationId, decision.urgency
    );
    
    const today = new Date().toISOString().split('T')[0];
    const idempotencyKey = `${this.orgCode}:${decision.productId}:${decision.locationId}:${today}:v${healthEvent.basedOnForecastVersion || healthEvent.version}`;
    
    let po = null;
    let success = false;
    let error = null;
    
    try {
      if (!bestOffer) {
        console.log(`[Optimization] No best offer found, creating draft PO`);
        po = await this.poPort.createDraftPurchaseOrder(decision, this.orgCode, idempotencyKey);
      } else {
        po = await this.poPort.createPurchaseOrder(decision, bestOffer, this.orgCode, idempotencyKey);
      }
      success = true;
    } catch (err) {
      error = err.message;
      console.error(`[Optimization] PO creation failed: ${error}`);
    }
    
    await this.logDecision(decisionId, correlationId, this.orgCode, 'purchase_order', {
      productId: decision.productId,
      locationId: decision.locationId,
      quantity: decision.quantity,
      urgency: decision.urgency,
      reason: healthEvent.recommendedAction === 'reorder' ? 'stockout_risk' : 'auto_replenishment'
    }, {
      success,
      resultId: po?.poNumber,
      error
    });
    
    if (this.eventEmitter && po) {
      await this.eventEmitter.emit({
        type: 'purchase_order.created',
        eventId: uuidv4(),
        correlationId,
        orgCode: this.orgCode,
        poNumber: po.poNumber,
        productId: decision.productId,
        quantity: decision.quantity,
        supplierId: bestOffer?.supplierId,
        timestamp: new Date()
      });
    }
    
    return po;
  }
  
  async findAndCreateTransferFromHealth(targetHealthEvent) {
    const decisionId = uuidv4();
    const correlationId = targetHealthEvent.correlationId || uuidv4();
    
    const sourceHealth = await InventoryHealth.findOne({
      orgCode: this.orgCode,
      productId: new mongoose.Types.ObjectId(targetHealthEvent.productId),
      variantId: normalizeVariant(targetHealthEvent.variantId),
      recommendedAction: 'transfer_out',
      excessStock: { $gt: 0 }
    }).sort({ priority: -1 });
    
    if (!sourceHealth) return null;
    
    try {
      const distance = await this._calculateDistance(sourceHealth.locationId, targetHealthEvent.locationId);
      const transportCost = distance * 0.5;
      
      if (transportCost > this.options.maxTransferCost) return null;
      
      const quantity = Math.min(sourceHealth.excessStock, targetHealthEvent.recommendedQuantity);
      const decision = TransferDecision.fromHealthEvent(sourceHealth, targetHealthEvent, quantity, transportCost);
      
      const transfer = await this.transferPort.createTransfer(decision, 'auto_optimizer', this.orgCode);
      
      await this.logDecision(decisionId, correlationId, this.orgCode, 'transfer', {
        productId: decision.productId,
        quantity: decision.quantity,
        fromWarehouseId: decision.sourceId,
        toWarehouseId: decision.targetId,
        reason: 'excess_stock_transfer'
      }, {
        success: true,
        resultId: transfer.transferNumber
      }, {
        transportCost,
        distance
      });
      
      if (this.eventEmitter) {
        await this.eventEmitter.emit({
          type: 'transfer.created',
          eventId: uuidv4(),
          correlationId,
          orgCode: this.orgCode,
          transferNumber: transfer.transferNumber,
          productId: decision.productId,
          quantity: decision.quantity,
          fromWarehouseId: decision.sourceId,
          toWarehouseId: decision.targetId,
          timestamp: new Date()
        });
      }
      
      return transfer;
    } catch (error) {
      console.error(`[Optimization] Transfer failed: ${error.message}`);
      await this.logDecision(decisionId, correlationId, this.orgCode, 'transfer', {
        productId: targetHealthEvent.productId
      }, {
        success: false,
        error: error.message
      });
      return null;
    }
  }
  
  async batchOptimize() {
    const windowStart = new Date(Date.now() - this.options.batchingWindowMinutes * 60 * 1000);
    
    const [recentTransfers, recentPOs] = await Promise.all([
      this.transferPort.findRecentTransfers(this.orgCode, windowStart, 'auto_optimizer'),
      this.poPort.findRecentPOs(this.orgCode, windowStart, 'auto_optimizer')
    ]);
    
    const remainingTransferCapacity = this.options.maxTransfersPerBatch - recentTransfers.length;
    const remainingPOCapacity = this.options.maxPOsPerBatch - recentPOs.length;
    
    const [needsReorder, needsTransfer] = await Promise.all([
      InventoryHealth.find({
        orgCode: this.orgCode,
        recommendedAction: 'reorder',
        shortageQuantity: { $gt: 0 }
      }).sort({ priority: -1 }).limit(remainingPOCapacity),
      InventoryHealth.find({
        orgCode: this.orgCode,
        recommendedAction: 'transfer_in',
        riskLevel: { $in: ['critical', 'high'] }
      }).sort({ priority: -1 }).limit(remainingTransferCapacity)
    ]);
    
    const [transfers, purchaseOrders] = await Promise.all([
      Promise.all(needsTransfer.map(health => this.findAndCreateTransferFromHealth(health))),
      Promise.all(needsReorder.map(health => this.createPurchaseOrderFromHealth(health)))
    ]);
    
    const successfulTransfers = transfers.filter(t => t);
    const successfulPOs = purchaseOrders.filter(p => p);
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit({
        type: 'optimization.batch_completed',
        eventId: uuidv4(),
        correlationId: uuidv4(),
        orgCode: this.orgCode,
        transfersCreated: successfulTransfers.length,
        purchaseOrdersCreated: successfulPOs.length,
        timestamp: new Date()
      });
    }
    
    return { transfers: successfulTransfers, purchaseOrders: successfulPOs };
  }
  
  async _calculateDistance(fromWarehouseId, toWarehouseId) {
    const from = await this.inventoryPort.getWarehouse(fromWarehouseId);
    const to = await this.inventoryPort.getWarehouse(toWarehouseId);
    
    if (!from || !to) throw new Error(`Warehouse location missing: from=${fromWarehouseId}, to=${toWarehouseId}`);
    if (!from.location?.coordinates || !to.location?.coordinates)
      throw new Error(`Warehouse coordinates missing for from=${fromWarehouseId} or to=${toWarehouseId}`);
    
    const lat1 = from.location.coordinates[1], lon1 = from.location.coordinates[0];
    const lat2 = to.location.coordinates[1], lon2 = to.location.coordinates[0];
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}

/* -------------------------
   EVENT BUS (with Atomic Deduplication + In-Memory Guard)
-------------------------- */
class EventBus {
  constructor() {
    this.listeners = new Map();
    // FIX #4: In-memory fallback guard for burst duplication
    this._recentEvents = new Set();
    
    // Clean up old events from memory every minute
    setInterval(() => {
      this._recentEvents.clear();
    }, 60000);
  }
  
  on(eventType, handler, contextId) {
    const key = `${eventType}:${contextId}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }
  
  async emit(event) {
    if (!event?.type) {
      console.error('[EventBus] Invalid event - missing type property');
      return false;
    }
    
    // FIX #4: In-memory duplicate check before DB hit
    if (this._recentEvents.has(event.eventId)) {
      console.log(`[EventBus] In-memory duplicate event ${event.eventId} ignored`);
      return false;
    }
    this._recentEvents.add(event.eventId);
    
    try {
      await ProcessedEvent.create({
        eventId: event.eventId,
        eventType: event.type,
        orgCode: event.orgCode,
        entityId: event.productId ? `${event.productId}:${event.locationId}` : null,
        correlationId: event.correlationId
      });
    } catch (error) {
      if (error.code === 11000) {
        console.log(`[EventBus] Duplicate event ${event.eventId} ignored`);
        return false;
      }
      console.error(`[EventBus] Error recording event:`, error);
      return false;
    }
    
    const matchingKeys = Array.from(this.listeners.keys()).filter(k => k.startsWith(`${event.type}:`));
    
    const handlers = [];
    for (const key of matchingKeys) {
      for (const handler of this.listeners.get(key) || []) {
        handlers.push(handler(event));
      }
    }
    
    const results = await Promise.allSettled(handlers);
    const failures = results.filter(r => r.status === 'rejected');
    
    if (failures.length > 0) {
      console.error(`[EventBus] ${failures.length} handler(s) failed for event ${event.type}`);
      return false;
    }
    
    return true;
  }
}

/* -------------------------
   ADAPTERS (Optimized)
-------------------------- */
class MongoInventoryAdapter {
  async getStock(productId, locationId, variantId = null) {
    const StockState = mongoose.model('StockState');
    return StockState.findOne({
      productId: new mongoose.Types.ObjectId(productId),
      variantId: normalizeVariant(variantId),
      locationId
    });
  }
  
  async getAllStockByOrg(orgCode) {
    const StockState = mongoose.model('StockState');
    return StockState.find({ orgCode });
  }
  
  async getWarehouse(warehouseId) {
    const Warehouse = mongoose.model('Warehouse');
    if (mongoose.Types.ObjectId.isValid(warehouseId)) {
      const warehouse = await Warehouse.findById(warehouseId);
      if (warehouse) return warehouse;
    }
    return await Warehouse.findOne({ locationId: warehouseId });
  }
}

class MongoSupplierAdapter {
  constructor(orgCode) { this.orgCode = orgCode; }
  
  async getBestOffer(productId, quantity, destinationLocationId, urgency) {
    const SupplyOffer = mongoose.model('SupplyOffer');
    const Warehouse = mongoose.model('Warehouse');
    const SupplierLocation = mongoose.model('SupplierLocation');
    
    let warehouse = null;
    if (mongoose.Types.ObjectId.isValid(destinationLocationId)) {
      warehouse = await Warehouse.findById(destinationLocationId);
    } else {
      warehouse = await Warehouse.findOne({ orgCode: this.orgCode, locationId: destinationLocationId });
    }
    
    if (!warehouse) return null;
    
    // FIX #5: Limit supplier locations to prevent overload
    const supplierLocations = await SupplierLocation.find({
      orgCode: this.orgCode,
      isActive: true,
      country: warehouse.country || { $exists: true }
    }).limit(5);
    
    if (supplierLocations.length === 0) return null;
    
    // Limit concurrent processing to 5 at a time to prevent DB spike
    const LIMIT = 5;
    const offers = [];
    
    for (const supplierLocation of supplierLocations.slice(0, LIMIT)) {
      try {
        const rankedOffers = await SupplyOffer.getRankedOffers(productId, {
          quantity,
          destinationLocationId: supplierLocation._id,
          urgency,
          currency: 'USD',
          asOfDate: new Date(),
          riskTolerance: 'medium'
        }, null, null);
        
        if (rankedOffers?.length > 0) {
          const best = rankedOffers[0];
          offers.push({
            supplierId: best.supplyOffer.supplierId,
            supplyOfferId: best.supplyOffer._id,
            costPerUnit: best.costPerUnit,
            leadTimeDays: best.effectiveLeadTime,
            supplierLocationId: supplierLocation._id,
            score: best.costPerUnit
          });
        }
      } catch (error) {
        console.error(`[SupplierAdapter] Error checking location ${supplierLocation.name}:`, error.message);
      }
    }
    
    if (offers.length === 0) return null;
    
    return offers.reduce((best, current) =>
      (current.costPerUnit < best.costPerUnit) ? current : best
    );
  }
}

class MongoTransferAdapter {
  async createTransfer(decision, createdBy, orgCode) {
    const Transfer = mongoose.model('Transfer');
    const transferNumber = `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const transfer = new Transfer({
      transferNumber,
      orgCode,
      fromWarehouseId: decision.sourceId,
      toWarehouseId: decision.targetId,
      status: 'pending',
      items: [{
        productId: new mongoose.Types.ObjectId(decision.productId),
        variantId: normalizeVariant(decision.variantId),
        quantity: decision.quantity,
        batchNumber: null,
        expiryDate: null
      }],
      createdBy,
      source: 'auto_optimizer'
    });
    await transfer.save();
    return transfer;
  }
  
  async findRecentTransfers(orgCode, windowStart, source) {
    const Transfer = mongoose.model('Transfer');
    return Transfer.find({
      orgCode,
      createdAt: { $gte: windowStart },
      createdBy: source
    });
  }
}

class MongoPurchaseOrderAdapter {
  async createPurchaseOrder(decision, bestOffer, orgCode, idempotencyKey = null) {
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    if (idempotencyKey) {
      const existing = await PurchaseOrder.findOne({
        orgCode,
        'metadata.idempotencyKey': idempotencyKey
      });
      if (existing) return existing;
    }
    
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const po = new PurchaseOrder({
      poNumber,
      orgCode,
      supplierId: new mongoose.Types.ObjectId(bestOffer.supplierId),
      supplyOfferId: new mongoose.Types.ObjectId(bestOffer.supplyOfferId),
      destinationWarehouseId: decision.locationId,
      status: 'draft',
      items: [{
        productId: new mongoose.Types.ObjectId(decision.productId),
        variantId: normalizeVariant(decision.variantId),
        quantity: decision.quantity,
        unitPrice: bestOffer.costPerUnit,
        currency: 'USD'
      }],
      subtotal: bestOffer.costPerUnit * decision.quantity,
      totalAmount: bestOffer.costPerUnit * decision.quantity,
      createdBy: 'auto_optimizer',
      source: 'auto_replenishment',
      metadata: idempotencyKey ? { idempotencyKey } : {}
    });
    await po.save();
    return po;
  }
  
  async createDraftPurchaseOrder(decision, orgCode, idempotencyKey = null) {
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    if (idempotencyKey) {
      const existing = await PurchaseOrder.findOne({
        orgCode,
        'metadata.idempotencyKey': idempotencyKey
      });
      if (existing) return existing;
    }
    
    const poNumber = `PO-DRAFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const po = new PurchaseOrder({
      poNumber,
      orgCode,
      destinationWarehouseId: decision.locationId,
      status: 'draft',
      items: [{
        productId: new mongoose.Types.ObjectId(decision.productId),
        variantId: normalizeVariant(decision.variantId),
        quantity: decision.quantity,
        unitPrice: 0,
        currency: 'USD'
      }],
      subtotal: 0,
      totalAmount: 0,
      createdBy: 'auto_optimizer',
      source: 'auto_replenishment',
      notes: 'Draft PO - automatic supplier selection unavailable',
      metadata: idempotencyKey ? { idempotencyKey } : {}
    });
    await po.save();
    return po;
  }
  
  async findRecentPOs(orgCode, windowStart, source) {
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    return PurchaseOrder.find({
      orgCode,
      createdAt: { $gte: windowStart },
      createdBy: source
    });
  }
}

/* -------------------------
   ORCHESTRATOR
-------------------------- */
class OptimizationOrchestrator {
  constructor(orgCode, orgSettingsService = null) {
    this.orgCode = orgCode;
    this.eventBus = new EventBus();
    
    const inventoryAdapter = new MongoInventoryAdapter();
    const supplierAdapter = new MongoSupplierAdapter(orgCode);
    const transferAdapter = new MongoTransferAdapter();
    const poAdapter = new MongoPurchaseOrderAdapter();
    
    this.forecasting = new ForecastingService(orgCode, inventoryAdapter, orgSettingsService);
    this.health = new HealthService(orgCode, inventoryAdapter, orgSettingsService);
    this.optimization = new OptimizationService(orgCode, inventoryAdapter, supplierAdapter, transferAdapter, poAdapter);
    
    this.forecasting.setEventEmitter(this.eventBus);
    this.health.setEventEmitter(this.eventBus);
    this.optimization.setEventEmitter(this.eventBus);
    
    this.eventBus.on('forecast.updated', (e) => this.health.onForecastUpdated(e), 'health');
    this.eventBus.on('health.updated', (e) => this.optimization.onHealthUpdated(e), 'optimization');
  }
  
  async refreshAll(productId, locationId, variantId = null, correlationId = null) {
    const forecast = await this.forecasting.calculateAndPersist(productId, locationId, variantId, correlationId);
    if (!forecast) return { forecast: null, health: null };
    const health = await this.health.calculateAndPersistWithForecast(
      productId, locationId, variantId, forecast, null, correlationId
    );
    return { forecast, health };
  }
  
  async batchOptimize() { return this.optimization.batchOptimize(); }
  
  async processDecisionQueue(batchSize = 10) {
    return processDecisionQueue(this.optimization, batchSize);
  }
  
  async getHealthReport(productId = null, locationId = null, limit = 20) {
    return this.health.getHealthReport(productId, locationId, limit);
  }
  
  async getForecast(productId, locationId, variantId = null) {
    return DemandForecast.findOne({
      orgCode: this.orgCode,
      productId: new mongoose.Types.ObjectId(productId),
      variantId: normalizeVariant(variantId),
      locationId
    });
  }
}

/* -------------------------
   EXPORTS
-------------------------- */
module.exports = {
  DemandForecast,
  InventoryHealth,
  OptimizationOrchestrator,
  MongoInventoryAdapter,
  MongoSupplierAdapter,
  MongoTransferAdapter,
  MongoPurchaseOrderAdapter,
  ForecastingService,
  HealthService,
  OptimizationService,
  EventBus,
  roundQty,
  normalizeVariant,
  isDormant,
  ProcessedEvent,
  DecisionLock,
  DecisionQueue,
  DecisionLog,
  acquireLock,
  releaseLock,
  enqueueDecision,
  processDecisionQueue,
  calculateStockoutProbability,
  calculateEMA,
  clamp,
  clampSeasonality
};