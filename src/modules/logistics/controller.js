const mongoose = require('mongoose');
const { createLogisticsService } = require('./service');
const {
  Shipment,
  ShipmentStop,
  Route,
  Vehicle,
  DeliverySlot,
  RoutePerformance
} = require('./model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');
const Warehouse = require('../inventory/warehouseModel');

// Helper to get logistics service with proper ports
const getLogisticsService = async (orgCode) => {
  // Create custom ports using your existing models
  const warehousePort = {
    async getWarehouse(warehouseId) {
      let warehouse;
      if (mongoose.Types.ObjectId.isValid(warehouseId)) {
        warehouse = await Warehouse.findById(warehouseId);
      }
      if (!warehouse) {
        warehouse = await Warehouse.findOne({ locationId: warehouseId });
      }
      return warehouse;
    },
    async getWarehouses(orgCode, filters = {}) {
      return Warehouse.find({ orgCode, ...filters });
    }
  };

  const transferPort = {
    async updateTransferStatus(transferId, status) {
      const Transfer = require('../inventory/transferModel');
      return Transfer.findByIdAndUpdate(transferId, { status, updatedAt: new Date() }, { new: true });
    },
    async getTransfer(transferId) {
      const Transfer = require('../inventory/transferModel');
      return Transfer.findById(transferId);
    }
  };

  const geocodingPort = {
    async getDistance(fromCoords, toCoords) {
      const { calculateDrivingDistance } = require('../../utils/geocoding');
      const result = await calculateDrivingDistance(
        fromCoords[1], fromCoords[0],
        toCoords[1], toCoords[0]
      );
      return {
        distanceKm: result.distanceKm,
        durationHours: result.durationHours
      };
    }
  };

  const settingsPort = {
    async getLogisticsSettings() {
      const settings = await Settings.findOne({ orgCode });
      return {
        fuelCostPerKm: settings?.logistics?.fuelCostPerKm || 150,
        laborCostPerHour: settings?.logistics?.laborCostPerHour || 500,
        fixedCostPerTrip: settings?.logistics?.fixedCostPerTrip || 1000,
        maxStopsPerRoute: settings?.logistics?.maxStopsPerRoute || 10,
        maxRouteDistanceKm: settings?.logistics?.maxRouteDistanceKm || 500,
        vehicleCapacityKg: settings?.logistics?.vehicleCapacityKg || 1000,
        dispatchDelayMinutes: 120,
        avgTransitHours: 24,
        ...(settings?.logistics || {})
      };
    }
  };

  const eventBus = {
    async emit(event) {
      console.log(`[EventBus] ${event.type}:`, event);
      // In production, this would send to your orchestrator's event bus
    }
  };

  const service = createLogisticsService(eventBus);
  // Manually set ports if needed
  service.warehousePort = warehousePort;
  service.transferPort = transferPort;
  service.geocodingPort = geocodingPort;
  service.settingsPort = settingsPort;
  
  return service;
};

// ============ ROUTE PLANNING ============
const planRoute = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const {
      originLocationId,
      destinationLocationIds,
      constraints,
      optimizationStrategy,
      vehicleId,
      startTime
    } = req.body;

    if (!originLocationId || !destinationLocationIds || destinationLocationIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: originLocationId, destinationLocationIds'
      });
    }

    const logistics = await getLogisticsService(orgCode);
    const result = await logistics.planRoute({
      orgCode,
      originLocationId,
      destinationLocationIds,
      constraints: constraints || {},
      optimizationStrategy: optimizationStrategy || 'shortest_distance',
      vehicleId: vehicleId || null,
      startTime: startTime ? new Date(startTime) : new Date(),
      createdBy: req.user.id
    });

    res.json({
      success: true,
      data: result,
      message: `Route planned successfully. ${result.route.stops.length} stops, ${result.route.totalDistanceKm.toFixed(2)}km`
    });
  } catch (error) {
    console.error('Plan route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============ SHIPMENT MANAGEMENT ============
const getShipments = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status, type, referenceType, limit } = req.query;

    const query = { orgCode };
    if (status) query.status = status;
    if (type) query.type = type;
    if (referenceType) query.referenceType = referenceType;

    const shipments = await Shipment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 100)
      .populate('vehicleId', 'registrationNumber type maxWeightKg');

    res.json({ success: true, data: shipments });
  } catch (error) {
    console.error('Get shipments error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getShipment = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;

    const shipment = await Shipment.findOne({ shipmentId, orgCode })
      .populate('vehicleId', 'registrationNumber type maxWeightKg');

    if (!shipment) {
      return res.status(404).json({ success: false, error: 'Shipment not found' });
    }

    const stops = await ShipmentStop.find({ shipmentId: shipment._id }).sort({ stopNumber: 1 });

    res.json({ success: true, data: { ...shipment.toObject(), stops } });
  } catch (error) {
    console.error('Get shipment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createShipmentFromRoute = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { routeId, referenceId, referenceType, items, priority } = req.body;

    if (!routeId) {
      return res.status(400).json({ success: false, error: 'routeId required' });
    }

    const logistics = await getLogisticsService(orgCode);
    const shipment = await logistics.createShipmentFromRoute({
      routeId,
      referenceId,
      referenceType: referenceType || 'direct',
      items: items || [],
      createdBy: req.user.id,
      orgCode,
      priority: priority || 5,
      sourceSystem: 'manual'
    });

    res.status(201).json({
      success: true,
      data: shipment,
      message: `Shipment ${shipment.shipmentId} created from route`
    });
  } catch (error) {
    console.error('Create shipment from route error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const dispatchShipment = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;
    const { vehicleId, driverName, driverContact } = req.body;

    const logistics = await getLogisticsService(orgCode);
    const result = await logistics.dispatchShipment(shipmentId, orgCode, vehicleId, driverName, driverContact);

    res.json({
      success: true,
      data: result,
      message: `Shipment ${shipmentId} dispatched`
    });
  } catch (error) {
    console.error('Dispatch shipment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const completeStop = async (req, res) => {
  try {
    const { shipmentId, stopNumber } = req.params;
    const orgCode = req.user.orgCode;
    const { itemsDelivered, rejectionReason } = req.body;

    const logistics = await getLogisticsService(orgCode);
    const stop = await logistics.completeStop(shipmentId, parseInt(stopNumber), orgCode, itemsDelivered, rejectionReason);

    res.json({
      success: true,
      data: stop,
      message: `Stop ${stopNumber} completed`
    });
  } catch (error) {
    console.error('Complete stop error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const completeDelivery = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;

    const logistics = await getLogisticsService(orgCode);
    const shipment = await logistics.completeDelivery(shipmentId, orgCode);

    res.json({
      success: true,
      data: shipment,
      message: `Shipment ${shipmentId} delivered`
    });
  } catch (error) {
    console.error('Complete delivery error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const cancelShipment = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;
    const { reason } = req.body;

    const logistics = await getLogisticsService(orgCode);
    const shipment = await logistics.cancelShipment(shipmentId, orgCode, reason);

    res.json({
      success: true,
      data: shipment,
      message: `Shipment ${shipmentId} cancelled`
    });
  } catch (error) {
    console.error('Cancel shipment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============ VEHICLE MANAGEMENT ============
const getVehicles = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status } = req.query;

    const query = { orgCode };
    if (status) query.status = status;

    const vehicles = await Vehicle.find(query);
    res.json({ success: true, data: vehicles });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createVehicle = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const vehicleData = req.body;

    const logistics = await getLogisticsService(orgCode);
    const vehicle = await logistics.createVehicle(vehicleData, orgCode, req.user.id);

    res.status(201).json({
      success: true,
      data: vehicle,
      message: `Vehicle ${vehicle.registrationNumber} created`
    });
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getAvailableVehicles = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { requiredWeightKg, requiredVolumeM3 } = req.query;

    const logistics = await getLogisticsService(orgCode);
    const vehicles = await logistics.getAvailableVehicles(
      orgCode,
      requiredWeightKg ? parseFloat(requiredWeightKg) : null,
      requiredVolumeM3 ? parseFloat(requiredVolumeM3) : null
    );

    res.json({ success: true, data: vehicles });
  } catch (error) {
    console.error('Get available vehicles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============ TRACKING & ETA ============
const getTracking = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;

    const logistics = await getLogisticsService(orgCode);
    const tracking = await logistics.getTrackingHistory(shipmentId, orgCode);

    res.json({ success: true, data: tracking });
  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const calculateETA = async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const orgCode = req.user.orgCode;
    const { lat, lng } = req.query;

    const logistics = await getLogisticsService(orgCode);
    const eta = await logistics.calculateETA(
      shipmentId,
      orgCode,
      lat && lng ? [parseFloat(lng), parseFloat(lat)] : null
    );

    res.json({ success: true, data: eta });
  } catch (error) {
    console.error('Calculate ETA error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============ ROUTE PERFORMANCE ============
const getRoutePerformance = async (req, res) => {
  try {
    const { routeId } = req.params;
    const orgCode = req.user.orgCode;
    const { days } = req.query;

    const logistics = await getLogisticsService(orgCode);
    const performance = await logistics.getRoutePerformance(routeId, orgCode, days ? parseInt(days) : 30);

    res.json({ success: true, data: performance });
  } catch (error) {
    console.error('Get route performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  // Route Planning
  planRoute,
  
  // Shipment Management
  getShipments,
  getShipment,
  createShipmentFromRoute,
  dispatchShipment,
  completeStop,
  completeDelivery,
  cancelShipment,
  
  // Vehicle Management
  getVehicles,
  createVehicle,
  getAvailableVehicles,
  
  // Tracking
  getTracking,
  calculateETA,
  
  // Analytics
  getRoutePerformance
};