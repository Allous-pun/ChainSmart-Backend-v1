const { OptimizationOrchestrator } = require('./model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

// Initialize orchestrator per request or reuse
const getOrchestrator = (orgCode) => {
  return new OptimizationOrchestrator(orgCode);
};

const refreshForecast = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, locationId, variantId } = req.body;
    
    if (!productId || !locationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, locationId'
      });
    }
    
    const orchestrator = getOrchestrator(orgCode);
    await orchestrator.refreshAll(productId, locationId, variantId || null);
    
    res.json({
      success: true,
      message: 'Forecast recalculated and health updated'
    });
  } catch (error) {
    console.error('Refresh forecast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getHealthReport = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, locationId, limit } = req.query;
    
    // Fetch settings for health report thresholds
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const stockoutRiskAlertDays = pillarSettings?.inventory?.stockoutRiskAlertDays || 3;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const orchestrator = getOrchestrator(orgCode);
    const report = await orchestrator.getHealthReport(
      productId || null,
      locationId || null,
      limit ? parseInt(limit) : 20,
      { stockoutRiskAlertDays, defaultCurrency }
    );
    
    res.json({ 
      success: true, 
      data: report,
      context: {
        stockoutRiskAlertDays,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Get health report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getForecast = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, locationId, variantId } = req.query;
    
    if (!productId || !locationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, locationId'
      });
    }
    
    // Fetch settings for forecast horizon
    const pillarSettings = await Settings.findOne({ orgCode });
    const forecastHorizon = pillarSettings?.inventory?.demandForecastHorizon || 14;
    
    const orchestrator = getOrchestrator(orgCode);
    const forecast = await orchestrator.getForecast(
      productId, 
      locationId, 
      variantId || null,
      { forecastHorizon }
    );
    
    res.json({ 
      success: true, 
      data: forecast,
      context: {
        forecastHorizon
      }
    });
  } catch (error) {
    console.error('Get forecast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const batchOptimize = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    
    // Fetch all relevant settings for batch optimization
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const optimizationConfig = {
      // Inventory settings
      defaultSafetyStockDays: pillarSettings?.inventory?.defaultSafetyStockDays || 7,
      reorderPointThreshold: pillarSettings?.inventory?.reorderPointThreshold || 20,
      demandForecastHorizon: pillarSettings?.inventory?.demandForecastHorizon || 14,
      
      // Procurement settings
      autoApprovalThreshold: pillarSettings?.procurement?.autoApprovalThreshold || 10000,
      defaultLeadTimeDays: pillarSettings?.procurement?.defaultLeadTimeDays || 5,
      
      // Logistics settings
      vehicleCapacity: pillarSettings?.logistics?.vehicleCapacity || 1000,
      fuelCostPerKm: pillarSettings?.logistics?.fuelCostPerKm || 150,
      maxDeliveryStopsPerRoute: pillarSettings?.logistics?.maxDeliveryStopsPerRoute || 10,
      
      // Cost simulation settings
      holdingCostPercent: pillarSettings?.costSimulation?.holdingCostPercent || 15,
      
      // Regional settings
      defaultCurrency: orgSettings?.region?.defaultCurrency || 'KES',
      timezone: orgSettings?.region?.timezone || 'Africa/Nairobi',
      
      // Global settings
      engineAutoRunSchedule: pillarSettings?.global?.engineAutoRunSchedule || 'daily'
    };
    
    const orchestrator = getOrchestrator(orgCode);
    const result = await orchestrator.batchOptimize(optimizationConfig);
    
    res.json({
      success: true,
      data: result,
      message: `Created ${result.transfers.length} transfers and ${result.purchaseOrders.length} purchase orders`,
      context: {
        configUsed: optimizationConfig
      }
    });
  } catch (error) {
    console.error('Batch optimize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  refreshForecast,
  getHealthReport,
  getForecast,
  batchOptimize
};