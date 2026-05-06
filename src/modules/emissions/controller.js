const mongoose = require('mongoose');
const emissionsService = require('./service');
const { EmissionRecord, SupplierCarbon, MonthlyEmissionSummary } = require('./model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

// Get emissions settings
const getSettings = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const settings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    res.json({
      success: true,
      data: {
        co2FactorPerKm: settings?.emissions?.co2FactorPerKm || 0.12,
        fuelTypes: settings?.emissions?.fuelTypes || [],
        reportingUnit: settings?.emissions?.reportingUnit || 'kg',
        currency: orgSettings?.region?.defaultCurrency || 'KES'
      }
    });
  } catch (error) {
    console.error('Get emissions settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Calculate emissions for a shipment
const calculateShipmentEmissions = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { shipmentId } = req.params;
    
    const Shipment = mongoose.model('Shipment');
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    
    if (!shipment) {
      return res.status(404).json({ success: false, error: 'Shipment not found' });
    }
    
    const result = await emissionsService.calculateShipmentEmissions(shipment, orgCode);
    
    // Save record
    const record = await emissionsService.saveEmissionRecord({
      referenceId: shipmentId,
      referenceType: 'shipment',
      productId: shipment.items?.[0]?.productId,
      quantity: shipment.items?.reduce((s, i) => s + i.quantity, 0),
      weightKg: shipment.totalWeight,
      fromLocationId: shipment.originLocationId,
      toLocationId: shipment.destinationLocationId,
      distanceKm: result.distanceKm,
      transportMode: 'road',
      co2Emitted: result.co2Emitted,
      co2PerKm: result.co2PerKm,
      co2PerUnit: result.co2PerUnit,
      calculationMethod: result.calculationMethod
    }, orgCode, req.user.id);
    
    // Update monthly summary
    await emissionsService.updateMonthlySummary(orgCode, new Date().getFullYear(), new Date().getMonth() + 1, {
      co2Emitted: result.co2Emitted,
      referenceType: 'shipment',
      transportMode: 'road'
    });
    
    res.json({
      success: true,
      data: { ...result, recordId: record.recordId }
    });
  } catch (error) {
    console.error('Calculate shipment emissions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get emissions for a shipment
const getShipmentEmissions = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { shipmentId } = req.params;
    
    const record = await emissionsService.getEmissionByReference(shipmentId, 'shipment', orgCode);
    
    if (!record) {
      return res.status(404).json({ success: false, error: 'No emissions record found for this shipment' });
    }
    
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Get shipment emissions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Calculate emissions for a transfer
const calculateTransferEmissions = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { transferId } = req.params;
    
    const Transfer = mongoose.model('Transfer');
    const transfer = await Transfer.findOne({ _id: transferId, orgCode });
    
    if (!transfer) {
      return res.status(404).json({ success: false, error: 'Transfer not found' });
    }
    
    const result = await emissionsService.calculateTransferEmissions(transfer, orgCode);
    
    const record = await emissionsService.saveEmissionRecord({
      referenceId: transferId,
      referenceType: 'transfer',
      productId: transfer.items?.[0]?.productId,
      quantity: transfer.items?.reduce((s, i) => s + i.quantity, 0),
      fromLocationId: transfer.fromWarehouseId,
      toLocationId: transfer.toWarehouseId,
      distanceKm: result.distanceKm,
      transportMode: 'road',
      co2Emitted: result.co2Emitted,
      co2PerKm: result.co2PerKm,
      calculationMethod: result.calculationMethod
    }, orgCode, req.user.id);
    
    await emissionsService.updateMonthlySummary(orgCode, new Date().getFullYear(), new Date().getMonth() + 1, {
      co2Emitted: result.co2Emitted,
      referenceType: 'transfer',
      transportMode: 'road'
    });
    
    res.json({
      success: true,
      data: { ...result, recordId: record.recordId }
    });
  } catch (error) {
    console.error('Calculate transfer emissions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get supplier carbon score
const getSupplierCarbonScore = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { supplierId } = req.params;
    
    const carbon = await emissionsService.getSupplierCarbonScore(supplierId, orgCode);
    res.json({ success: true, data: carbon });
  } catch (error) {
    console.error('Get supplier carbon score error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update supplier carbon score
const updateSupplierCarbonScore = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { supplierId } = req.params;
    const data = req.body;
    
    const carbon = await emissionsService.updateSupplierCarbonScore(supplierId, orgCode, data);
    res.json({ success: true, data: carbon, message: 'Supplier carbon score updated' });
  } catch (error) {
    console.error('Update supplier carbon score error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get emissions dashboard
const getDashboard = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { days } = req.query;
    
    const dashboard = await emissionsService.getEmissionsDashboard(orgCode, days ? parseInt(days) : 30);
    res.json({ success: true, data: dashboard });
  } catch (error) {
    console.error('Get emissions dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Generate emissions report
const generateReport = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate required' });
    }
    
    const report = await emissionsService.generateEmissionsReport(
      orgCode,
      new Date(startDate),
      new Date(endDate)
    );
    
    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Generate emissions report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get emissions records
const getRecords = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { referenceType, limit, skip } = req.query;
    
    const query = { orgCode };
    if (referenceType) query.referenceType = referenceType;
    
    const records = await EmissionRecord.find(query)
      .sort({ calculatedAt: -1 })
      .limit(limit ? parseInt(limit) : 50)
      .skip(skip ? parseInt(skip) : 0);
    
    const total = await EmissionRecord.countDocuments(query);
    
    res.json({ success: true, data: { records, total, limit: limit || 50, skip: skip || 0 } });
  } catch (error) {
    console.error('Get emissions records error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Chart: Monthly trend
const getMonthlyTrend = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { year } = req.query;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    
    const summaries = await MonthlyEmissionSummary.find({
      orgCode,
      year: targetYear
    }).sort({ month: 1 });
    
    const chartData = summaries.map(s => ({
      month: s.month,
      totalCO2: s.totalCO2,
      shipment: s.byType.shipment,
      transfer: s.byType.transfer,
      purchase_order: s.byType.purchase_order
    }));
    
    res.json({ success: true, data: { year: targetYear, chartData } });
  } catch (error) {
    console.error('Get monthly trend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Chart: By type pie
const getByTypePie = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { days } = req.query;
    const dashboard = await emissionsService.getEmissionsDashboard(orgCode, days ? parseInt(days) : 30);
    
    const pieData = [
      { name: 'Shipments', value: dashboard.byType.shipment, color: '#3b82f6' },
      { name: 'Transfers', value: dashboard.byType.transfer, color: '#f59e0b' },
      { name: 'Purchase Orders', value: dashboard.byType.purchase_order, color: '#10b981' }
    ].filter(p => p.value > 0);
    
    res.json({ success: true, data: pieData });
  } catch (error) {
    console.error('Get by type pie error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Chart: Daily trend
const getDailyTrend = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { days } = req.query;
    const dashboard = await emissionsService.getEmissionsDashboard(orgCode, days ? parseInt(days) : 30);
    res.json({ success: true, data: dashboard.dailyTrend });
  } catch (error) {
    console.error('Get daily trend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getSettings,
  calculateShipmentEmissions,
  getShipmentEmissions,
  calculateTransferEmissions,
  getSupplierCarbonScore,
  updateSupplierCarbonScore,
  getDashboard,
  generateReport,
  getRecords,
  getMonthlyTrend,
  getByTypePie,
  getDailyTrend
};