const express = require('express');
const router = express.Router();
const userController = require('./controller');
const { requireOrgCode } = require('../../middleware/auth');

// Public route for owner creation (no authentication)
router.post('/owner', requireOrgCode, userController.createOwner);

module.exports = router;