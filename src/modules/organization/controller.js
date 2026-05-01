const organizationService = require('./service');

const register = async (req, res) => {
  try {
    const { orgEmail, orgName, industry } = req.body;
    
    // Validation
    if (!orgEmail || !orgName || !industry) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: orgEmail, orgName, industry' 
      });
    }
    
    const organization = await organizationService.createOrganization({
      orgEmail,
      orgName,
      industry
    });
    
    res.status(201).json({
      success: true,
      data: organization,
      message: 'Organization created successfully'
    });
  } catch (error) {
    console.error('Organization registration error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getOrg = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const organization = await organizationService.getOrganization(orgCode);
    res.json({ success: true, data: organization });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const updateOrg = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const { orgName, industry, status } = req.body;
    
    const organization = await organizationService.updateOrganization(orgCode, {
      orgName,
      industry,
      status
    });
    
    res.json({ success: true, data: organization, message: 'Organization updated successfully' });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  register,
  getOrg,
  updateOrg
};