const mongoose = require('mongoose');

const OrganizationSettingsSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, unique: true, index: true },
  
  // Core Identity
  orgName: { type: String, required: true },
  industry: { type: String, required: true, enum: ['hospitality', 'transport', 'retail', 'manufacturing', 'agriculture'] },
  logoUrl: { type: String, default: '' },  // Cloudinary URL
  contactEmail: { type: String },
  contactPhone: { type: String },
  
  // Authentication Settings (No passwords, no magic-link)
  auth: {
    allowedEmailDomains: [{ type: String }],     // e.g., ['@serena.com', '@gmail.com']
    allowedPhonePrefixes: [{ type: String }],    // e.g., ['+254', '+255', '+1']
    selfSignupEnabled: { type: Boolean, default: false },
    sessionTimeoutDays: { type: Number, default: 7 }
  },
  
  // Feature Flags (Which pillars are enabled)
  features: {
    pillarsEnabled: {
      demandAndInventory: { type: Boolean, default: true },
      procurement: { type: Boolean, default: true },
      supplierComparison: { type: Boolean, default: true },
      logistics: { type: Boolean, default: false },
      costSimulation: { type: Boolean, default: false },
      emissions: { type: Boolean, default: false },
      insights: { type: Boolean, default: true }
    },
    engineAutoRun: { type: Boolean, default: true },
    realTimeAlerts: { type: Boolean, default: true }
  },
  
  // Regional Context
  region: {
    country: { type: String, default: 'KE' },
    defaultCurrency: { type: String, default: 'KES' },
    language: { type: String, default: 'en', enum: ['en', 'sw'] },
    timezone: { type: String, default: 'Africa/Nairobi' }
  },
  
  // Subscription (Future)
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
    trialEndsAt: { type: Date },
    maxUsers: { type: Number, default: 5 },
    maxBranches: { type: Number, default: 3 }
  },
  
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('OrganizationSettings', OrganizationSettingsSchema);