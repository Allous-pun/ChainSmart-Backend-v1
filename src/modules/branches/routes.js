const express = require('express');
const router = express.Router();
const branchController = require('./controller');
const { authenticate, requirePermission } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Branch management (requires edit_branch permission)
router.post('/', requirePermission('edit_branch'), branchController.createBranch);
router.put('/:branchId', requirePermission('edit_branch'), branchController.updateBranch);
router.delete('/:branchId', requirePermission('edit_branch'), branchController.deleteBranch);
router.put('/:branchId/default', requirePermission('edit_branch'), branchController.setDefaultBranch);

// Branch viewing (requires view_branches permission - we'll add this to permissions)
router.get('/', requirePermission('view_branches'), branchController.getBranches);
router.get('/default', requirePermission('view_branches'), branchController.getDefaultBranch);
router.get('/:branchId', requirePermission('view_branches'), branchController.getBranch);
router.get('/:branchId/employees', requirePermission('view_users'), branchController.getBranchEmployees);

module.exports = router;
