const bcrypt = require('bcrypt');
const User = require('./model');

const createOwner = async (data) => {
  const { orgCode, name, email } = data;
  
  // Check if owner already exists for this org
  const existingOwner = await User.findOne({ orgCode, role: 'owner' });
  if (existingOwner) {
    throw new Error('Owner already exists for this organization');
  }
  
  // Generate random 8-digit PIN
  const generatePin = () => {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  };
  
  const plainPin = generatePin();
  const hashedPin = await bcrypt.hash(plainPin, 10);
  
  const user = await User.create({
    orgCode,
    branchId: 'pending',
    pin: hashedPin,
    name,
    email,
    role: 'owner',
    isActive: true,
    createdBy: orgCode
  });
  
  return {
    id: user._id,
    orgCode: user.orgCode,
    name: user.name,
    email: user.email,
    role: user.role,
    pin: plainPin
  };
};

const createUser = async (data, createdBy) => {
  const { orgCode, branchId, name, email, pin, role } = data;
  
  const hashedPin = await bcrypt.hash(pin, 10);
  
  const user = await User.create({
    orgCode,
    branchId,
    pin: hashedPin,
    name,
    email,
    role,
    isActive: true,
    createdBy
  });
  
  return {
    id: user._id,
    orgCode: user.orgCode,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role
  };
};

const getUserById = async (userId, orgCode) => {
  const user = await User.findOne({ _id: userId, orgCode, isActive: true });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

const getUsersByOrg = async (orgCode, branchId = null) => {
  const filter = { orgCode, isActive: true };
  if (branchId) {
    filter.branchId = branchId;
  }
  return await User.find(filter).select('-pin');
};

const updateUser = async (userId, orgCode, updateData) => {
  const user = await User.findOneAndUpdate(
    { _id: userId, orgCode },
    { ...updateData, updatedAt: new Date() },
    { new: true }
  );
  if (!user) {
    throw new Error('User not found');
  }
  return user.select('-pin');
};

const deactivateUser = async (userId, orgCode) => {
  const user = await User.findOneAndUpdate(
    { _id: userId, orgCode },
    { isActive: false },
    { new: true }
  );
  if (!user) {
    throw new Error('User not found');
  }
  return { id: user._id, name: user.name, isActive: false };
};

const updateBranchForUser = async (userId, orgCode, branchId) => {
  const user = await User.findOneAndUpdate(
    { _id: userId, orgCode },
    { branchId },
    { new: true }
  );
  return user;
};

module.exports = {
  createOwner,
  createUser,
  getUserById,
  getUsersByOrg,
  updateUser,
  deactivateUser,
  updateBranchForUser
};