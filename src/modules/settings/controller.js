const settingsService = require('./service');

const getSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const settings = await settingsService.getSettings(orgCode);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const updateData = req.body;
    
    const settings = await settingsService.updateSettings(orgCode, updateData, userId);
    res.json({ success: true, data: settings, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateInventorySettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'inventory', data, userId);
    res.json({ success: true, data: settings, message: 'Inventory settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateProcurementSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'procurement', data, userId);
    res.json({ success: true, data: settings, message: 'Procurement settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateSupplierSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'supplier', data, userId);
    res.json({ success: true, data: settings, message: 'Supplier settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateLogisticsSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'logistics', data, userId);
    res.json({ success: true, data: settings, message: 'Logistics settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateCostSimulationSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'costSimulation', data, userId);
    res.json({ success: true, data: settings, message: 'Cost simulation settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateEmissionsSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'emissions', data, userId);
    res.json({ success: true, data: settings, message: 'Emissions settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateReportsSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'reports', data, userId);
    res.json({ success: true, data: settings, message: 'Reports settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateGlobalSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const data = req.body;
    
    const settings = await settingsService.updatePillarSettings(orgCode, 'global', data, userId);
    res.json({ success: true, data: settings, message: 'Global settings updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  updateInventorySettings,
  updateProcurementSettings,
  updateSupplierSettings,
  updateLogisticsSettings,
  updateCostSimulationSettings,
  updateEmissionsSettings,
  updateReportsSettings,
  updateGlobalSettings
};