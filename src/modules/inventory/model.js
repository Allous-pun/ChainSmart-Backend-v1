const mongoose = require('mongoose');

// ========== FIRST: Import ALL dependent models to ensure they're registered ==========

require('../products/model');           // Product model
require('../supplier/model');           // Supplier, SupplyOffer models
require('./transactionModel');          // InventoryTransaction model
require('./stockModel');                // StockState model
require('./warehouseModel');            // Warehouse model
require('./transferModel');             // Transfer model
require('./purchaseOrderModel');        // PurchaseOrder model

/* -------------------------
   SUPPLY CHAIN OPTIMIZER LAYER
   Bounded Contexts + Event-Driven Communication
   No shared domain models across contexts
-------------------------- */

/* -------------------------
   SCHEMAS (Dumb data layer only - each context owns its schema)
-------------------------- */

// ========== FORECAST CONTEXT ==========
const DemandForecastSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true }, // branchId string
  
  dailyAvgDemand: { type: Number, default: 0 },
  weeklyAvgDemand: { type: Number, default: 0 },
  monthlyAvgDemand: { type: Number, default: 0 },
  
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

DemandForecastSchema.index({ orgCode: 1, productId: 1, locationId: 1 }, { unique: true });
DemandForecastSchema.index({ stockoutProbability: -1 });

// ========== HEALTH CONTEXT ==========
const InventoryHealthSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true }, // branchId string
  
  daysOfCover: { type: Number, default: 0 },
  riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
  excessStock: { type: Number, default: 0 },
  shortageQuantity: { type: Number, default: 0 },
  
  healthScore: { type: Number, default: 100 },
  criticalityScore: { type: Number, default: 0 },
  
  recommendedAction: { 
    type: String, 
    enum: ['reorder', 'transfer_in', 'transfer_out', 'reduce', 'do_nothing'],
    default: 'do_nothing'
  },
  recommendedQuantity: { type: Number, default: 0 },
  priority: { type: Number, default: 0 },
  
  lastEvaluatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

InventoryHealthSchema.index({ orgCode: 1, productId: 1, locationId: 1 }, { unique: true });
InventoryHealthSchema.index({ riskLevel: 1, priority: -1 });
InventoryHealthSchema.index({ healthScore: 1 });

// Register models immediately
const DemandForecast = mongoose.model('DemandForecast', DemandForecastSchema);
const InventoryHealth = mongoose.model('InventoryHealth', InventoryHealthSchema);

/* -------------------------
   CONTEXT 1: FORECASTING CONTEXT
-------------------------- */

class DemandForecastModel {
  constructor(data) {
    this.productId = data.productId;
    this.variantId = data.variantId;
    this.locationId = data.locationId;
    this.orgCode = data.orgCode;
    this.dailyAvg = data.dailyAvg;
    this.weeklyAvg = data.weeklyAvg;
    this.monthlyAvg = data.monthlyAvg;
    this.seasonality = data.seasonality;
    this.velocity = data.velocity;
    this.stockoutProbability = data.stockoutProbability;
    this.calculatedAt = data.calculatedAt;
  }
  
  static fromAggregation(salesByDay, totalSales, stock) {
    const dailyAvg = Math.max(0.001, totalSales / 30);
    const seasonality = {};
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 1; i <= 7; i++) {
      seasonality[dayNames[i - 1]] = salesByDay[i] / dailyAvg || 1;
    }
    
    const daysOfCover = stock?.availableStock / dailyAvg || 0;
    const stockoutProbability = daysOfCover < 2 ? 0.9 : daysOfCover < 5 ? 0.5 : daysOfCover < 10 ? 0.2 : 0;
    
    return new DemandForecastModel({
      productId: null,
      variantId: null,
      locationId: null,
      orgCode: null,
      dailyAvg,
      weeklyAvg: dailyAvg * 7,
      monthlyAvg: dailyAvg * 30,
      seasonality,
      velocity: dailyAvg,
      stockoutProbability,
      calculatedAt: new Date()
    });
  }
  
  toDocument() {
    return {
      orgCode: this.orgCode,
      productId: this.productId,
      variantId: this.variantId,
      locationId: this.locationId,
      dailyAvgDemand: this.dailyAvg,
      weeklyAvgDemand: this.weeklyAvg,
      monthlyAvgDemand: this.monthlyAvg,
      seasonalityFactors: this.seasonality,
      salesVelocity: this.velocity,
      stockoutProbability: this.stockoutProbability,
      lastCalculatedAt: this.calculatedAt,
      calculationWindow: 30
    };
  }
}

class ForecastingService {
  constructor(orgCode, inventoryPort) {
    this.orgCode = orgCode;
    this.inventoryPort = inventoryPort;
    this.eventEmitter = null;
  }
  
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }
  
  async calculateAndPersist(productId, locationId, variantId = null) {
    const Transaction = mongoose.model('InventoryTransaction');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sales = await Transaction.aggregate([
      {
        $match: {
          orgCode: this.orgCode,
          productId: new mongoose.Types.ObjectId(productId),
          locationId: locationId,
          variantId: variantId ? new mongoose.Types.ObjectId(variantId) : null,
          type: 'OUT_SALE',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          totalSales: { $sum: "$quantity" }
        }
      }
    ]);
    
    const salesByDay = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const sale of sales) {
      salesByDay[sale._id] = Math.abs(sale.totalSales);
    }
    
    const totalSales = Object.values(salesByDay).reduce((sum, v) => sum + v, 0);
    const stock = await this.inventoryPort.getStock(productId, locationId, variantId);
    
    const forecastModel = DemandForecastModel.fromAggregation(salesByDay, totalSales, stock);
    forecastModel.productId = productId;
    forecastModel.variantId = variantId;
    forecastModel.locationId = locationId;
    forecastModel.orgCode = this.orgCode;
    
    const forecastDoc = forecastModel.toDocument();
    
    const persisted = await DemandForecast.findOneAndUpdate(
      { orgCode: this.orgCode, productId, variantId: variantId || null, locationId },
      forecastDoc,
      { upsert: true, returnDocument: 'after' }
    );
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit('forecast.updated', {
        type: 'FORECAST_UPDATED',
        orgCode: this.orgCode,
        productId: productId.toString(),
        variantId: variantId?.toString(),
        locationId: locationId.toString(),
        forecast: {
          dailyAvgDemand: persisted.dailyAvgDemand,
          weeklyAvgDemand: persisted.weeklyAvgDemand,
          monthlyAvgDemand: persisted.monthlyAvgDemand,
          seasonalityFactors: persisted.seasonalityFactors,
          salesVelocity: persisted.salesVelocity,
          stockoutProbability: persisted.stockoutProbability,
          lastCalculatedAt: persisted.lastCalculatedAt
        },
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
    this.variantId = data.variantId;
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
  
  static fromStockAndForecast(stock, forecast) {
    const dailyAvgDemand = Math.max(0.001, forecast.dailyAvgDemand);
    const daysOfCover = stock.availableStock / dailyAvgDemand;
    const excessStock = Math.max(0, stock.physicalStock - (stock.maxStockLevel || Infinity));
    const shortageQuantity = Math.max(0, (stock.reorderPoint || 0) - stock.availableStock);
    
    let riskLevel = 'low';
    let healthScore = 100;
    
    if (daysOfCover < 1) {
      riskLevel = 'critical';
      healthScore = 10;
    } else if (daysOfCover < 3) {
      riskLevel = 'high';
      healthScore = 30;
    } else if (daysOfCover < 7) {
      riskLevel = 'medium';
      healthScore = 60;
    }
    
    if (excessStock > 0) {
      healthScore -= Math.min(30, (excessStock / stock.physicalStock) * 50);
    }
    
    let recommendedAction = 'do_nothing';
    let recommendedQuantity = 0;
    let priority = 0;
    
    if (shortageQuantity > 0) {
      const daysUntilStockout = stock.availableStock / dailyAvgDemand;
      
      if (daysUntilStockout < 1) {
        priority = 10;
      } else if (daysUntilStockout < 3) {
        priority = 8;
      } else if (daysUntilStockout < 5) {
        priority = 6;
      } else if (daysUntilStockout < 7) {
        priority = 4;
      } else {
        priority = 2;
      }
      
      recommendedAction = 'reorder';
      recommendedQuantity = shortageQuantity + (dailyAvgDemand * 7);
    } else if (excessStock > 0) {
      recommendedAction = 'transfer_out';
      recommendedQuantity = excessStock;
      priority = Math.min(5, Math.floor(excessStock / dailyAvgDemand));
    }
    
    return new InventoryHealthModel({
      orgCode: stock.orgCode,
      productId: stock.productId,
      variantId: stock.variantId,
      locationId: stock.locationId,
      daysOfCover,
      excessStock,
      shortageQuantity,
      healthScore: Math.max(0, Math.min(100, healthScore)),
      riskLevel,
      priority,
      recommendedAction,
      recommendedQuantity
    });
  }
  
  toDocument() {
    return {
      orgCode: this.orgCode,
      productId: this.productId,
      variantId: this.variantId,
      locationId: this.locationId,
      daysOfCover: this.daysOfCover,
      riskLevel: this.riskLevel,
      excessStock: this.excessStock,
      shortageQuantity: this.shortageQuantity,
      healthScore: this.healthScore,
      criticalityScore: (1 - Math.min(1, this.daysOfCover / 30)) * 100,
      recommendedAction: this.recommendedAction,
      recommendedQuantity: this.recommendedQuantity,
      priority: this.priority,
      lastEvaluatedAt: new Date()
    };
  }
  
  toDTO() {
    return {
      productId: this.productId,
      variantId: this.variantId,
      locationId: this.locationId,
      daysOfCover: this.daysOfCover,
      excessStock: this.excessStock,
      shortageQuantity: this.shortageQuantity,
      healthScore: this.healthScore,
      riskLevel: this.riskLevel,
      priority: this.priority,
      recommendedAction: this.recommendedAction,
      recommendedQuantity: this.recommendedQuantity
    };
  }
}

class HealthService {
  constructor(orgCode, inventoryPort) {
    this.orgCode = orgCode;
    this.inventoryPort = inventoryPort;
    this.eventEmitter = null;
  }
  
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }
  
  async calculateAndPersistWithForecast(productId, locationId, variantId, forecastDoc) {
    const stock = await this.inventoryPort.getStock(productId, locationId, variantId);
    if (!stock) return null;
    
    const healthModel = InventoryHealthModel.fromStockAndForecast(stock, forecastDoc);
    const healthDoc = healthModel.toDocument();
    
    const persisted = await InventoryHealth.findOneAndUpdate(
      { orgCode: this.orgCode, productId, variantId: variantId || null, locationId },
      healthDoc,
      { upsert: true, returnDocument: 'after' }
    );
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit('health.updated', {
        type: 'HEALTH_UPDATED',
        orgCode: this.orgCode,
        productId: productId.toString(),
        variantId: variantId?.toString(),
        locationId: locationId.toString(),
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
  
  async calculateAndPersist(productId, locationId, variantId = null) {
    const stock = await this.inventoryPort.getStock(productId, locationId, variantId);
    if (!stock) return null;
    
    const forecast = await DemandForecast.findOne({
      orgCode: this.orgCode,
      productId,
      variantId: variantId || null,
      locationId
    });
    
    if (!forecast) return null;
    
    return this.calculateAndPersistWithForecast(productId, locationId, variantId, forecast);
  }
  
  async onForecastUpdated(event) {
    return this.calculateAndPersistWithForecast(
      event.productId,
      event.locationId,
      event.variantId,
      event.forecast
    );
  }
  
  async getHealthReport(productId = null, locationId = null, limit = 20) {
    const query = { orgCode: this.orgCode };
    if (productId) query.productId = productId;
    if (locationId) query.locationId = locationId;
    
    const recommendations = await InventoryHealth.find(query)
      .sort({ priority: -1, healthScore: 1 })
      .limit(limit);
    
    return recommendations;
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
    this.variantId = variantId;
    this.quantity = quantity;
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
    this.variantId = variantId;
    this.locationId = locationId;
    this.quantity = quantity;
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
      health.recommendedQuantity,
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
  
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }
  
  setOptions(options) {
    this.options = { ...this.options, ...options };
  }
  
  async onHealthUpdated(event) {
    console.log(`[Optimization] Health updated: ${event.recommendedAction}, priority: ${event.priority}`);
    if (event.recommendedAction === 'reorder' && event.priority >= 7) {
      await this.createPurchaseOrderFromHealth(event);
    } else if (event.recommendedAction === 'transfer_in' && event.priority >= 7) {
      await this.findAndCreateTransferFromHealth(event);
    }
  }
  
  async createPurchaseOrderFromHealth(healthEvent) {
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
      decision.productId,
      decision.quantity,
      decision.locationId,
      decision.urgency
    );
    
    if (!bestOffer) {
      console.log(`[Optimization] No best offer found for product ${decision.productId}, creating draft PO`);
      const draftPo = await this.poPort.createDraftPurchaseOrder(decision, this.orgCode);
      return draftPo;
    }
    
    const po = await this.poPort.createPurchaseOrder(decision, bestOffer, this.orgCode);
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit('purchase_order.created', {
        type: 'PURCHASE_ORDER_CREATED',
        orgCode: this.orgCode,
        poNumber: po.poNumber,
        productId: decision.productId,
        quantity: decision.quantity,
        supplierId: bestOffer.supplierId
      });
    }
    
    console.log(`[Optimization] Created PO ${po.poNumber} for ${decision.quantity} units`);
    return po;
  }
  
  async findAndCreateTransferFromHealth(targetHealthEvent) {
    const sourceHealth = await InventoryHealth.findOne({
      orgCode: this.orgCode,
      productId: targetHealthEvent.productId,
      variantId: targetHealthEvent.variantId,
      recommendedAction: 'transfer_out',
      excessStock: { $gt: 0 }
    }).sort({ priority: -1 });
    
    if (!sourceHealth) return null;
    
    const distance = await this._calculateDistance(sourceHealth.locationId, targetHealthEvent.locationId);
    const transportCost = distance * 0.5;
    
    if (transportCost > this.options.maxTransferCost) return null;
    
    const quantity = Math.min(sourceHealth.excessStock, targetHealthEvent.recommendedQuantity);
    const decision = TransferDecision.fromHealthEvent(sourceHealth, targetHealthEvent, quantity, transportCost);
    
    const transfer = await this.transferPort.createTransfer(decision, 'auto_optimizer', this.orgCode);
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit('transfer.created', {
        type: 'TRANSFER_CREATED',
        orgCode: this.orgCode,
        transferNumber: transfer.transferNumber,
        productId: decision.productId,
        quantity: decision.quantity,
        fromWarehouseId: decision.sourceId,
        toWarehouseId: decision.targetId
      });
    }
    
    return transfer;
  }
  
  async batchOptimize() {
    const windowStart = new Date(Date.now() - this.options.batchingWindowMinutes * 60 * 1000);
    
    const recentTransfers = await this.transferPort.findRecentTransfers(this.orgCode, windowStart, 'auto_optimizer');
    const recentPOs = await this.poPort.findRecentPOs(this.orgCode, windowStart, 'auto_optimizer');
    
    const remainingTransferCapacity = this.options.maxTransfersPerBatch - recentTransfers.length;
    const remainingPOCapacity = this.options.maxPOsPerBatch - recentPOs.length;
    
    const needsReorder = await InventoryHealth.find({
      orgCode: this.orgCode,
      recommendedAction: 'reorder',
      shortageQuantity: { $gt: 0 }
    }).sort({ priority: -1 }).limit(remainingPOCapacity);
    
    const needsTransfer = await InventoryHealth.find({
      orgCode: this.orgCode,
      recommendedAction: 'transfer_in',
      riskLevel: { $in: ['critical', 'high'] }
    }).sort({ priority: -1 }).limit(remainingTransferCapacity);
    
    const transfers = [];
    for (const health of needsTransfer) {
      const transfer = await this.findAndCreateTransferFromHealth(health);
      if (transfer) transfers.push(transfer);
    }
    
    const purchaseOrders = [];
    for (const health of needsReorder) {
      const po = await this.createPurchaseOrderFromHealth(health);
      if (po) purchaseOrders.push(po);
    }
    
    if (this.eventEmitter) {
      await this.eventEmitter.emit('optimization.batch_completed', {
        type: 'OPTIMIZATION_BATCH_COMPLETED',
        orgCode: this.orgCode,
        transfersCreated: transfers.length,
        purchaseOrdersCreated: purchaseOrders.length,
        timestamp: new Date()
      });
    }
    
    return { transfers, purchaseOrders };
  }
  
  async _calculateDistance(fromWarehouseId, toWarehouseId) {
    const from = await this.inventoryPort.getWarehouse(fromWarehouseId);
    const to = await this.inventoryPort.getWarehouse(toWarehouseId);
    
    if (!from || !to || !from.location || !to.location) return 1000;
    
    const lat1 = from.location.coordinates[1];
    const lon1 = from.location.coordinates[0];
    const lat2 = to.location.coordinates[1];
    const lon2 = to.location.coordinates[0];
    
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
   EVENT BUS
-------------------------- */
class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  
  on(eventType, handler, contextId) {
    const key = `${eventType}:${contextId}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(handler);
  }
  
  async emit(event) {
    const matchingKeys = Array.from(this.listeners.keys()).filter(k => k.startsWith(`${event.type}:`));
    
    for (const key of matchingKeys) {
      const handlers = this.listeners.get(key) || [];
      for (const handler of handlers) {
        await handler(event);
      }
    }
  }
}

/* -------------------------
   ADAPTERS - FIXED: Use locationId instead of branchId
-------------------------- */
class MongoInventoryAdapter {
  async getStock(productId, locationId, variantId = null) {
    const StockState = mongoose.model('StockState');
    return StockState.findOne({
      productId,
      variantId: variantId || null,
      locationId
    });
  }
  
  async getAllStockByOrg(orgCode) {
    const StockState = mongoose.model('StockState');
    return StockState.find({ orgCode });
  }
  
  async getTransactions(productId, locationId, variantId = null, days = 30) {
    const Transaction = mongoose.model('InventoryTransaction');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return Transaction.find({
      productId,
      variantId: variantId || null,
      locationId,
      createdAt: { $gte: startDate }
    });
  }
  
  async getWarehouse(warehouseId) {
    const Warehouse = mongoose.model('Warehouse');
    
    // Try by ObjectId first
    if (mongoose.Types.ObjectId.isValid(warehouseId)) {
      const warehouse = await Warehouse.findById(warehouseId);
      if (warehouse) return warehouse;
    }
    
    // Then try by locationId (this matches your warehouse schema)
    const warehouse = await Warehouse.findOne({ locationId: warehouseId });
    return warehouse;
  }
}

class MongoSupplierAdapter {
  constructor(orgCode) {
    this.orgCode = orgCode;
  }
  
  async getBestOffer(productId, quantity, destinationLocationId, urgency) {
    const SupplyOffer = mongoose.model('SupplyOffer');
    const Warehouse = mongoose.model('Warehouse');
    const SupplierLocation = mongoose.model('SupplierLocation');
    
    // Step 1: Find the warehouse
    let warehouse = null;
    
    if (mongoose.Types.ObjectId.isValid(destinationLocationId)) {
      warehouse = await Warehouse.findById(destinationLocationId);
    } else {
      warehouse = await Warehouse.findOne({ 
        orgCode: this.orgCode,
        locationId: destinationLocationId 
      });
    }
    
    if (!warehouse) {
      console.log(`[SupplierAdapter] No warehouse found for: ${destinationLocationId}`);
      return null;
    }
    
    console.log(`[SupplierAdapter] Found warehouse: ${warehouse.name} (${warehouse._id})`);
    
    // Step 2: Find supplier locations that can deliver to this warehouse
    // For now, get all active supplier locations for this org
    // In production, you'd filter by region/country or use geospatial queries
    const supplierLocations = await SupplierLocation.find({
      orgCode: this.orgCode,
      isActive: true
    }).limit(5);
    
    if (supplierLocations.length === 0) {
      console.log(`[SupplierAdapter] No supplier locations found for org: ${this.orgCode}`);
      return null;
    }
    
    console.log(`[SupplierAdapter] Found ${supplierLocations.length} supplier locations`);
    
    // Step 3: Try each supplier location to find best offer
    let bestOffer = null;
    let bestRankedOffer = null;
    
    for (const supplierLocation of supplierLocations) {
      try {
        console.log(`[SupplierAdapter] Trying supplier location: ${supplierLocation.name} (${supplierLocation._id})`);
        
        const rankedOffers = await SupplyOffer.getRankedOffers(productId, {
          quantity,
          destinationLocationId: supplierLocation._id,
          urgency: urgency,
          currency: 'USD',
          asOfDate: new Date(),
          riskTolerance: 'medium'
        }, null, null);
        
        if (rankedOffers && rankedOffers.length > 0) {
          const bestFromThisLocation = rankedOffers[0];
          
          // Keep the best overall offer
          if (!bestRankedOffer || bestFromThisLocation.costPerUnit < bestRankedOffer.costPerUnit) {
            bestRankedOffer = bestFromThisLocation;
            bestOffer = {
              supplierId: bestFromThisLocation.supplyOffer.supplierId,
              supplyOfferId: bestFromThisLocation.supplyOffer._id,
              costPerUnit: bestFromThisLocation.costPerUnit,
              leadTimeDays: bestFromThisLocation.effectiveLeadTime,
              supplierLocationId: supplierLocation._id
            };
            console.log(`[SupplierAdapter] New best offer: ${bestOffer.costPerUnit} from location ${supplierLocation.name}`);
          }
        }
      } catch (error) {
        console.error(`[SupplierAdapter] Error checking location ${supplierLocation.name}:`, error.message);
        // Continue to next location
      }
    }
    
    if (!bestOffer) {
      console.log(`[SupplierAdapter] No offers found for product ${productId} from any supplier location`);
      return null;
    }
    
    console.log(`[SupplierAdapter] Best overall offer: supplier ${bestOffer.supplierId}, cost ${bestOffer.costPerUnit}`);
    return bestOffer;
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
        productId: decision.productId,
        variantId: decision.variantId,
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
  async createPurchaseOrder(decision, bestOffer, orgCode) {
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const po = new PurchaseOrder({
      poNumber,
      orgCode,
      supplierId: bestOffer.supplierId,
      supplyOfferId: bestOffer.supplyOfferId,
      destinationWarehouseId: decision.locationId,
      status: 'draft',
      items: [{
        productId: decision.productId,
        variantId: decision.variantId,
        quantity: decision.quantity,
        unitPrice: bestOffer.costPerUnit,
        currency: 'USD'
      }],
      subtotal: bestOffer.costPerUnit * decision.quantity,
      totalAmount: bestOffer.costPerUnit * decision.quantity,
      createdBy: 'auto_optimizer',
      source: 'auto_replenishment'
    });
    
    await po.save();
    return po;
  }
  
  async createDraftPurchaseOrder(decision, orgCode) {
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    const poNumber = `PO-DRAFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const po = new PurchaseOrder({
      poNumber,
      orgCode,
      destinationWarehouseId: decision.locationId,
      status: 'draft',
      items: [{
        productId: decision.productId,
        variantId: decision.variantId,
        quantity: decision.quantity,
        unitPrice: 0,
        currency: 'USD'
      }],
      subtotal: 0,
      totalAmount: 0,
      createdBy: 'auto_optimizer',
      source: 'auto_replenishment',
      notes: 'Draft PO created - automatic supplier selection unavailable'
    });
    
    await po.save();
    console.log(`[Optimization] Created draft PO ${poNumber} for ${decision.quantity} units of product ${decision.productId}`);
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
  constructor(orgCode) {
    this.orgCode = orgCode;
    this.eventBus = new EventBus();
    
    const inventoryAdapter = new MongoInventoryAdapter();
    const supplierAdapter = new MongoSupplierAdapter(orgCode);
    const transferAdapter = new MongoTransferAdapter();
    const poAdapter = new MongoPurchaseOrderAdapter();
    
    this.forecasting = new ForecastingService(orgCode, inventoryAdapter);
    this.health = new HealthService(orgCode, inventoryAdapter);
    this.optimization = new OptimizationService(
      orgCode, inventoryAdapter, supplierAdapter, transferAdapter, poAdapter
    );
    
    this.forecasting.setEventEmitter(this.eventBus);
    this.health.setEventEmitter(this.eventBus);
    this.optimization.setEventEmitter(this.eventBus);
    
    this.eventBus.on('forecast.updated', (event) => this.health.onForecastUpdated(event), 'health');
    this.eventBus.on('health.updated', (event) => this.optimization.onHealthUpdated(event), 'optimization');
  }
  
  async refreshAll(productId, locationId, variantId = null) {
    const forecast = await this.forecasting.calculateAndPersist(productId, locationId, variantId);
    const health = await this.health.calculateAndPersistWithForecast(
      productId, 
      locationId, 
      variantId, 
      forecast
    );
    return { forecast, health };
  }
  
  async batchOptimize() {
    return this.optimization.batchOptimize();
  }
  
  async getHealthReport(productId = null, locationId = null, limit = 20) {
    return this.health.getHealthReport(productId, locationId, limit);
  }
  
  async getForecast(productId, locationId, variantId = null) {
    return DemandForecast.findOne({
      orgCode: this.orgCode,
      productId,
      variantId: variantId || null,
      locationId
    });
  }
  
  async refreshAllForOrg(productIds, locationIds) {
    const results = [];
    for (const productId of productIds) {
      for (const locationId of locationIds) {
        const result = await this.refreshAll(productId, locationId, null);
        results.push(result);
      }
    }
    return results;
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
  EventBus
};