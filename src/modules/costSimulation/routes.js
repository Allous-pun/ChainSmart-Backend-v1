const express = require('express');
const router = express.Router();
const costSimulationController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Settings
router.get('/settings', requirePermission('view_reports'), costSimulationController.getSettings);

// Core simulation endpoints
router.post('/simulate', requirePermission('run_cost_simulation'), costSimulationController.simulateScenario);
router.post('/compare/quantities', requirePermission('run_cost_simulation'), costSimulationController.compareQuantities);
router.post('/compare/suppliers', requirePermission('run_cost_simulation'), costSimulationController.compareSuppliers);
router.post('/eoq', requirePermission('run_cost_simulation'), costSimulationController.calculateEOQ);

// Scenario management
router.post('/scenarios', requirePermission('run_cost_simulation'), costSimulationController.saveScenario);
router.get('/scenarios', requirePermission('view_reports'), costSimulationController.getScenarios);
router.get('/scenarios/:scenarioId', requirePermission('view_reports'), costSimulationController.getScenario);
router.delete('/scenarios/:scenarioId', requirePermission('run_cost_simulation'), costSimulationController.deleteScenario);

// Chart data endpoints
router.post('/charts/cost-vs-quantity', requirePermission('view_reports'), costSimulationController.getCostVsQuantityChart);
router.post('/charts/supplier-comparison', requirePermission('view_reports'), costSimulationController.getSupplierComparisonChart);
router.post('/charts/cost-breakdown', requirePermission('view_reports'), costSimulationController.getCostBreakdown);
router.post('/charts/eoq', requirePermission('view_reports'), costSimulationController.getEOQChart);

// Transfer optimization endpoints
router.post('/transfer/compare', requirePermission('run_cost_simulation'), costSimulationController.compareTransferRoutes);
router.post('/charts/transfer', requirePermission('view_reports'), costSimulationController.getTransferChart);

module.exports = router;