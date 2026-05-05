const costSimulationService = require('./service');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

// Get cost simulation settings
const getSettings = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const settings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    res.json({
      success: true,
      data: {
        holdingCostPercent: settings?.costSimulation?.holdingCostPercent || 15,
        urgentShippingMarkupPercent: settings?.costSimulation?.urgentShippingMarkupPercent || 50,
        discountTiers: settings?.costSimulation?.discountTiers || [],
        currency: orgSettings?.region?.defaultCurrency || 'KES'
      }
    });
  } catch (error) {
    console.error('Get cost settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Compare different quantities
const compareQuantities = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, baseQuantity, quantities, destinationLocationId } = req.body;
    
    if (!productId || !baseQuantity || !quantities || !destinationLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, baseQuantity, quantities, destinationLocationId'
      });
    }
    
    const result = await costSimulationService.compareQuantities(
      productId, baseQuantity, quantities, destinationLocationId, orgCode
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Compare quantities error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Compare different suppliers
const compareSuppliers = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, destinationLocationId, supplierIds } = req.body;
    
    if (!productId || !quantity || !destinationLocationId || !supplierIds) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, destinationLocationId, supplierIds'
      });
    }
    
    const result = await costSimulationService.compareSuppliers(
      productId, quantity, destinationLocationId, supplierIds, orgCode
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Compare suppliers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Calculate EOQ (Economic Order Quantity)
const calculateEOQ = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, destinationLocationId, annualDemand } = req.body;
    
    if (!productId || !destinationLocationId || !annualDemand) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, destinationLocationId, annualDemand'
      });
    }
    
    const result = await costSimulationService.calculateEOQ(
      productId, destinationLocationId, annualDemand, orgCode
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Calculate EOQ error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Simulate a what-if scenario
const simulateScenario = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, destinationLocationId, urgency, supplierId } = req.body;
    
    if (!productId || !quantity || !destinationLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, destinationLocationId'
      });
    }
    
    const result = await costSimulationService.simulateScenario({
      productId,
      quantity,
      destinationLocationId,
      urgency: urgency || 'routine',
      supplierId
    }, orgCode);
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Simulate scenario error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Save scenario
const saveScenario = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const data = req.body;
    
    if (!data.name || !data.productId || !data.quantity || !data.destinationLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, productId, quantity, destinationLocationId'
      });
    }
    
    const scenario = await costSimulationService.saveScenario(data, orgCode, userId);
    
    res.status(201).json({
      success: true,
      data: scenario,
      message: `Scenario "${data.name}" saved successfully`
    });
  } catch (error) {
    console.error('Save scenario error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get scenarios
const getScenarios = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, limit } = req.query;
    
    const scenarios = await costSimulationService.getScenarios(
      orgCode,
      productId,
      limit ? parseInt(limit) : 50
    );
    
    res.json({ success: true, data: scenarios });
  } catch (error) {
    console.error('Get scenarios error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get scenario by ID
const getScenario = async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const orgCode = req.user.orgCode;
    
    const scenario = await costSimulationService.getScenarioById(scenarioId, orgCode);
    
    res.json({ success: true, data: scenario });
  } catch (error) {
    console.error('Get scenario error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

// Delete scenario
const deleteScenario = async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const orgCode = req.user.orgCode;
    
    const scenario = await costSimulationService.deleteScenario(scenarioId, orgCode);
    
    res.json({
      success: true,
      data: scenario,
      message: 'Scenario deleted successfully'
    });
  } catch (error) {
    console.error('Delete scenario error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

// ==================== CHART/VIZ ENDPOINTS ====================

// Get chart data for cost vs quantity comparison
const getCostVsQuantityChart = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, destinationLocationId, minQuantity, maxQuantity, step } = req.body;
    
    if (!productId || !destinationLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, destinationLocationId'
      });
    }
    
    const startQty = minQuantity || 100;
    const endQty = maxQuantity || 2000;
    const stepSize = step || 100;
    
    const quantities = [];
    for (let qty = startQty; qty <= endQty; qty += stepSize) {
      quantities.push(qty);
    }
    
    const results = [];
    for (const qty of quantities) {
      const cost = await costSimulationService.calculateCostForQuantity(
        productId, qty, destinationLocationId, orgCode
      );
      results.push({
        quantity: qty,
        totalCost: cost.totalCost,
        perUnitCost: cost.perUnitCost,
        productCost: cost.productCost,
        transportCost: cost.transportCost,
        holdingCost: cost.holdingCost
      });
    }
    
    // Find best quantity (lowest per unit cost)
    const bestPerUnit = results.reduce((best, current) => 
      current.perUnitCost < best.perUnitCost ? current : best, results[0]);
    
    // Calculate savings from minimum quantity
    const minQtyResult = results[0];
    const maxSavings = minQtyResult.totalCost - bestPerUnit.totalCost;
    const maxSavingsPercent = (maxSavings / minQtyResult.totalCost) * 100;
    
    res.json({
      success: true,
      data: {
        chartData: results,
        bestQuantity: {
          quantity: bestPerUnit.quantity,
          perUnitCost: bestPerUnit.perUnitCost,
          totalCost: bestPerUnit.totalCost,
          savings: maxSavings,
          savingsPercent: maxSavingsPercent
        },
        summary: {
          minQuantity: startQty,
          maxQuantity: endQty,
          totalPoints: results.length,
          economyOfScale: bestPerUnit.perUnitCost < results[0].perUnitCost
        }
      }
    });
  } catch (error) {
    console.error('Get cost vs quantity chart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get chart data for supplier comparison
const getSupplierComparisonChart = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, destinationLocationId, supplierIds } = req.body;
    
    if (!productId || !quantity || !destinationLocationId || !supplierIds) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, destinationLocationId, supplierIds'
      });
    }
    
    const results = await costSimulationService.compareSuppliers(
      productId, quantity, destinationLocationId, supplierIds, orgCode
    );
    
    // Format for bar chart
    const chartData = results.map(r => ({
      supplierName: r.supplierName,
      totalCost: r.totalCost,
      perUnitCost: r.perUnitCost,
      transportCost: r.transportCost,
      productCost: r.productCost,
      leadTime: r.leadTime,
      reliability: r.reliability
    }));
    
    // Find best supplier
    const bestSupplier = chartData.length > 0 ? chartData[0] : null;
    const worstSupplier = chartData.length > 1 ? chartData[chartData.length - 1] : null;
    const savings = bestSupplier && worstSupplier ? worstSupplier.totalCost - bestSupplier.totalCost : 0;
    
    res.json({
      success: true,
      data: {
        chartData,
        bestSupplier,
        worstSupplier,
        savings: {
          amount: savings,
          percent: bestSupplier && worstSupplier ? (savings / worstSupplier.totalCost) * 100 : 0
        },
        totalSuppliers: results.length
      }
    });
  } catch (error) {
    console.error('Get supplier comparison chart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get cost breakdown pie chart data
const getCostBreakdown = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, destinationLocationId, urgency } = req.body;
    
    if (!productId || !quantity || !destinationLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, destinationLocationId'
      });
    }
    
    const result = await costSimulationService.simulateScenario({
      productId,
      quantity,
      destinationLocationId,
      urgency: urgency || 'routine'
    }, orgCode);
    
    // Format for pie chart
    const breakdown = [
      { name: 'Product Cost', value: result.cost.productCost, color: '#3b82f6' },
      { name: 'Transport Cost', value: result.cost.transportCost, color: '#f59e0b' },
      { name: 'Holding Cost', value: result.cost.holdingCost, color: '#10b981' }
    ];
    
    res.json({
      success: true,
      data: {
        breakdown,
        total: result.cost.total,
        perUnit: result.cost.perUnit,
        product: result.product,
        quantity: result.quantity,
        currency: result.currency
      }
    });
  } catch (error) {
    console.error('Get cost breakdown error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get EOQ chart data (cost curves)
const getEOQChart = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, destinationLocationId, annualDemand, minQty, maxQty } = req.body;
    
    if (!productId || !destinationLocationId || !annualDemand) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, destinationLocationId, annualDemand'
      });
    }
    
    const startQty = minQty || 100;
    const endQty = maxQty || 5000;
    const step = 100;
    
    const settings = await Settings.findOne({ orgCode });
    const holdingCostPercent = settings?.costSimulation?.holdingCostPercent || 15;
    
    const product = await costSimulationService.getProduct(productId, orgCode);
    const unitCost = product.standardCost || 0;
    const holdingCostPerUnit = unitCost * (holdingCostPercent / 100);
    
    const offer = await costSimulationService.getBestOfferForProduct(productId, 1, destinationLocationId, 'routine', orgCode);
    const orderCost = offer?.supplyOffer?.handlingCostPerUnit || 500;
    
    const results = [];
    for (let qty = startQty; qty <= endQty; qty += step) {
      const numberOfOrders = annualDemand / qty;
      const orderCostTotal = numberOfOrders * orderCost;
      const averageInventory = qty / 2;
      const holdingCostTotal = averageInventory * holdingCostPerUnit;
      const totalCost = orderCostTotal + holdingCostTotal;
      
      results.push({
        quantity: qty,
        orderCost: orderCostTotal,
        holdingCost: holdingCostTotal,
        totalCost: totalCost
      });
    }
    
    // Find EOQ (minimum total cost)
    const eoqPoint = results.reduce((best, current) => 
      current.totalCost < best.totalCost ? current : best, results[0]);
    
    res.json({
      success: true,
      data: {
        chartData: results,
        eoq: {
          quantity: eoqPoint.quantity,
          totalCost: eoqPoint.totalCost,
          orderCost: eoqPoint.orderCost,
          holdingCost: eoqPoint.holdingCost
        },
        parameters: {
          annualDemand,
          orderCost,
          holdingCostPerUnit,
          unitCost,
          holdingCostPercent
        }
      }
    });
  } catch (error) {
    console.error('Get EOQ chart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== TRANSFER ROUTE COMPARISON ENDPOINTS ====================

// Compare transfer routes between branches
const compareTransferRoutes = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, fromBranchId, toBranchIds } = req.body;
    
    if (!productId || !quantity || !fromBranchId || !toBranchIds || toBranchIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, fromBranchId, toBranchIds'
      });
    }
    
    const result = await costSimulationService.compareTransferRoutes(
      productId, quantity, fromBranchId, toBranchIds, orgCode
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Compare transfer routes error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get transfer chart data
const getTransferChart = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, quantity, fromBranchId, toBranchIds } = req.body;
    
    if (!productId || !quantity || !fromBranchId || !toBranchIds || toBranchIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, quantity, fromBranchId, toBranchIds'
      });
    }
    
    const result = await costSimulationService.getTransferChartData(
      productId, quantity, fromBranchId, toBranchIds, orgCode
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get transfer chart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getSettings,
  compareQuantities,
  compareSuppliers,
  calculateEOQ,
  simulateScenario,
  saveScenario,
  getScenarios,
  getScenario,
  deleteScenario,
  getCostVsQuantityChart,
  getSupplierComparisonChart,
  getCostBreakdown,
  getEOQChart,
  compareTransferRoutes,
  getTransferChart
};