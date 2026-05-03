const express = require('express');
const router = express.Router();
const logisticsController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// ============ ROUTE PLANNING ============
router.post('/routes/plan', requirePermission('edit_inventory'), logisticsController.planRoute);
router.get('/routes/:routeId/performance', requirePermission('view_reports'), logisticsController.getRoutePerformance);

// ============ SHIPMENT MANAGEMENT ============
router.get('/shipments', requirePermission('view_inventory'), logisticsController.getShipments);
router.get('/shipments/:shipmentId', requirePermission('view_inventory'), logisticsController.getShipment);
router.post('/shipments', requirePermission('edit_inventory'), logisticsController.createShipmentFromRoute);
router.post('/shipments/:shipmentId/dispatch', requirePermission('edit_inventory'), logisticsController.dispatchShipment);
router.post('/shipments/:shipmentId/stops/:stopNumber/complete', requirePermission('edit_inventory'), logisticsController.completeStop);
router.post('/shipments/:shipmentId/deliver', requirePermission('edit_inventory'), logisticsController.completeDelivery);
router.post('/shipments/:shipmentId/cancel', requirePermission('edit_inventory'), logisticsController.cancelShipment);

// ============ TRACKING ============
router.get('/shipments/:shipmentId/tracking', requirePermission('view_inventory'), logisticsController.getTracking);
router.get('/shipments/:shipmentId/eta', requirePermission('view_inventory'), logisticsController.calculateETA);

// ============ VEHICLE MANAGEMENT ============
router.get('/vehicles', requirePermission('view_inventory'), logisticsController.getVehicles);
router.post('/vehicles', requirePermission('edit_settings'), logisticsController.createVehicle);
router.get('/vehicles/available', requirePermission('view_inventory'), logisticsController.getAvailableVehicles);

module.exports = router;