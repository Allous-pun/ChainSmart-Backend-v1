const express = require('express');
const router = express.Router();
const supplierController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// ============ SUPPLIER LOCATIONS (MUST COME BEFORE /:supplierId) ============
router.post('/locations', requirePermission('edit_supplier'), supplierController.addLocation);
router.get('/locations', requirePermission('view_suppliers'), supplierController.getLocations);

// ============ SUPPLY OFFERS (MUST COME BEFORE /:supplierId) ============
router.post('/offers', requirePermission('create_purchase_plan'), supplierController.createSupplyOffer);
router.get('/offers', requirePermission('view_procurement'), supplierController.getSupplyOffers);
router.put('/offers/:offerId', requirePermission('edit_supplier'), supplierController.updateSupplyOffer);

// ============ SOURCING RULES (MUST COME BEFORE /:supplierId) ============
router.post('/rules', requirePermission('edit_settings'), supplierController.createSourcingRule);
router.get('/rules', requirePermission('view_procurement'), supplierController.getSourcingRules);
router.post('/rules/evaluate/:ruleId', requirePermission('run_cost_simulation'), supplierController.evaluateRules);

// ============ RANKING (MUST COME BEFORE /:supplierId) ============
router.post('/rank/:productId', requirePermission('run_cost_simulation'), supplierController.rankOffers);

// ============ PERFORMANCE ============
router.post('/performance', requirePermission('view_reports'), supplierController.updatePerformance);

// ============ SUPPLIER CRUD (PLACE THESE LAST - THEY CAPTURE /:supplierId) ============
router.post('/', requirePermission('create_supplier'), supplierController.createSupplier);
router.get('/', requirePermission('view_suppliers'), supplierController.getSuppliers);
router.get('/:supplierId', requirePermission('view_suppliers'), supplierController.getSupplier);
router.put('/:supplierId', requirePermission('edit_supplier'), supplierController.updateSupplier);
router.delete('/:supplierId', requirePermission('delete_supplier'), supplierController.deleteSupplier);

module.exports = router;