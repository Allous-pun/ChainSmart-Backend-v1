const express = require('express');
const router = express.Router();
const emissionsController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Settings
router.get('/settings', requirePermission('view_reports'), emissionsController.getSettings);

// Shipment emissions
router.post('/shipment/:shipmentId/calculate', requirePermission('edit_inventory'), emissionsController.calculateShipmentEmissions);
router.get('/shipment/:shipmentId', requirePermission('view_reports'), emissionsController.getShipmentEmissions);

// Transfer emissions
router.post('/transfer/:transferId/calculate', requirePermission('edit_inventory'), emissionsController.calculateTransferEmissions);

// Supplier carbon scores
router.get('/supplier/:supplierId/carbon', requirePermission('view_suppliers'), emissionsController.getSupplierCarbonScore);
router.put('/supplier/:supplierId/carbon', requirePermission('edit_supplier'), emissionsController.updateSupplierCarbonScore);

// Dashboard and reports
router.get('/dashboard', requirePermission('view_reports'), emissionsController.getDashboard);
router.get('/report', requirePermission('export_reports'), emissionsController.generateReport);
router.get('/records', requirePermission('view_reports'), emissionsController.getRecords);

// Chart endpoints
router.get('/charts/monthly-trend', requirePermission('view_reports'), emissionsController.getMonthlyTrend);
router.get('/charts/by-type', requirePermission('view_reports'), emissionsController.getByTypePie);
router.get('/charts/daily-trend', requirePermission('view_reports'), emissionsController.getDailyTrend);

module.exports = router;