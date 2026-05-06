const reportsService = require('./service');

const getSpendAnalysis = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { period, startDate, endDate, groupBy } = req.query;
    
    const result = await reportsService.getSpendAnalysis(
      orgCode,
      period || 'month',
      startDate || null,
      endDate || null,
      groupBy || 'supplier'
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get spend analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getSupplierPerformance = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { supplierId } = req.query;
    
    const result = await reportsService.getSupplierPerformance(orgCode, supplierId || null);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get supplier performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getInventoryTurnover = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { locationId } = req.query;
    
    const result = await reportsService.getInventoryTurnover(orgCode, locationId || null);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get inventory turnover error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getWasteTrends = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { locationId, period } = req.query;
    
    const result = await reportsService.getWasteTrends(
      orgCode,
      locationId || null,
      period || 'month'
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get waste trends error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getSavingsReport = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { period } = req.query;
    
    const result = await reportsService.getSavingsReport(orgCode, period || 'month');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get savings report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getEmissionsSummary = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { period } = req.query;
    
    const result = await reportsService.getEmissionsSummary(orgCode, period || 'month');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get emissions summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getLogisticsPerformance = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { period } = req.query;
    
    const result = await reportsService.getLogisticsPerformance(orgCode, period || 'month');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get logistics performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getDashboard = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { period } = req.query;
    
    const result = await reportsService.getDashboard(orgCode, period || 'month');
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getSpendAnalysis,
  getSupplierPerformance,
  getInventoryTurnover,
  getWasteTrends,
  getSavingsReport,
  getEmissionsSummary,
  getLogisticsPerformance,
  getDashboard
};