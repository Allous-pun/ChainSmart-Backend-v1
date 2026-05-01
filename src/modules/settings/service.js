const Settings = require('./model');

const getSettings = async (orgCode) => {
  let settings = await Settings.findOne({ orgCode });
  
  if (!settings) {
    // Create default settings for new organization
    settings = await Settings.create({ orgCode });
  }
  
  return settings;
};

const updateSettings = async (orgCode, updateData, updatedBy) => {
  const settings = await Settings.findOneAndUpdate(
    { orgCode },
    { ...updateData, updatedBy, updatedAt: new Date() },
    { returnDocument: 'after', upsert: true }  // ✅ Changed from { new: true }
  );
  
  return settings;
};

const updatePillarSettings = async (orgCode, pillar, data, updatedBy) => {
  const updateObj = {};
  updateObj[pillar] = data;
  updateObj.updatedBy = updatedBy;
  updateObj.updatedAt = new Date();
  
  const settings = await Settings.findOneAndUpdate(
    { orgCode },
    updateObj,
    { returnDocument: 'after', upsert: true }  // ✅ Changed from { new: true }
  );
  
  return settings;
};

module.exports = {
  getSettings,
  updateSettings,
  updatePillarSettings
};