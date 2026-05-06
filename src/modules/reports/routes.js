const express = require('express');
const router = express.Router();
const reportsController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Reports (view only)
router.get('/spend', requirePermission('view_reports'), reportsController.getSpendAnalysis);
router.get('/supplier-performance', requirePermission('view_reports'), reportsController.getSupplierPerformance);
router.get('/inventory-turnover', requirePermission('view_reports'), reportsController.getInventoryTurnover);
router.get('/waste', requirePermission('view_reports'), reportsController.getWasteTrends);
router.get('/savings', requirePermission('view_reports'), reportsController.getSavingsReport);
router.get('/emissions', requirePermission('view_reports'), reportsController.getEmissionsSummary);
router.get('/logistics', requirePermission('view_reports'), reportsController.getLogisticsPerformance);
router.get('/dashboard', requirePermission('view_reports'), reportsController.getDashboard);

module.exports = router;