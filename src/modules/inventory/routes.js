const express = require('express');
const router = express.Router();
const inventoryController = require('./controller');
const stockController = require('./stockController');
const transactionController = require('./transactionController');
const purchaseOrderController = require('./purchaseOrderController');
const transferController = require('./transferController');
const warehouseController = require('./warehouseController');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// ============ STOCK ROUTES ============
router.get('/stock', requirePermission('view_inventory'), stockController.getStock);
router.get('/stock/:stockId', requirePermission('view_inventory'), stockController.getStockById);
router.post('/stock', requirePermission('edit_inventory'), stockController.createOrUpdateStock);
router.post('/stock/:stockId/adjust', requirePermission('edit_inventory'), stockController.adjustStock);

// ============ TRANSACTION ROUTES ============
router.get('/transactions', requirePermission('view_inventory'), transactionController.getTransactions);
router.post('/transactions', requirePermission('edit_inventory'), transactionController.recordTransaction);

// ============ PURCHASE ORDER ROUTES ============
router.get('/purchase-orders', requirePermission('view_procurement'), purchaseOrderController.getPurchaseOrders);
router.get('/purchase-orders/:poId', requirePermission('view_procurement'), purchaseOrderController.getPurchaseOrderById);
router.post('/purchase-orders', requirePermission('create_purchase_order'), purchaseOrderController.createPurchaseOrder);
router.put('/purchase-orders/:poId/status', requirePermission('edit_procurement'), purchaseOrderController.updatePurchaseOrderStatus);

// ============ TRANSFER ROUTES ============
router.get('/transfers', requirePermission('view_inventory'), transferController.getTransfers);
router.get('/transfers/:transferId', requirePermission('view_inventory'), transferController.getTransferById);
router.post('/transfers', requirePermission('edit_inventory'), transferController.createTransfer);
router.put('/transfers/:transferId/status', requirePermission('edit_inventory'), transferController.updateTransferStatus);

// ============ WAREHOUSE ROUTES ============
router.get('/warehouses', requirePermission('view_inventory'), warehouseController.getWarehouses);
router.get('/warehouses/:warehouseId', requirePermission('view_inventory'), warehouseController.getWarehouseById);
router.post('/warehouses', requirePermission('edit_settings'), warehouseController.createWarehouse);
router.put('/warehouses/:warehouseId', requirePermission('edit_settings'), warehouseController.updateWarehouse);
router.delete('/warehouses/:warehouseId', requirePermission('edit_settings'), warehouseController.deleteWarehouse);

// ============ FORECAST & HEALTH ROUTES ============
router.get('/health', requirePermission('view_inventory'), inventoryController.getHealthReport);
router.get('/forecast', requirePermission('view_inventory'), inventoryController.getForecast);
router.post('/forecast/refresh', requirePermission('edit_inventory'), inventoryController.refreshForecast);
router.post('/optimize/batch', requirePermission('edit_inventory'), inventoryController.batchOptimize);

module.exports = router;