const Settings = require('../modules/settings/model');

/**
 * Attach 7-pillar settings to req object
 * Usage: router.get('/inventory', attachSettings, inventoryController.getStock)
 */
const attachSettings = async (req, res, next) => {
  try {
    const orgCode = req.orgCode;
    
    let settings = await Settings.findOne({ orgCode });
    
    if (!settings) {
      // Create default 7-pillar settings if doesn't exist
      settings = await Settings.create({ orgCode });
    }
    
    req.settings = settings;
    next();
  } catch (error) {
    console.error('Attach settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to load decision settings' });
  }
};

/**
 * Attach specific pillar settings only
 * Usage: router.get('/inventory', attachPillars(['inventory', 'costSimulation']), inventoryController.getStock)
 */
const attachPillars = (pillars = []) => {
  return async (req, res, next) => {
    try {
      const orgCode = req.orgCode;
      
      let settings = await Settings.findOne({ orgCode });
      
      if (!settings) {
        settings = await Settings.create({ orgCode });
      }
      
      // Attach only requested pillars
      if (pillars.length === 0) {
        req.settings = settings;
      } else {
        req.settings = {};
        pillars.forEach(pillar => {
          if (settings[pillar]) {
            req.settings[pillar] = settings[pillar];
          }
        });
      }
      
      next();
    } catch (error) {
      console.error('Attach pillars error:', error);
      res.status(500).json({ success: false, error: 'Failed to load pillar settings' });
    }
  };
};

/**
 * Attach a single pillar setting
 * Usage: router.get('/inventory', attachPillar('inventory'), inventoryController.getStock)
 */
const attachPillar = (pillar) => {
  return async (req, res, next) => {
    try {
      const orgCode = req.orgCode;
      
      let settings = await Settings.findOne({ orgCode });
      
      if (!settings) {
        settings = await Settings.create({ orgCode });
      }
      
      req.pillarSettings = settings[pillar] || {};
      req.settings = settings; // Keep full settings if needed
      
      next();
    } catch (error) {
      console.error(`Attach ${pillar} pillar error:`, error);
      res.status(500).json({ success: false, error: `Failed to load ${pillar} settings` });
    }
  };
};

module.exports = {
  attachSettings,
  attachPillars,
  attachPillar
};