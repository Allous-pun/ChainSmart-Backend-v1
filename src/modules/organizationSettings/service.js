const OrganizationSettings = require('./model');

const getOrganizationSettings = async (orgCode) => {
  let settings = await OrganizationSettings.findOne({ orgCode });
  
  if (!settings) {
    // Create default organization settings for new organization
    settings = await OrganizationSettings.create({ 
      orgCode,
      orgName: orgCode, // Temporary name
      industry: 'retail' // Default industry
    });
  }
  
  return settings;
};

const updateOrganizationSettings = async (orgCode, updateData, updatedBy) => {
  const settings = await OrganizationSettings.findOneAndUpdate(
    { orgCode },
    { ...updateData, updatedBy, updatedAt: new Date() },
    { returnDocument: 'after', upsert: true }
  );
  
  return settings;
};

const updateAuthSettings = async (orgCode, authData, updatedBy) => {
  const settings = await OrganizationSettings.findOneAndUpdate(
    { orgCode },
    { $set: { auth: authData, updatedBy, updatedAt: new Date() } },
    { returnDocument: 'after', upsert: true }
  );
  
  return settings;
};

const updateFeatureFlags = async (orgCode, featuresData, updatedBy) => {
  const settings = await OrganizationSettings.findOneAndUpdate(
    { orgCode },
    { $set: { features: featuresData, updatedBy, updatedAt: new Date() } },
    { returnDocument: 'after', upsert: true }
  );
  
  return settings;
};

const updateRegionSettings = async (orgCode, regionData, updatedBy) => {
  const settings = await OrganizationSettings.findOneAndUpdate(
    { orgCode },
    { $set: { region: regionData, updatedBy, updatedAt: new Date() } },
    { returnDocument: 'after', upsert: true }
  );
  
  return settings;
};

module.exports = {
  getOrganizationSettings,
  updateOrganizationSettings,
  updateAuthSettings,
  updateFeatureFlags,
  updateRegionSettings
};