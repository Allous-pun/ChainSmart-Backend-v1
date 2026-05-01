const userService = require('./service');

const createOwner = async (req, res) => {
  try {
    // Get orgCode from header (set by requireOrgCode middleware)
    const orgCode = req.orgCode;
    const { name, email } = req.body;
    
    // Validate required fields
    if (!orgCode || !name || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: name, email. orgCode must be in x-orgcode header.' 
      });
    }
    
    // Email validation
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid email format' 
      });
    }
    
    const user = await userService.createOwner({ orgCode, name, email });
    
    res.status(201).json({
      success: true,
      data: user,
      message: `Owner created successfully. PIN: ${user.pin} - Please save this PIN securely.`
    });
  } catch (error) {
    console.error('Create owner error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// Rest of the functions remain the same...
const createEmployee = async (req, res) => {
  try {
    const { branchId, name, email, pin, role } = req.body;
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    
    if (!branchId || !name || !email || !pin || !role) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: branchId, name, email, pin, role' 
      });
    }
    
    if (!/^\d{8}$/.test(pin)) {
      return res.status(400).json({ 
        success: false, 
        error: 'PIN must be exactly 8 digits' 
      });
    }
    
    const user = await userService.createUser({
      orgCode,
      branchId,
      name,
      email,
      pin,
      role
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: user,
      message: 'Employee created successfully'
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getUsers = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const branchId = req.query.branchId || null;
    
    const users = await userService.getUsersByOrg(orgCode, branchId);
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const orgCode = req.user.orgCode;
    
    const user = await userService.getUserById(userId, orgCode);
    const { pin, ...userWithoutPin } = user.toObject();
    res.json({ success: true, data: userWithoutPin });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const orgCode = req.user.orgCode;
    const { name, email, role, branchId } = req.body;
    
    const user = await userService.updateUser(userId, orgCode, {
      name,
      email,
      role,
      branchId
    });
    
    res.json({ success: true, data: user, message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const orgCode = req.user.orgCode;
    
    const result = await userService.deactivateUser(userId, orgCode);
    res.json({ success: true, data: result, message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  createOwner,
  createEmployee,
  getUsers,
  getUser,
  updateUser,
  deleteUser
};