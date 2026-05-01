const Role = require('../modules/roles/model');

const hasPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      
      if (!userRole) {
        return res.status(403).json({ error: 'Access denied: No role assigned' });
      }

      // Owner has all permissions
      if (userRole === 'owner') {
        return next();
      }

      // Get role from database
      const role = await Role.findOne({ name: userRole });
      
      if (!role) {
        return res.status(403).json({ error: 'Access denied: Invalid role' });
      }

      // Check permission
      if (role.permissions.includes(requiredPermission)) {
        return next();
      }

      return res.status(403).json({ 
        error: `Access denied: ${requiredPermission} permission required` 
      });
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

module.exports = { hasPermission };