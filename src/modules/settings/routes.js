const express = require('express');
const router = express.Router();
const settingsController = require('./controller');
const { hasPermission } = require('../../middleware/permission');

// All settings routes require edit_settings permission
router.use(hasPermission('edit_settings'));

// Get all settings
router.get('/', settingsController.getSettings);

// Update entire settings
router.put('/', settingsController.updateSettings);

// Update by pillar
router.put('/inventory', settingsController.updateInventorySettings);
router.put('/procurement', settingsController.updateProcurementSettings);
router.put('/supplier', settingsController.updateSupplierSettings);
router.put('/logistics', settingsController.updateLogisticsSettings);
router.put('/cost-simulation', settingsController.updateCostSimulationSettings);
router.put('/emissions', settingsController.updateEmissionsSettings);
router.put('/reports', settingsController.updateReportsSettings);
router.put('/global', settingsController.updateGlobalSettings);

module.exports = router;