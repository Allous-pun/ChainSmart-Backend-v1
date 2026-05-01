const OrganizationSettings = require('../modules/organizationSettings/model');

/**
 * Attach organization settings to req object
 * Usage: router.get('/inventory', attachOrganizationSettings, inventoryController.getStock)
 */
const attachOrganizationSettings = async (req, res, next) => {
  try {
    const orgCode = req.orgCode;
    
    let orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    if (!orgSettings) {
      // Create default if doesn't exist
      orgSettings = await OrganizationSettings.create({
        orgCode,
        orgName: orgCode,
        industry: 'retail'
      });
    }
    
    req.orgSettings = orgSettings;
    next();
  } catch (error) {
    console.error('Attach organization settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to load organization settings' });
  }
};

/**
 * Attach specific organization settings by section
 * Usage: router.get('/inventory', attachOrgSettings(['region', 'features']), inventoryController.getStock)
 */
const attachOrgSettings = (sections = []) => {
  return async (req, res, next) => {
    try {
      const orgCode = req.orgCode;
      
      let orgSettings = await OrganizationSettings.findOne({ orgCode });
      
      if (!orgSettings) {
        orgSettings = await OrganizationSettings.create({
          orgCode,
          orgName: orgCode,
          industry: 'retail'
        });
      }
      
      // Attach only requested sections
      if (sections.length === 0) {
        req.orgSettings = orgSettings;
      } else {
        req.orgSettings = {};
        sections.forEach(section => {
          if (orgSettings[section]) {
            req.orgSettings[section] = orgSettings[section];
          }
        });
      }
      
      next();
    } catch (error) {
      console.error('Attach org settings error:', error);
      res.status(500).json({ success: false, error: 'Failed to load organization settings' });
    }
  };
};

module.exports = {
  attachOrganizationSettings,
  attachOrgSettings
};