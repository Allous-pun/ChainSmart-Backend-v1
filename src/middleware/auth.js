const jwt = require('jsonwebtoken');
const Session = require('../modules/auth/sessionModel');
const User = require('../modules/users/model');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required. Please login.' 
      });
    }
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          error: 'Token expired. Please login again.' 
        });
      }
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token. Please login again.' 
      });
    }
    
    const session = await Session.findOne({ token, isActive: true });
    if (!session) {
      return res.status(401).json({ 
        success: false, 
        error: 'Session expired or invalid. Please login again.' 
      });
    }
    
    const user = await User.findOne({ _id: decoded.userId, isActive: true });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User account not found or deactivated.' 
      });
    }
    
    req.user = {
      id: decoded.userId,
      orgCode: decoded.orgCode,
      branchId: decoded.branchId,
      role: decoded.role,
      name: decoded.name
    };
    
    req.token = token;
    req.sessionId = session._id;
    
    session.lastActiveAt = new Date();
    await session.save();
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
};

const requireOrgCode = (req, res, next) => {
  const orgCode = req.headers['x-orgcode'];
  
  if (!orgCode) {
    return res.status(400).json({ 
      success: false, 
      error: 'x-orgcode header is required for this endpoint' 
    });
  }
  
  // If user is authenticated, verify orgCode matches
  if (req.user && orgCode !== req.user.orgCode) {
    return res.status(403).json({ 
      success: false, 
      error: 'Organization access denied. Invalid orgCode for this user.' 
    });
  }
  
  req.orgCode = orgCode;
  next();
};

const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      
      if (!userRole) {
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied: No role assigned' 
        });
      }
      
      // Owner has all permissions
      if (userRole === 'owner') {
        return next();
      }
      
      const Role = require('../modules/roles/model');
      const role = await Role.findOne({ name: userRole });
      
      if (!role) {
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied: Invalid role' 
        });
      }
      
      if (role.permissions.includes(requiredPermission)) {
        return next();
      }
      
      return res.status(403).json({ 
        success: false, 
        error: `Access denied: ${requiredPermission} permission required` 
      });
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
  };
};

const requireBranchAccess = async (req, res, next) => {
  try {
    const requestedBranchId = req.params.branchId || req.body.branchId || req.headers['x-branchid'];
    const userBranchId = req.user.branchId;
    const userRole = req.user.role;
    
    // CEO can access any branch
    if (userRole === 'owner') {
      if (requestedBranchId) {
        req.branchId = requestedBranchId;
      }
      return next();
    }
    
    // Non-CEO must use their assigned branch
    if (requestedBranchId && requestedBranchId !== userBranchId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: You do not have access to this branch' 
      });
    }
    
    req.branchId = userBranchId;
    next();
  } catch (error) {
    console.error('Branch access error:', error);
    res.status(500).json({ success: false, error: 'Branch access check failed' });
  }
};

module.exports = { 
  authenticate, 
  requireOrgCode,
  requirePermission, 
  requireBranchAccess 
};