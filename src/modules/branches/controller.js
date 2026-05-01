const branchService = require('./service');

const createBranch = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { branchName, address, city, region, country, phone, email } = req.body;
    
    if (!branchName || !address || !city) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: branchName, address, city'
      });
    }
    
    const branch = await branchService.createBranch({
      orgCode,
      branchName,
      address,
      city,
      region,
      country,
      phone,
      email
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: branch,
      message: 'Branch created successfully'
    });
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getBranches = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const includeInactive = req.query.includeInactive === 'true';
    
    const branches = await branchService.getBranchesByOrg(orgCode, includeInactive);
    res.json({ success: true, data: branches });
  } catch (error) {
    console.error('Get branches error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    const orgCode = req.user.orgCode;
    
    const branch = await branchService.getBranchById(branchId, orgCode);
    res.json({ success: true, data: branch });
  } catch (error) {
    console.error('Get branch error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const getDefaultBranch = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const branch = await branchService.getDefaultBranch(orgCode);
    res.json({ success: true, data: branch });
  } catch (error) {
    console.error('Get default branch error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const updateBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    const orgCode = req.user.orgCode;
    const { branchName, address, city, region, country, phone, email, isActive } = req.body;
    
    const branch = await branchService.updateBranch(branchId, orgCode, {
      branchName,
      address,
      city,
      region,
      country,
      phone,
      email,
      isActive
    });
    
    res.json({
      success: true,
      data: branch,
      message: 'Branch updated successfully'
    });
  } catch (error) {
    console.error('Update branch error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const deleteBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    const orgCode = req.user.orgCode;
    
    const result = await branchService.deleteBranch(branchId, orgCode);
    res.json({
      success: true,
      data: result,
      message: 'Branch deactivated successfully'
    });
  } catch (error) {
    console.error('Delete branch error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const setDefaultBranch = async (req, res) => {
  try {
    const { branchId } = req.params;
    const orgCode = req.user.orgCode;
    
    const branch = await branchService.setDefaultBranch(branchId, orgCode);
    res.json({
      success: true,
      data: branch,
      message: 'Default branch updated successfully'
    });
  } catch (error) {
    console.error('Set default branch error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getBranchEmployees = async (req, res) => {
  try {
    const { branchId } = req.params;
    const orgCode = req.user.orgCode;
    
    const employees = await branchService.getBranchEmployees(branchId, orgCode);
    res.json({ success: true, data: employees });
  } catch (error) {
    console.error('Get branch employees error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  createBranch,
  getBranches,
  getBranch,
  getDefaultBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
  getBranchEmployees
};
