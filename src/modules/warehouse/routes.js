const express = require('express');
const router = express.Router();
const warehouseController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

router.get('/', requirePermission('view_inventory'), warehouseController.getWarehouses);
router.get('/default', requirePermission('view_inventory'), warehouseController.getDefaultWarehouse);
router.get('/:warehouseId', requirePermission('view_inventory'), warehouseController.getWarehouse);

module.exports = router;
