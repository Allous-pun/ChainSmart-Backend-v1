const User = require('../users/model');
const Organization = require('../organization/model');
const cloudinary = require('../../utils/cloudinary');

const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId).select('-pin');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const organization = await Organization.findOne({ orgCode: user.orgCode });
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          avatar: user.avatar,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt
        },
        organization: {
          orgCode: organization?.orgCode,
          orgName: organization?.orgName,
          orgEmail: organization?.orgEmail,
          industry: organization?.industry,
          status: organization?.status
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-pin');
    
    res.json({
      success: true,
      data: user,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }
    
    const result = await cloudinary.uploadImage(req.file.buffer, `users/${userId}/avatar`);
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        avatar: {
          url: result.url,
          publicId: result.publicId,
          optimizedUrl: result.url
        }
      },
      { new: true }
    ).select('-pin');
    
    res.json({
      success: true,
      data: { avatar: user.avatar },
      message: 'Avatar uploaded successfully'
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deleteAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId);
    if (!user || !user.avatar?.publicId) {
      return res.status(404).json({ success: false, error: 'No avatar found' });
    }
    
    await cloudinary.deleteFile(user.avatar.publicId);
    
    user.avatar = undefined;
    await user.save();
    
    res.json({
      success: true,
      message: 'Avatar deleted successfully'
    });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  uploadAvatar,
  deleteAvatar
};