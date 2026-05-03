const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// ========== FIRST: Import dependent models from their actual locations ==========
// Fix: These models exist in the inventory module, not in logistics folder
require('../inventory/warehouseModel');        // Warehouse model
require('../inventory/transferModel');         // Transfer model
require('../supplier/model');                  // Supplier models

/* -------------------------
   LOGISTICS MODEL - Movement Planning & Execution
   OWNS: Routes, Shipments, Stops, Cost Snapshots
   Does NOT own: Warehouses, Transfers, Supplier data (uses ports)
-------------------------- */

// ========== 1. SHIPMENT (Core Entity) ==========
const ShipmentSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  
  // Shipment Type
  type: {
    type: String,
    enum: ['inbound', 'outbound', 'transfer', 'direct_delivery'],
    required: true
  },
  
  // References (NOT embedded - just IDs)
  referenceId: { type: mongoose.Schema.Types.ObjectId }, // transferId, purchaseOrderId, etc.
  referenceType: { type: String, enum: ['transfer', 'purchase_order', 'return'] },
  
  // Source system tracking for traceability
  sourceSystem: {
    type: String,
    enum: ['manual', 'optimizer', 'purchase_order', 'transfer'],
    default: 'manual'
  },
  correlationId: { type: String },
  priority: { type: Number, default: 5, min: 1, max: 10 },
  
  // Origin & Destination
  originLocationId: { type: String, required: true },
  destinationLocationId: { type: String },
  
  // Status Lifecycle
  status: {
    type: String,
    enum: ['pending', 'planned', 'dispatched', 'in_transit', 'delivered', 'cancelled', 'partial'],
    default: 'pending'
  },
  
  // Timestamps
  plannedDispatchAt: { type: Date },
  plannedDeliveryAt: { type: Date },
  actualDispatchAt: { type: Date },
  actualDeliveryAt: { type: Date },
  
  // Route Reference
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  
  // Cost Snapshot (auditable)
  costSnapshot: {
    totalDistanceKm: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    costPerKm: { type: Number },
    fuelCost: { type: Number },
    laborCost: { type: Number },
    otherCosts: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    calculatedAt: { type: Date, default: Date.now },
    actualCost: { type: Number },
    actualFuelCost: { type: Number },
    actualLaborHours: { type: Number },
    actualDistanceKm: { type: Number }
  },
  
  // Cargo Details
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    quantity: { type: Number, required: true, min: 1 },
    weight: { type: Number },
    volume: { type: Number },
    batchNumber: { type: String },
    unitValue: { type: Number }
  }],
  
  totalWeight: { type: Number, default: 0 },
  totalVolume: { type: Number, default: 0 },
  totalValue: { type: Number, default: 0 },
  
  // Vehicle Assignment
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  driverName: { type: String },
  driverContact: { type: String },
  
  // Tracking
  trackingEvents: [{
    eventId: { type: String, default: uuidv4 },
    eventType: { type: String, enum: ['created', 'planned', 'dispatched', 'arrived_at_stop', 'departed_stop', 'delayed', 'delivered', 'cancelled'] },
    stopId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentStop' },
    locationId: { type: String },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed }
  }],
  
  // Performance Metrics
  performanceMetrics: {
    plannedDurationHours: { type: Number },
    actualDurationHours: { type: Number },
    varianceMinutes: { type: Number },
    onTimeDelivery: { type: Boolean },
    costEfficiency: { type: Number }
  },
  
  // Metadata
  createdBy: { type: String, required: true },
  updatedBy: { type: String },
  version: { type: Number, default: 1 },
  notes: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed }
  
}, { timestamps: true });

// Indexes
ShipmentSchema.index({ orgCode: 1, status: 1 });
ShipmentSchema.index({ referenceId: 1, referenceType: 1 });
ShipmentSchema.index({ originLocationId: 1 });
ShipmentSchema.index({ plannedDeliveryAt: 1 });
ShipmentSchema.index({ correlationId: 1 });
ShipmentSchema.index({ priority: -1, plannedDispatchAt: 1 });
ShipmentSchema.index({ vehicleId: 1, status: 1 }); // Find shipments by vehicle
ShipmentSchema.index({ actualDeliveryAt: 1 }); // For delivery reports

// Calculate totals from items
ShipmentSchema.pre('save', function () {
  if (this.items && this.items.length > 0) {
    this.totalWeight = this.items.reduce((sum, item) => sum + (item.weight || 0) * item.quantity, 0);
    this.totalVolume = this.items.reduce((sum, item) => sum + (item.volume || 0) * item.quantity, 0);
    this.totalValue = this.items.reduce((sum, item) => sum + (item.unitValue || 0) * item.quantity, 0);
  }
});

// Add tracking event
ShipmentSchema.methods.addTrackingEvent = function(eventType, locationId, stopId = null, notes = '', metadata = {}) {
  this.trackingEvents.push({
    eventId: uuidv4(),
    eventType,
    stopId,
    locationId,
    timestamp: new Date(),
    notes,
    metadata
  });
  return this;
};

// Plan schedule
ShipmentSchema.methods.planSchedule = function(settings) {
  const now = new Date();
  const dispatchDelayMinutes = settings?.dispatchDelayMinutes || 120;
  const avgTransitHours = settings?.avgTransitHours || 24;

  this.plannedDispatchAt = new Date(now.getTime() + dispatchDelayMinutes * 60000);
  this.plannedDeliveryAt = new Date(this.plannedDispatchAt.getTime() + avgTransitHours * 3600000);
  this.status = 'planned';
  
  this.addTrackingEvent('planned', this.originLocationId, null, `Planned for dispatch at ${this.plannedDispatchAt}`);
  
  return this;
};

// Dispatch shipment
ShipmentSchema.methods.dispatch = function(vehicleId = null, driverName = null, driverContact = null) {
  if (this.status !== 'planned') {
    throw new Error(`Cannot dispatch shipment in status: ${this.status}`);
  }
  
  this.status = 'dispatched';
  this.actualDispatchAt = new Date();
  if (vehicleId) this.vehicleId = vehicleId;
  if (driverName) this.driverName = driverName;
  if (driverContact) this.driverContact = driverContact;
  
  this.addTrackingEvent('dispatched', this.originLocationId, null, `Dispatched with vehicle ${vehicleId || 'unknown'}`);
  
  return this;
};

// Deliver shipment
ShipmentSchema.methods.deliver = function() {
  if (this.status !== 'in_transit' && this.status !== 'dispatched') {
    throw new Error(`Cannot deliver shipment in status: ${this.status}`);
  }
  
  this.status = 'delivered';
  this.actualDeliveryAt = new Date();
  
  if (this.plannedDeliveryAt) {
    const plannedMs = this.plannedDeliveryAt.getTime();
    const actualMs = this.actualDeliveryAt.getTime();
    this.performanceMetrics = {
      plannedDurationHours: (this.plannedDeliveryAt - this.plannedDispatchAt) / (1000 * 60 * 60),
      actualDurationHours: (this.actualDeliveryAt - this.actualDispatchAt) / (1000 * 60 * 60),
      varianceMinutes: (actualMs - plannedMs) / (1000 * 60),
      onTimeDelivery: actualMs <= plannedMs,
      costEfficiency: this.costSnapshot?.totalCost ? 1 : null
    };
  }
  
  this.addTrackingEvent('delivered', this.destinationLocationId || this.originLocationId, null, 'Shipment delivered successfully');
  
  return this;
};

// Create shipment from transfer
ShipmentSchema.statics.fromTransfer = function(transfer, orgCode, correlationId = null) {
  const shipment = new this({
    shipmentId: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orgCode,
    type: 'transfer',
    referenceId: transfer._id,
    referenceType: 'transfer',
    originLocationId: transfer.fromWarehouseId,
    destinationLocationId: transfer.toWarehouseId,
    sourceSystem: 'optimizer',
    correlationId: correlationId || transfer.correlationId,
    priority: transfer.priority || 5,
    status: 'pending',
    items: transfer.items || [],
    createdBy: transfer.createdBy || 'optimizer'
  });
  
  if (shipment.items && shipment.items.length > 0) {
    shipment.totalWeight = shipment.items.reduce((sum, item) => sum + (item.weight || 0) * item.quantity, 0);
    shipment.totalVolume = shipment.items.reduce((sum, item) => sum + (item.volume || 0) * item.quantity, 0);
  }
  
  shipment.addTrackingEvent('created', transfer.fromWarehouseId, null, 'Automatically created from optimizer transfer');
  
  return shipment;
};

// Create shipment from purchase order
ShipmentSchema.statics.fromPurchaseOrder = function(purchaseOrder, orgCode, correlationId = null) {
  const shipment = new this({
    shipmentId: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    orgCode,
    type: 'inbound',
    referenceId: purchaseOrder._id,
    referenceType: 'purchase_order',
    destinationLocationId: purchaseOrder.destinationWarehouseId,
    sourceSystem: 'optimizer',
    correlationId: correlationId || purchaseOrder.correlationId,
    priority: purchaseOrder.priority || 5,
    status: 'pending',
    items: purchaseOrder.items || [],
    createdBy: purchaseOrder.createdBy || 'optimizer'
  });
  
  if (shipment.items && shipment.items.length > 0) {
    shipment.totalWeight = shipment.items.reduce((sum, item) => sum + (item.weight || 0) * item.quantity, 0);
    shipment.totalVolume = shipment.items.reduce((sum, item) => sum + (item.volume || 0) * item.quantity, 0);
  }
  
  shipment.addTrackingEvent('created', null, null, 'Automatically created from purchase order');
  
  return shipment;
};

// ========== 2. SHIPMENT STOP ==========
const ShipmentStopSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  orgCode: { type: String, required: true, index: true },
  
  stopNumber: { type: Number, required: true },
  locationId: { type: String, required: true },
  locationType: { type: String, enum: ['warehouse', 'store', 'supplier', 'customer'] },
  locationName: { type: String },
  
  action: {
    type: String,
    enum: ['pickup', 'dropoff', 'both'],
    default: 'dropoff'
  },
  
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    quantity: { type: Number, required: true, min: 1 },
    batchNumber: { type: String },
    receivedQuantity: { type: Number },
    rejectionReason: { type: String }
  }],
  
  plannedArrivalAt: { type: Date },
  plannedDepartureAt: { type: Date },
  actualArrivalAt: { type: Date },
  actualDepartureAt: { type: Date },
  
  status: {
    type: String,
    enum: ['pending', 'arrived', 'completed', 'skipped', 'delayed'],
    default: 'pending'
  },
  
  delayMinutes: { type: Number, default: 0 },
  delayReason: { type: String },
  
  distanceFromPreviousKm: { type: Number, default: 0 },
  durationFromPreviousHours: { type: Number, default: 0 },
  
  notes: { type: String },
  varianceMinutes: { type: Number, default: 0 },
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 }
  
}, { timestamps: true });

ShipmentStopSchema.index({ shipmentId: 1, stopNumber: 1 });
ShipmentStopSchema.index({ locationId: 1, status: 1 });

// ========== 3. ROUTE ==========
const RouteSchema = new mongoose.Schema({
  routeId: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  
  stops: [{
    sequence: { type: Number, required: true },
    locationId: { type: String, required: true },
    locationName: { type: String },
    locationCoordinates: { type: [Number] },
    action: { type: String, enum: ['pickup', 'dropoff', 'both'] },
    estimatedArrival: { type: Date },
    estimatedDeparture: { type: Date },
    expectedLoadKg: { type: Number, default: 0 },
    expectedLoadM3: { type: Number, default: 0 }
  }],
  
  totalDistanceKm: { type: Number, required: true, min: 0 },
  totalDurationHours: { type: Number, required: true, min: 0 },
  estimatedCost: { type: Number, required: true, min: 0 },
  
  constraints: {
    maxStops: { type: Number },
    maxDistanceKm: { type: Number },
    maxDurationHours: { type: Number },
    vehicleCapacityKg: { type: Number },
    vehicleCapacityM3: { type: Number },
    timeWindows: { type: Boolean, default: false }
  },
  
  geometry: {
    type: { type: String, enum: ['LineString'], default: 'LineString' },
    coordinates: { type: [[Number]] }
  },
  
  optimizationStrategy: { type: String, enum: ['shortest_distance', 'fastest_time', 'cheapest_cost', 'balanced'], default: 'shortest_distance' },
  optimizationScore: { type: Number },
  optimizationVersion: { type: String },
  
  isActive: { type: Boolean, default: true },
  isOptimized: { type: Boolean, default: false },
  usageCount: { type: Number, default: 0 },
  
  createdBy: { type: String, required: true },
  version: { type: Number, default: 1 }
  
}, { timestamps: true });

RouteSchema.index({ orgCode: 1, isActive: 1 });
RouteSchema.index({ totalDistanceKm: 1 });
RouteSchema.index({ optimizationScore: -1 });

RouteSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  return this;
};

// ========== 4. VEHICLE ==========
const VehicleSchema = new mongoose.Schema({
  vehicleId: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  
  registrationNumber: { type: String, required: true, unique: true },
  type: { type: String, enum: ['truck', 'van', 'pickup', 'motorcycle', 'bicycle'], required: true },
  make: { type: String },
  model: { type: String },
  year: { type: Number },
  
  maxWeightKg: { type: Number, required: true, min: 0 },
  maxVolumeM3: { type: Number, min: 0 },
  maxStopsPerTrip: { type: Number, default: 10, min: 1 },
  
  fuelEfficiencyKmPerLiter: { type: Number },
  fixedCostPerTrip: { type: Number, default: 0, min: 0 },
  variableCostPerKm: { type: Number, min: 0 },
  hourlyRate: { type: Number, min: 0 },
  
  status: {
    type: String,
    enum: ['active', 'maintenance', 'retired', 'on_trip'],
    default: 'active'
  },
  
  currentLocationId: { type: String },
  currentLocationCoordinates: { type: [Number] },
  currentAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  
  lastMaintenanceAt: { type: Date },
  nextMaintenanceAt: { type: Date },
  odometerKm: { type: Number, default: 0 },
  
  notes: { type: String },
  createdBy: { type: String, required: true },
  updatedBy: { type: String }
  
}, { timestamps: true });

VehicleSchema.index({ orgCode: 1, status: 1 });

VehicleSchema.methods.isAvailable = function() {
  if (this.status !== 'active') return false;
  if (this.currentAssignmentId) return false;
  return true;
};

VehicleSchema.methods.assignToShipment = function(shipmentId) {
  this.currentAssignmentId = shipmentId;
  this.status = 'on_trip';
  return this;
};

VehicleSchema.methods.releaseFromShipment = function() {
  this.currentAssignmentId = null;
  this.status = 'active';
  return this;
};

// ========== 5. DELIVERY SLOT ==========
const DeliverySlotSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  locationId: { type: String, required: true },
  locationType: { type: String, enum: ['warehouse', 'store', 'supplier'] },
  
  dayOfWeek: { type: Number, min: 0, max: 6 },
  timeStart: { type: String },
  timeEnd: { type: String },
  
  maxShipmentsPerSlot: { type: Number, default: 10, min: 1 },
  currentShipmentsCount: { type: Number, default: 0 },
  
  isActive: { type: Boolean, default: true },
  
  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

DeliverySlotSchema.index({ locationId: 1, dayOfWeek: 1 });
DeliverySlotSchema.index({ locationId: 1, isActive: 1 });

DeliverySlotSchema.methods.isAvailable = function() {
  return this.currentShipmentsCount < this.maxShipmentsPerSlot;
};

DeliverySlotSchema.methods.bookSlot = function() {
  if (!this.isAvailable()) {
    throw new Error(`Delivery slot at ${this.locationId} is fully booked`);
  }
  this.currentShipmentsCount += 1;
  return this;
};

DeliverySlotSchema.methods.releaseSlot = function() {
  this.currentShipmentsCount = Math.max(0, this.currentShipmentsCount - 1);
  return this;
};

// ========== 6. ROUTE PERFORMANCE ==========
const RoutePerformanceSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
  
  plannedDistanceKm: { type: Number, required: true, min: 0 },
  actualDistanceKm: { type: Number, min: 0 },
  plannedDurationHours: { type: Number, required: true, min: 0 },
  actualDurationHours: { type: Number, min: 0 },
  plannedCost: { type: Number, required: true, min: 0 },
  actualCost: { type: Number, min: 0 },
  
  distanceVariancePercent: { type: Number },
  durationVariancePercent: { type: Number },
  costVariancePercent: { type: Number },
  
  delayReasons: [{
    stopId: { type: mongoose.Schema.Types.ObjectId },
    stopName: { type: String },
    reason: { type: String },
    extraMinutes: { type: Number, min: 0 },
    category: { type: String, enum: ['traffic', 'loading', 'unloading', 'mechanical', 'weather', 'other'] }
  }],
  
  efficiencyScore: { type: Number, default: 100, min: 0, max: 100 },
  recommendationScore: { type: Number },
  recommendedChanges: [{ type: String }],
  
  weatherConditions: { type: String },
  trafficLevel: { type: String, enum: ['low', 'medium', 'high', 'severe'] },
  
  recordedAt: { type: Date, default: Date.now },
  recordedBy: { type: String }
});

RoutePerformanceSchema.index({ routeId: 1, recordedAt: -1 });
RoutePerformanceSchema.index({ orgCode: 1, efficiencyScore: -1 });

RoutePerformanceSchema.pre('save', function(next) {
  try {
    if (this.plannedDistanceKm > 0 && this.actualDistanceKm) {
      this.distanceVariancePercent = ((this.actualDistanceKm - this.plannedDistanceKm) / this.plannedDistanceKm) * 100;
    }
    if (this.plannedDurationHours > 0 && this.actualDurationHours) {
      this.durationVariancePercent = ((this.actualDurationHours - this.plannedDurationHours) / this.plannedDurationHours) * 100;
    }
    if (this.plannedCost > 0 && this.actualCost) {
      this.costVariancePercent = ((this.actualCost - this.plannedCost) / this.plannedCost) * 100;
    }
    
    let efficiencyPenalty = 0;
    if (this.durationVariancePercent && this.durationVariancePercent > 0) {
      efficiencyPenalty += Math.min(50, this.durationVariancePercent);
    }
    if (this.costVariancePercent && this.costVariancePercent > 0) {
      efficiencyPenalty += Math.min(30, this.costVariancePercent);
    }
    
    this.efficiencyScore = Math.max(0, Math.min(100, 100 - efficiencyPenalty));
    
    next();
  } catch (error) {
    next(error);
  }
});

/* -------------------------
   EXPORTS
-------------------------- */
module.exports = {
  Shipment: mongoose.model('Shipment', ShipmentSchema),
  ShipmentStop: mongoose.model('ShipmentStop', ShipmentStopSchema),
  Route: mongoose.model('Route', RouteSchema),
  Vehicle: mongoose.model('Vehicle', VehicleSchema),
  DeliverySlot: mongoose.model('DeliverySlot', DeliverySlotSchema),
  RoutePerformance: mongoose.model('RoutePerformance', RoutePerformanceSchema)
};