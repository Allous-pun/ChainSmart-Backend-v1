const express = require('express');
const router = express.Router();
const organizationController = require('./controller');
const { authenticate, requireOrgCode, requirePermission } = require('../../middleware/auth');

// Public route (no auth needed for registration)
router.post('/register', organizationController.register);

// Protected routes (require auth + orgCode + permission)
router.get('/', authenticate, requireOrgCode, requirePermission('edit_settings'), organizationController.getOrg);
router.put('/', authenticate, requireOrgCode, requirePermission('edit_settings'), organizationController.updateOrg);

module.exports = router;