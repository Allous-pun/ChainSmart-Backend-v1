const organizationSettingsService = require('./service');
const { uploadLogo } = require('../../utils/cloudinary');

const getOrganizationSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const settings = await organizationSettingsService.getOrganizationSettings(orgCode);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Get organization settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateOrganizationSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const updateData = req.body;
    
    const settings = await organizationSettingsService.updateOrganizationSettings(orgCode, updateData, userId);
    res.json({ success: true, data: settings, message: 'Organization settings updated successfully' });
  } catch (error) {
    console.error('Update organization settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateAuthSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const authData = req.body;
    
    const settings = await organizationSettingsService.updateAuthSettings(orgCode, authData, userId);
    res.json({ success: true, data: settings, message: 'Authentication settings updated' });
  } catch (error) {
    console.error('Update auth settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateFeatureFlags = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const featuresData = req.body;
    
    const settings = await organizationSettingsService.updateFeatureFlags(orgCode, featuresData, userId);
    res.json({ success: true, data: settings, message: 'Feature flags updated' });
  } catch (error) {
    console.error('Update feature flags error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateRegionSettings = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    const regionData = req.body;
    
    const settings = await organizationSettingsService.updateRegionSettings(orgCode, regionData, userId);
    res.json({ success: true, data: settings, message: 'Region settings updated' });
  } catch (error) {
    console.error('Update region settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const uploadOrganizationLogo = async (req, res) => {
  try {
    const orgCode = req.orgCode;
    const userId = req.userId;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }
    
    // Upload to Cloudinary
    const uploadResult = await uploadLogo(req.file.buffer, orgCode);
    
    // Update organization settings with new logo URL
    const settings = await organizationSettingsService.updateOrganizationSettings(
      orgCode, 
      { logoUrl: uploadResult.url }, 
      userId
    );
    
    res.json({ 
      success: true, 
      data: {
        logoUrl: uploadResult.url,
        optimizedUrl: uploadResult.optimizedUrl,
        settings
      },
      message: 'Logo uploaded successfully'
    });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getOrganizationSettings,
  updateOrganizationSettings,
  updateAuthSettings,
  updateFeatureFlags,
  updateRegionSettings,
  uploadOrganizationLogo
};