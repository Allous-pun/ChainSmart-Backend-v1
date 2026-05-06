const mongoose = require('mongoose');
const { EmissionRecord, SupplierCarbon, MonthlyEmissionSummary } = require('./model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');
const { calculateDrivingDistance } = require('../../utils/geocoding');

// Explicitly require models to ensure they are registered with mongoose
require('../inventory/warehouseModel');  // Registers Warehouse model
require('../branches/model');            // Registers Branch model

// Emission factors by transport mode (kg CO2 per km per ton)
const DEFAULT_CO2_FACTORS = {
  road: 0.12,      // kg CO2 per km for light truck
  rail: 0.02,      // kg CO2 per km
  air: 0.8,        // kg CO2 per km (high)
  sea: 0.01        // kg CO2 per km (low)
};

// Fuel-specific factors (kg CO2 per liter)
const FUEL_CO2_FACTORS = {
  petrol: 2.31,
  diesel: 2.68,
  electric: 0,      // depends on grid, use 0 for now
  cng: 1.95
};

// Calculate CO2 for a route
const calculateCO2ForRoute = async (fromCoords, toCoords, weightKg = 1000, transportMode = 'road', fuelType = 'diesel', orgCode = null) => {
  // Get distance
  const distance = await calculateDrivingDistance(
    fromCoords[1], fromCoords[0],
    toCoords[1], toCoords[0]
  );
  
  const distanceKm = distance?.distanceKm || 0;
  
  // Get settings
  let co2FactorPerKm = DEFAULT_CO2_FACTORS[transportMode] || 0.12;
  let reportingUnit = 'kg';
  
  if (orgCode) {
    const settings = await Settings.findOne({ orgCode });
    if (settings?.emissions) {
      co2FactorPerKm = settings.emissions.co2FactorPerKm || co2FactorPerKm;
      reportingUnit = settings.emissions.reportingUnit || 'kg';
      
      // Check for fuel-specific factor
      const fuelSetting = settings.emissions.fuelTypes?.find(f => f.name === fuelType);
      if (fuelSetting?.co2Factor) {
        co2FactorPerKm = fuelSetting.co2Factor;
      }
    }
  }
  
  // Calculate CO2
  const weightInTons = weightKg / 1000;
  const co2Emitted = distanceKm * co2FactorPerKm * weightInTons;
  
  // Convert to reporting unit if needed
  const finalCO2 = reportingUnit === 'tons' ? co2Emitted / 1000 : co2Emitted;
  const finalUnit = reportingUnit === 'tons' ? 'tons' : 'kg';
  
  return {
    distanceKm,
    co2Emitted: finalCO2,
    unit: finalUnit,
    rawCo2Kg: co2Emitted,
    co2PerKm: co2FactorPerKm * weightInTons,
    calculationMethod: 'osrm_exact'
  };
};

// Calculate CO2 for a shipment
const calculateShipmentEmissions = async (shipment, orgCode) => {
  const { fromLocationId, toLocationId, items, totalWeight } = shipment;
  
  // Get warehouse locations
  const Warehouse = mongoose.model('Warehouse');
  const fromWarehouse = await Warehouse.findOne({ $or: [
    { _id: fromLocationId },
    { locationId: fromLocationId }
  ]}).lean();
  
  const toWarehouse = await Warehouse.findOne({ $or: [
    { _id: toLocationId },
    { locationId: toLocationId }
  ]}).lean();
  
  if (!fromWarehouse?.location?.coordinates || !toWarehouse?.location?.coordinates) {
    throw new Error('Missing coordinates for route calculation');
  }
  
  const weightKg = totalWeight || 1000;
  const transportMode = shipment.transportMode || 'road';
  
  const result = await calculateCO2ForRoute(
    fromWarehouse.location.coordinates,
    toWarehouse.location.coordinates,
    weightKg,
    transportMode,
    'diesel',
    orgCode
  );
  
  // Calculate per-product emissions
  const totalQuantity = items?.reduce((sum, i) => sum + i.quantity, 0) || 1;
  const co2PerUnit = result.co2Emitted / totalQuantity;
  
  return {
    ...result,
    co2PerUnit,
    totalQuantity,
    fromLocation: fromWarehouse.name,
    toLocation: toWarehouse.name
  };
};

// Calculate CO2 for a transfer (internal)
const calculateTransferEmissions = async (transfer, orgCode) => {
  const Branch = mongoose.model('Branch');
  const fromBranch = await Branch.findOne({ branchId: transfer.fromWarehouseId, orgCode }).lean();
  const toBranch = await Branch.findOne({ branchId: transfer.toWarehouseId, orgCode }).lean();
  
  if (!fromBranch?.coordinates || !toBranch?.coordinates) {
    throw new Error('Missing coordinates for transfer route');
  }
  
  const weightKg = transfer.items?.reduce((sum, i) => sum + (i.weight || 1) * i.quantity, 0) || 100;
  
  const result = await calculateCO2ForRoute(
    [fromBranch.coordinates.lng, fromBranch.coordinates.lat],
    [toBranch.coordinates.lng, toBranch.coordinates.lat],
    weightKg,
    'road',
    'diesel',
    orgCode
  );
  
  return result;
};

// Save emission record
const saveEmissionRecord = async (data, orgCode, calculatedBy = 'system') => {
  const recordId = `EM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  const record = new EmissionRecord({
    recordId,
    orgCode,
    ...data,
    calculatedBy,
    calculatedAt: new Date()
  });
  
  await record.save();
  return record;
};

// Get emission record by reference
const getEmissionByReference = async (referenceId, referenceType, orgCode) => {
  return EmissionRecord.findOne({ referenceId, referenceType, orgCode });
};

// Update monthly summary
const updateMonthlySummary = async (orgCode, year, month, emissionData) => {
  const summary = await MonthlyEmissionSummary.findOneAndUpdate(
    { orgCode, year, month },
    {
      $inc: {
        totalCO2: emissionData.co2Emitted,
        [`byType.${emissionData.referenceType}`]: emissionData.co2Emitted,
        [`byTransportMode.${emissionData.transportMode || 'road'}`]: emissionData.co2Emitted
      }
    },
    { upsert: true, new: true, returnDocument: 'after' }
  );
  
  return summary;
};

// Get supplier carbon score
const getSupplierCarbonScore = async (supplierId, orgCode) => {
  let carbon = await SupplierCarbon.findOne({ supplierId, orgCode });
  
  if (!carbon) {
    // Create default entry
    carbon = await SupplierCarbon.create({
      orgCode,
      supplierId,
      carbonScore: 100,
      rating: 'unknown',
      assessmentMethod: 'estimated'
    });
  }
  
  return carbon;
};

// Update supplier carbon score
const updateSupplierCarbonScore = async (supplierId, orgCode, data) => {
  const carbon = await SupplierCarbon.findOneAndUpdate(
    { supplierId, orgCode },
    { ...data, lastAssessmentAt: new Date() },
    { upsert: true, new: true, returnDocument: 'after' }
  );
  
  return carbon;
};

// Calculate carbon intensity score (0-100, lower is better)
const calculateCarbonIntensityScore = (co2Emitted, weightKg, distanceKm) => {
  const intensity = co2Emitted / (weightKg * distanceKm);
  // Lower intensity = better score
  const score = Math.max(0, Math.min(100, 100 - (intensity * 1000)));
  return Math.round(score);
};

// Get emissions dashboard data
const getEmissionsDashboard = async (orgCode, days = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const records = await EmissionRecord.find({
    orgCode,
    calculatedAt: { $gte: startDate }
  }).sort({ calculatedAt: -1 });
  
  const totalCO2 = records.reduce((sum, r) => sum + r.co2Emitted, 0);
  
  const byType = {
    shipment: records.filter(r => r.referenceType === 'shipment').reduce((s, r) => s + r.co2Emitted, 0),
    transfer: records.filter(r => r.referenceType === 'transfer').reduce((s, r) => s + r.co2Emitted, 0),
    purchase_order: records.filter(r => r.referenceType === 'purchase_order').reduce((s, r) => s + r.co2Emitted, 0)
  };
  
  // Daily trend
  const dailyTrend = {};
  records.forEach(r => {
    const date = r.calculatedAt.toISOString().split('T')[0];
    dailyTrend[date] = (dailyTrend[date] || 0) + r.co2Emitted;
  });
  
  const topShipments = records
    .sort((a, b) => b.co2Emitted - a.co2Emitted)
    .slice(0, 5)
    .map(r => ({
      referenceId: r.referenceId,
      referenceType: r.referenceType,
      co2Emitted: r.co2Emitted,
      distanceKm: r.distanceKm
    }));
  
  return {
    period: `${days} days`,
    totalCO2,
    byType,
    dailyTrend: Object.entries(dailyTrend).map(([date, co2]) => ({ date, co2 })),
    topShipments,
    recordCount: records.length
  };
};

// Generate emissions report
const generateEmissionsReport = async (orgCode, startDate, endDate) => {
  const records = await EmissionRecord.find({
    orgCode,
    calculatedAt: { $gte: startDate, $lte: endDate }
  }).populate('productId', 'name sku');
  
  const totalCO2 = records.reduce((sum, r) => sum + r.co2Emitted, 0);
  
  const byProduct = {};
  records.forEach(r => {
    const productName = r.productName || r.productId?.name || 'Unknown';
    byProduct[productName] = (byProduct[productName] || 0) + r.co2Emitted;
  });
  
  const byLocation = {};
  records.forEach(r => {
    byLocation[r.toLocationId || 'unknown'] = (byLocation[r.toLocationId || 'unknown'] || 0) + r.co2Emitted;
  });
  
  const settings = await Settings.findOne({ orgCode });
  const orgSettings = await OrganizationSettings.findOne({ orgCode });
  const currency = orgSettings?.region?.defaultCurrency || 'KES';
  const offsetCostPerTon = 500; // KES per ton CO2 (typical tree planting cost)
  
  const estimatedOffsetCost = (totalCO2 / 1000) * offsetCostPerTon;
  
  return {
    period: { start: startDate, end: endDate },
    summary: {
      totalCO2,
      totalRecords: records.length,
      averagePerRecord: records.length > 0 ? totalCO2 / records.length : 0
    },
    breakdown: {
      byProduct: Object.entries(byProduct).map(([name, co2]) => ({ product: name, co2 })),
      byLocation: Object.entries(byLocation).map(([location, co2]) => ({ location, co2 })),
      byType: {
        shipment: records.filter(r => r.referenceType === 'shipment').reduce((s, r) => s + r.co2Emitted, 0),
        transfer: records.filter(r => r.referenceType === 'transfer').reduce((s, r) => s + r.co2Emitted, 0),
        purchase_order: records.filter(r => r.referenceType === 'purchase_order').reduce((s, r) => s + r.co2Emitted, 0)
      }
    },
    offset: {
      estimatedCost: estimatedOffsetCost,
      currency,
      costPerTon: offsetCostPerTon
    },
    currency,
    generatedAt: new Date()
  };
};

module.exports = {
  calculateCO2ForRoute,
  calculateShipmentEmissions,
  calculateTransferEmissions,
  saveEmissionRecord,
  getEmissionByReference,
  updateMonthlySummary,
  getSupplierCarbonScore,
  updateSupplierCarbonScore,
  calculateCarbonIntensityScore,
  getEmissionsDashboard,
  generateEmissionsReport,
  DEFAULT_CO2_FACTORS,
  FUEL_CO2_FACTORS
};