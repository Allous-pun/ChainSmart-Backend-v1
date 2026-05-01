const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, unique: true, index: true },
  orgEmail: { type: String, required: true, unique: true, lowercase: true },
  orgName: { type: String, required: true },
  industry: { 
    type: String, 
    required: true,
    enum: ['retail', 'hospitality', 'transport', 'manufacturing', 'agriculture', 'healthcare', 'other']
  },
  status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
  
  // Subscription
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    features: [String]
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Organization', OrganizationSchema);