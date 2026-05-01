const express = require('express');
const router = express.Router();
const authController = require('./controller');
const profileController = require('./profileController');
const { authenticate } = require('../../middleware/auth');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Public routes - no headers needed, just PIN
router.post('/login', authController.login);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/sessions', authenticate, authController.getSessions);
router.get('/verify', authenticate, authController.verify);
router.post('/change-pin', authenticate, authController.changePin);

// Profile routes
router.get('/profile', authenticate, profileController.getProfile);
router.put('/profile', authenticate, profileController.updateProfile);
router.post('/profile/avatar', authenticate, upload.single('avatar'), profileController.uploadAvatar);
router.delete('/profile/avatar', authenticate, profileController.deleteAvatar);

module.exports = router;