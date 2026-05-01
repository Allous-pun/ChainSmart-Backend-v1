const express = require('express');
const router = express.Router();
const productController = require('./controller');
const categoryController = require('./categoryController');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

/* ================================
   CATEGORY ROUTES
   ================================ */
router.post('/categories', requirePermission('edit_settings'), categoryController.createCategory);
router.get('/categories', requirePermission('view_inventory'), categoryController.getCategories);
router.get('/categories/:categoryId', requirePermission('view_inventory'), categoryController.getCategory);
router.put('/categories/:categoryId', requirePermission('edit_settings'), categoryController.updateCategory);
router.delete('/categories/:categoryId', requirePermission('edit_settings'), categoryController.deleteCategory);
router.get('/categories/:categoryId/tree', requirePermission('view_inventory'), categoryController.getCategoryTree);

/* ================================
   PRODUCT ROUTES
   ================================ */
// Product management
router.post('/', requirePermission('create_inventory'), productController.createProduct);
router.get('/', requirePermission('view_inventory'), productController.getProducts);
router.get('/sku/:sku', requirePermission('view_inventory'), productController.getProductBySku);
router.get('/:productId', requirePermission('view_inventory'), productController.getProduct);
router.put('/:productId', requirePermission('edit_inventory'), productController.updateProduct);
router.delete('/:productId', requirePermission('delete_inventory'), productController.deleteProduct);

// Product by category
router.get('/category/:categoryId', requirePermission('view_inventory'), productController.getProductsByCategory);

// Variant management
router.post('/:productId/variants', requirePermission('edit_inventory'), productController.addVariant);
router.put('/:productId/variants/:variantSku', requirePermission('edit_inventory'), productController.updateVariant);
router.delete('/:productId/variants/:variantSku', requirePermission('edit_inventory'), productController.removeVariant);

// Attributes management
router.post('/:productId/attributes', requirePermission('edit_inventory'), productController.addAttribute);
router.put('/:productId/attributes/:attributeKey', requirePermission('edit_inventory'), productController.updateAttribute);
router.delete('/:productId/attributes/:attributeKey', requirePermission('edit_inventory'), productController.removeAttribute);

module.exports = router;
