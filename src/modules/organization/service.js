const Organization = require('./model');
const { generateOrgCode } = require('../../utils/helpers');

const createOrganization = async (data) => {
  const { orgEmail, orgName, industry } = data;
  
  // Check if org email exists
  const existingOrg = await Organization.findOne({ orgEmail: orgEmail.toLowerCase() });
  if (existingOrg) {
    throw new Error('Organization with this email already exists');
  }
  
  // Generate unique orgCode
  let orgCode = generateOrgCode(orgName);
  let isUnique = false;
  let counter = 1;
  while (!isUnique) {
    const exists = await Organization.findOne({ orgCode });
    if (!exists) {
      isUnique = true;
    } else {
      orgCode = generateOrgCode(orgName, counter);
      counter++;
    }
  }
  
  // Create organization
  const organization = await Organization.create({
    orgCode,
    orgEmail: orgEmail.toLowerCase(),
    orgName,
    industry
  });
  
  return {
    orgCode: organization.orgCode,
    orgEmail: organization.orgEmail,
    orgName: organization.orgName,
    industry: organization.industry,
    status: organization.status
  };
};

const getOrganization = async (orgCode) => {
  const organization = await Organization.findOne({ orgCode });
  if (!organization) {
    throw new Error('Organization not found');
  }
  return organization;
};

const updateOrganization = async (orgCode, updateData) => {
  const organization = await Organization.findOneAndUpdate(
    { orgCode },
    { ...updateData, updatedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!organization) {
    throw new Error('Organization not found');
  }
  return organization;
};

const updateSubscription = async (orgCode, plan, features = []) => {
  const organization = await Organization.findOneAndUpdate(
    { orgCode },
    { 
      'subscription.plan': plan,
      'subscription.features': features,
      updatedAt: new Date()
    },
    { returnDocument: 'after' }
  );
  return organization;
};

module.exports = {
  createOrganization,
  getOrganization,
  updateOrganization,
  updateSubscription
};