const Branch = require('./model');
const User = require('../users/model');
const { geocodeFullAddress } = require('../../utils/geocoding');

const generateBranchId = (orgCode, counter) => {
  return `${orgCode}_BR_${counter.toString().padStart(3, '0')}`;
};

const generateBranchCode = (branchName, counter) => {
  let code = branchName
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase();
  
  if (counter > 0) {
    return `${code}${counter}`;
  }
  return code;
};

const createBranch = async (data, createdBy) => {
  const { orgCode, branchName, address, city, region, country, phone, email } = data;
  
  // Check if branch with same name exists
  const existingBranch = await Branch.findOne({ orgCode, branchName });
  if (existingBranch) {
    throw new Error('Branch with this name already exists');
  }
  
  // Geocode address to get coordinates
  let coordinates = null;
  let formattedAddress = null;
  
  if (address && city) {
    const geocodingResult = await geocodeFullAddress(`${address}, ${city}, ${region || ''}, ${country || 'Kenya'}`);
    if (geocodingResult) {
      coordinates = {
        lat: geocodingResult.latitude,
        lng: geocodingResult.longitude
      };
      formattedAddress = geocodingResult.formattedAddress;
    }
  }
  
  // Get branch count to generate IDs
  const branchCount = await Branch.countDocuments({ orgCode });
  const counter = branchCount + 1;
  
  const branchId = generateBranchId(orgCode, counter);
  const branchCode = generateBranchCode(branchName, counter);
  
  // Check if this is the first branch
  const isFirstBranch = branchCount === 0;
  
  const branch = await Branch.create({
    orgCode,
    branchId,
    branchName,
    branchCode,
    address,
    city,
    region,
    country: country || 'Kenya',
    coordinates,
    formattedAddress,
    isDefault: isFirstBranch,
    isActive: true,
    phone,
    email,
    createdBy
  });
  
  // If this is the first branch, update all users in this org from 'pending' to this branchId
  if (isFirstBranch) {
    await User.updateMany(
      { orgCode, branchId: 'pending' },
      { branchId: branch.branchId }
    );
  }
  
  return branch;
};

const getBranchById = async (branchId, orgCode) => {
  const branch = await Branch.findOne({ branchId, orgCode, isActive: true });
  if (!branch) {
    throw new Error('Branch not found');
  }
  return branch;
};

const getBranchesByOrg = async (orgCode, includeInactive = false) => {
  const filter = { orgCode };
  if (!includeInactive) {
    filter.isActive = true;
  }
  return await Branch.find(filter).sort({ isDefault: -1, createdAt: 1 });
};

const getDefaultBranch = async (orgCode) => {
  const branch = await Branch.findOne({ orgCode, isDefault: true, isActive: true });
  if (!branch) {
    throw new Error('No default branch found');
  }
  return branch;
};

const updateBranch = async (branchId, orgCode, updateData) => {
  const { branchName, address, city, region, country, phone, email, isActive } = updateData;
  
  const updateFields = {};
  if (branchName) updateFields.branchName = branchName;
  if (phone) updateFields.phone = phone;
  if (email) updateFields.email = email;
  if (isActive !== undefined) updateFields.isActive = isActive;
  
  // If address changed, re-geocode
  if (address || city || region || country) {
    if (address) updateFields.address = address;
    if (city) updateFields.city = city;
    if (region) updateFields.region = region;
    if (country) updateFields.country = country;
    
    const geocodingResult = await geocodeFullAddress(
      `${address || updateFields.address}, ${city || updateFields.city}, ${region || updateFields.region || ''}, ${country || updateFields.country || 'Kenya'}`
    );
    
    if (geocodingResult) {
      updateFields.coordinates = {
        lat: geocodingResult.latitude,
        lng: geocodingResult.longitude
      };
      updateFields.formattedAddress = geocodingResult.formattedAddress;
    }
  }
  
  updateFields.updatedAt = new Date();
  
  const branch = await Branch.findOneAndUpdate(
    { branchId, orgCode },
    updateFields,
    { new: true }
  );
  
  if (!branch) {
    throw new Error('Branch not found');
  }
  
  return branch;
};

const deleteBranch = async (branchId, orgCode) => {
  const branch = await Branch.findOne({ branchId, orgCode });
  if (!branch) {
    throw new Error('Branch not found');
  }
  
  if (branch.isDefault) {
    throw new Error('Cannot delete default branch. Set another branch as default first.');
  }
  
  // Check if there are users in this branch
  const userCount = await User.countDocuments({ orgCode, branchId });
  if (userCount > 0) {
    throw new Error(`Cannot delete branch with ${userCount} users assigned. Reassign users first.`);
  }
  
  branch.isActive = false;
  await branch.save();
  
  return { branchId, deleted: true };
};

const setDefaultBranch = async (branchId, orgCode) => {
  // Remove default from all branches
  await Branch.updateMany({ orgCode }, { isDefault: false });
  
  // Set new default
  const branch = await Branch.findOneAndUpdate(
    { branchId, orgCode },
    { isDefault: true },
    { new: true }
  );
  
  if (!branch) {
    throw new Error('Branch not found');
  }
  
  return branch;
};

const getBranchEmployees = async (branchId, orgCode) => {
  return await User.find({ orgCode, branchId, isActive: true }).select('-pin');
};

module.exports = {
  createBranch,
  getBranchById,
  getBranchesByOrg,
  getDefaultBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
  getBranchEmployees
};
