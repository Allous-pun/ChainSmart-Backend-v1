const express = require('express');
const router = express.Router();
const multer = require('multer');
const organizationSettingsController = require('./controller');
const { hasPermission } = require('../../middleware/permission');

// Configure multer for memory storage (no disk write)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Error handling for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. Maximum size is 5MB' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
};

// All organization settings routes require edit_settings permission
router.use(hasPermission('edit_settings'));

// Get all organization settings
router.get('/', organizationSettingsController.getOrganizationSettings);

// Update entire organization settings
router.put('/', organizationSettingsController.updateOrganizationSettings);

// Upload logo (with multer error handling)
router.post('/logo', upload.single('logo'), handleMulterError, organizationSettingsController.uploadOrganizationLogo);

// Update specific sections
router.put('/auth', organizationSettingsController.updateAuthSettings);
router.put('/features', organizationSettingsController.updateFeatureFlags);
router.put('/region', organizationSettingsController.updateRegionSettings);

module.exports = router;