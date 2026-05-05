const mongoose = require('mongoose');
const CostScenario = require('./model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');
const { SupplyOffer, SupplierLocation } = require('../supplier/model');
const { Product } = require('../products/model');
const { calculateDrivingDistance } = require('../../utils/geocoding');

// Helper: Get product details
const getProduct = async (productId, orgCode) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) throw new Error(`Product not found: ${productId}`);
  return product;
};

// Helper: Convert destination identifier to valid SupplierLocation ID
// Accepts: Branch ID (string) or Warehouse ID (ObjectId) or SupplierLocation ID (ObjectId)
const resolveDestinationLocation = async (destinationId, orgCode) => {
  const Warehouse = mongoose.model('Warehouse');
  const Branch = mongoose.model('Branch');
  
  // Check if it's already a valid SupplierLocation ObjectId
  if (mongoose.Types.ObjectId.isValid(destinationId)) {
    const supplierLocation = await SupplierLocation.findOne({ _id: destinationId, orgCode });
    if (supplierLocation) {
      return { type: 'supplier_location', id: supplierLocation._id.toString(), coordinates: supplierLocation.location?.coordinates };
    }
  }
  
  // Check if it's a Branch ID (string like TES3858_BR_003)
  const branch = await Branch.findOne({ branchId: destinationId, orgCode });
  if (branch) {
    // Find warehouse linked to this branch
    const warehouse = await Warehouse.findOne({ locationId: destinationId, orgCode });
    
    if (warehouse) {
      // Find supplier location by coordinates or name
      let supplierLocation = await SupplierLocation.findOne({
        orgCode,
        'location.coordinates': warehouse.location.coordinates
      });
      
      if (supplierLocation) {
        return { type: 'branch', id: supplierLocation._id.toString(), coordinates: branch.coordinates };
      }
    }
    
    // If no supplier location found, throw error - don't create
    throw new Error(`No SupplierLocation found for branch ${destinationId}. Please ensure a SupplierLocation exists with matching coordinates.`);
  }
  
  throw new Error(`Cannot resolve destination location: ${destinationId}`);
};

// Helper: Get supplier offer for product
const getBestOfferForProduct = async (productId, quantity, destinationLocationId, urgency, orgCode) => {
  // First resolve the destination to a valid SupplierLocation ID
  let resolvedDestination;
  try {
    resolvedDestination = await resolveDestinationLocation(destinationLocationId, orgCode);
  } catch (error) {
    console.error(`[getBestOfferForProduct] Failed to resolve destination: ${error.message}`);
    return null;
  }
  
  const context = {
    quantity,
    destinationLocationId: resolvedDestination.id,
    urgency,
    currency: 'USD',
    asOfDate: new Date(),
    riskTolerance: 'medium'
  };
  
  const rankedOffers = await SupplyOffer.getRankedOffers(productId, context, null, null);
  
  if (!rankedOffers || rankedOffers.length === 0) return null;
  
  const best = rankedOffers[0];
  return {
    supplyOffer: best.supplyOffer,
    costPerUnit: best.costPerUnit,
    totalLandedCost: best.totalLandedCost,
    supplierCost: best.supplierCost,
    transportCost: best.transportCost,
    effectiveLeadTime: best.effectiveLeadTime,
    supplierId: best.supplyOffer.supplierId,
    supplierName: best.supplyOffer.supplierId?.name
  };
};

// Helper: Calculate cost for specific quantity
const calculateCostForQuantity = async (productId, quantity, destinationLocationId, orgCode, productWeight = 1) => {
  const product = await getProduct(productId, orgCode);
  const settings = await Settings.findOne({ orgCode });
  const orgSettings = await OrganizationSettings.findOne({ orgCode });
  
  const currency = orgSettings?.region?.defaultCurrency || 'KES';
  const holdingCostPercent = settings?.costSimulation?.holdingCostPercent || 15;
  
  const offer = await getBestOfferForProduct(productId, quantity, destinationLocationId, 'routine', orgCode);
  
  let productCost = 0;
  let transportCost = 0;
  let unitPrice = 0;
  let effectiveLeadTime = 5;
  let reliability = 95;
  
  if (offer) {
    productCost = offer.supplierCost;
    transportCost = offer.transportCost;
    unitPrice = offer.costPerUnit;
    effectiveLeadTime = offer.effectiveLeadTime;
  } else {
    unitPrice = product.standardCost || 0;
    productCost = unitPrice * quantity;
    transportCost = quantity * 10;
  }
  
  const totalCost = productCost + transportCost;
  const holdingCost = totalCost * (holdingCostPercent / 100);
  
  return {
    productCost,
    transportCost,
    totalCost,
    perUnitCost: totalCost / quantity,
    unitPrice,
    holdingCost,
    quantity,
    currency,
    leadTime: effectiveLeadTime,
    reliability
  };
};

// Compare different quantities
const compareQuantities = async (productId, baseQuantity, quantities, destinationLocationId, orgCode) => {
  const baseResult = await calculateCostForQuantity(productId, baseQuantity, destinationLocationId, orgCode);
  
  const comparisons = [];
  for (const qty of quantities) {
    if (qty === baseQuantity) continue;
    
    const result = await calculateCostForQuantity(productId, qty, destinationLocationId, orgCode);
    const savings = baseResult.totalCost - result.totalCost;
    const savingsPercent = baseResult.totalCost > 0 ? (savings / baseResult.totalCost) * 100 : 0;
    
    comparisons.push({
      quantity: qty,
      totalCost: result.totalCost,
      perUnitCost: result.perUnitCost,
      savings,
      savingsPercent,
      isBetter: savings > 0,
      leadTime: result.leadTime
    });
  }
  
  comparisons.sort((a, b) => a.totalCost - b.totalCost);
  
  return {
    base: baseResult,
    comparisons,
    bestQuantity: comparisons.length > 0 && comparisons[0].totalCost < baseResult.totalCost 
      ? comparisons[0].quantity 
      : baseQuantity,
    bestSavings: comparisons.length > 0 ? comparisons[0].savings : 0
  };
};

// Compare different suppliers
const compareSuppliers = async (productId, quantity, destinationLocationId, supplierIds, orgCode) => {
  // First resolve the destination to a valid SupplierLocation ID
  let resolvedDestination;
  try {
    resolvedDestination = await resolveDestinationLocation(destinationLocationId, orgCode);
  } catch (error) {
    console.error(`[compareSuppliers] Failed to resolve destination: ${error.message}`);
    return [];
  }
  
  const results = [];
  
  for (const supplierId of supplierIds) {
    const context = {
      quantity,
      destinationLocationId: resolvedDestination.id,
      urgency: 'routine',
      currency: 'USD',
      asOfDate: new Date(),
      riskTolerance: 'medium'
    };
    
    const rankedOffers = await SupplyOffer.getRankedOffers(productId, context, null, null);
    const supplierOffer = rankedOffers.find(r => r.supplyOffer.supplierId?.toString() === supplierId);
    
    if (supplierOffer) {
      results.push({
        supplierId,
        supplierName: supplierOffer.supplyOffer.supplierId?.name,
        totalCost: supplierOffer.totalLandedCost,
        perUnitCost: supplierOffer.costPerUnit,
        productCost: supplierOffer.supplierCost,
        transportCost: supplierOffer.transportCost,
        leadTime: supplierOffer.effectiveLeadTime,
        reliability: supplierOffer.reliabilityScore
      });
    }
  }
  
  results.sort((a, b) => a.totalCost - b.totalCost);
  
  if (results.length > 1) {
    const best = results[0];
    const second = results[1];
    best.savings = second.totalCost - best.totalCost;
    best.savingsPercent = second.totalCost > 0 ? (best.savings / second.totalCost) * 100 : 0;
  }
  
  return results;
};

// Calculate economic order quantity (EOQ)
const calculateEOQ = async (productId, destinationLocationId, annualDemand, orgCode) => {
  const settings = await Settings.findOne({ orgCode });
  const holdingCostPercent = settings?.costSimulation?.holdingCostPercent || 15;
  
  const product = await getProduct(productId, orgCode);
  const unitCost = product.standardCost || 0;
  const holdingCostPerUnit = unitCost * (holdingCostPercent / 100);
  
  const offer = await getBestOfferForProduct(productId, 1, destinationLocationId, 'routine', orgCode);
  const orderCost = offer?.supplyOffer?.handlingCostPerUnit || 500;
  
  const eoq = Math.sqrt((2 * annualDemand * orderCost) / Math.max(0.01, holdingCostPerUnit));
  const roundedEoq = Math.round(eoq);
  
  const eoqCost = await calculateCostForQuantity(productId, roundedEoq, destinationLocationId, orgCode);
  const currentCost = await calculateCostForQuantity(productId, 100, destinationLocationId, orgCode);
  
  return {
    eoq: roundedEoq,
    orderCost,
    holdingCostPerUnit,
    estimatedSavings: Math.max(0, currentCost.totalCost - eoqCost.totalCost),
    annualDemand,
    currency: eoqCost.currency
  };
};

// Simulate a what-if scenario
const simulateScenario = async (params, orgCode) => {
  const { productId, quantity, destinationLocationId, urgency = 'routine', supplierId = null } = params;
  
  const product = await getProduct(productId, orgCode);
  const settings = await Settings.findOne({ orgCode });
  const orgSettings = await OrganizationSettings.findOne({ orgCode });
  
  const currency = orgSettings?.region?.defaultCurrency || 'KES';
  const holdingCostPercent = settings?.costSimulation?.holdingCostPercent || 15;
  
  let result = null;
  let supplierInfo = null;
  
  if (supplierId) {
    const resolvedDestination = await resolveDestinationLocation(destinationLocationId, orgCode);
    const context = {
      quantity,
      destinationLocationId: resolvedDestination.id,
      urgency,
      currency: 'USD',
      asOfDate: new Date(),
      riskTolerance: 'medium'
    };
    
    const rankedOffers = await SupplyOffer.getRankedOffers(productId, context, null, null);
    const supplierOffer = rankedOffers.find(r => r.supplyOffer.supplierId?.toString() === supplierId);
    
    if (supplierOffer) {
      result = {
        totalCost: supplierOffer.totalLandedCost,
        perUnitCost: supplierOffer.costPerUnit,
        productCost: supplierOffer.supplierCost,
        transportCost: supplierOffer.transportCost,
        leadTime: supplierOffer.effectiveLeadTime,
        reliability: supplierOffer.reliabilityScore
      };
      supplierInfo = {
        id: supplierOffer.supplyOffer.supplierId?._id,
        name: supplierOffer.supplyOffer.supplierId?.name
      };
    }
  }
  
  if (!result) {
    const baseCost = await calculateCostForQuantity(productId, quantity, destinationLocationId, orgCode);
    result = {
      totalCost: baseCost.totalCost,
      perUnitCost: baseCost.perUnitCost,
      productCost: baseCost.productCost,
      transportCost: baseCost.transportCost,
      leadTime: baseCost.leadTime || 5,
      reliability: baseCost.reliability || 95
    };
  }
  
  const holdingCost = result.totalCost * (holdingCostPercent / 100);
  
  return {
    product: {
      id: product._id,
      name: product.name,
      sku: product.sku
    },
    supplier: supplierInfo,
    quantity,
    destinationLocationId,
    urgency,
    currency,
    cost: {
      total: result.totalCost,
      perUnit: result.perUnitCost,
      productCost: result.productCost,
      transportCost: result.transportCost,
      holdingCost
    },
    logistics: {
      leadTimeDays: result.leadTime,
      reliability: result.reliability
    },
    timestamp: new Date()
  };
};

// Save scenario
const saveScenario = async (data, orgCode, userId) => {
  const scenarioId = `SC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  const scenario = new CostScenario({
    scenarioId,
    orgCode,
    name: data.name,
    description: data.description,
    productId: data.productId,
    supplierId: data.supplierId || null,
    quantity: data.quantity,
    destinationLocationId: data.destinationLocationId,
    urgency: data.urgency || 'routine',
    currency: data.currency || 'KES',
    compareQuantities: data.compareQuantities || [],
    compareSuppliers: data.compareSuppliers || [],
    results: data.results,
    createdBy: userId,
    updatedBy: userId
  });
  
  await scenario.save();
  return scenario;
};

// Get scenarios
const getScenarios = async (orgCode, productId = null, limit = 50) => {
  const query = { orgCode, isActive: true };
  if (productId) query.productId = productId;
  
  const scenarios = await CostScenario.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('productId', 'name sku')
    .populate('supplierId', 'name supplierCode');
  
  return scenarios;
};

// Delete scenario
const deleteScenario = async (scenarioId, orgCode) => {
  const scenario = await CostScenario.findOneAndUpdate(
    { scenarioId, orgCode },
    { isActive: false },
    { new: true }
  );
  
  if (!scenario) throw new Error('Scenario not found');
  return scenario;
};

// Get scenario by ID
const getScenarioById = async (scenarioId, orgCode) => {
  const scenario = await CostScenario.findOne({ scenarioId, orgCode, isActive: true })
    .populate('productId', 'name sku standardCost')
    .populate('supplierId', 'name supplierCode');
  
  if (!scenario) throw new Error('Scenario not found');
  return scenario;
};

// ==================== TRANSFER COST COMPARISON ====================

// Compare transfer costs between different branch routes
const compareTransferRoutes = async (productId, quantity, fromBranchId, toBranchIds, orgCode) => {
  const results = [];
  const product = await getProduct(productId, orgCode);
  const settings = await Settings.findOne({ orgCode });
  const orgSettings = await OrganizationSettings.findOne({ orgCode });
  
  const currency = orgSettings?.region?.defaultCurrency || 'KES';
  const fuelCostPerKm = settings?.logistics?.fuelCostPerKm || 150;
  
  // Get source branch coordinates
  const Branch = mongoose.model('Branch');
  const sourceBranch = await Branch.findOne({ branchId: fromBranchId, orgCode });
  
  if (!sourceBranch || !sourceBranch.coordinates) {
    throw new Error(`Source branch ${fromBranchId} not found or missing coordinates`);
  }
  
  for (const toBranchId of toBranchIds) {
    const destBranch = await Branch.findOne({ branchId: toBranchId, orgCode });
    
    if (!destBranch || !destBranch.coordinates) {
      results.push({
        toBranchId,
        error: 'Branch not found or missing coordinates',
        valid: false
      });
      continue;
    }
    
    // Calculate distance
    const distance = await calculateDrivingDistance(
      sourceBranch.coordinates.lat,
      sourceBranch.coordinates.lng,
      destBranch.coordinates.lat,
      destBranch.coordinates.lng
    );
    
    // Calculate transfer cost
    const distanceKm = distance?.distanceKm || 0;
    const transportCost = distanceKm * fuelCostPerKm;
    const productValue = (product.standardCost || 0) * quantity;
    const holdingCostPercent = settings?.costSimulation?.holdingCostPercent || 15;
    const holdingCost = productValue * (holdingCostPercent / 100);
    const totalCost = transportCost + productValue + holdingCost;
    
    results.push({
      toBranchId: destBranch.branchId,
      toBranchName: destBranch.branchName,
      distanceKm,
      transportCost,
      productValue,
      holdingCost,
      totalCost,
      estimatedDurationHours: distance?.durationHours || 0,
      valid: true
    });
  }
  
  // Sort by total cost (lowest first)
  results.sort((a, b) => (a.totalCost || Infinity) - (b.totalCost || Infinity));
  
  // Calculate savings compared to most expensive
  const validResults = results.filter(r => r.valid);
  if (validResults.length > 1) {
    const best = validResults[0];
    const worst = validResults[validResults.length - 1];
    best.savings = worst.totalCost - best.totalCost;
    best.savingsPercent = (best.savings / worst.totalCost) * 100;
  }
  
  return {
    sourceBranchId: fromBranchId,
    sourceBranchName: sourceBranch.branchName,
    product: {
      id: product._id,
      name: product.name,
      sku: product.sku
    },
    quantity,
    currency,
    results,
    bestRoute: validResults.find(r => r.valid) || null,
    recommendations: validResults.map(r => ({
      toBranch: r.toBranchName,
      cost: r.totalCost,
      isBest: r === validResults[0]
    }))
  };
};

// Get transfer chart data
const getTransferChartData = async (productId, quantity, fromBranchId, toBranchIds, orgCode) => {
  const comparison = await compareTransferRoutes(productId, quantity, fromBranchId, toBranchIds, orgCode);
  
  // Format for bar chart
  const chartData = comparison.results
    .filter(r => r.valid)
    .map(r => ({
      branchName: r.toBranchName,
      transportCost: r.transportCost,
      productValue: r.productValue,
      holdingCost: r.holdingCost,
      totalCost: r.totalCost,
      distanceKm: r.distanceKm
    }));
  
  return {
    chartData,
    bestRoute: comparison.bestRoute,
    source: {
      branchId: comparison.sourceBranchId,
      branchName: comparison.sourceBranchName
    },
    product: comparison.product,
    quantity: comparison.quantity,
    currency: comparison.currency
  };
};

module.exports = {
  getProduct,
  getBestOfferForProduct,
  calculateCostForQuantity,
  compareQuantities,
  compareSuppliers,
  calculateEOQ,
  simulateScenario,
  saveScenario,
  getScenarios,
  getScenarioById,
  deleteScenario,
  resolveDestinationLocation,
  compareTransferRoutes,
  getTransferChartData
};