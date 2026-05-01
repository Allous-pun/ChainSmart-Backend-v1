const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../users/model');
const Session = require('./sessionModel');

const generateToken = (user, branchId) => {
  return jwt.sign(
    {
      userId: user._id,
      orgCode: user.orgCode,
      branchId: branchId || user.branchId,
      role: user.role,
      name: user.name
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const createSession = async (userId, orgCode, branchId, token, deviceId, ipAddress, userAgent) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  let expiresAt = new Date();
  if (expiresIn === '7d') expiresAt.setDate(expiresAt.getDate() + 7);
  else if (expiresIn === '30d') expiresAt.setDate(expiresAt.getDate() + 30);
  else if (expiresIn === '1d') expiresAt.setDate(expiresAt.getDate() + 1);
  else expiresAt.setHours(expiresAt.getHours() + parseInt(expiresIn));
  
  const session = await Session.create({
    userId,
    orgCode,
    branchId,
    token,
    deviceId,
    ipAddress,
    userAgent,
    expiresAt,
    isActive: true
  });
  
  return session;
};

const findUserByPin = async (orgCode, pin) => {
  const users = await User.find({ orgCode, isActive: true });
  
  for (const user of users) {
    const isValid = await bcrypt.compare(pin, user.pin);
    if (isValid) {
      return user;
    }
  }
  return null;
};

const logout = async (token) => {
  await Session.updateOne({ token }, { isActive: false });
  return true;
};

const logoutAllDevices = async (userId) => {
  await Session.updateMany({ userId, isActive: true }, { isActive: false });
  return true;
};

const getActiveSessions = async (userId) => {
  return await Session.find({ userId, isActive: true }).select('-token');
};

module.exports = {
  generateToken,
  createSession,
  findUserByPin,
  logout,
  logoutAllDevices,
  getActiveSessions
};