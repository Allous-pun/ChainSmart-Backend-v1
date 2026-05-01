const express = require('express');
const router = express.Router();
const rolesController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication and view_users permission (or owner)
router.use(authenticate);

// Get all roles with permissions
router.get('/', requirePermission('view_users'), rolesController.getRoles);

// Get specific role by name
router.get('/:roleName', requirePermission('view_users'), rolesController.getRole);

// Get all available permissions
router.get('/permissions/all', requirePermission('edit_settings'), rolesController.getPermissions);

module.exports = router;