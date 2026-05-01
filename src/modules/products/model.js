const mongoose = require('mongoose');

/* -------------------------
   ATTRIBUTE (Dynamic Fields)
-------------------------- */
const AttributeSchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  type: { 
    type: String, 
    enum: ['string', 'number', 'date', 'boolean'], 
    default: 'string' 
  }
}, { _id: false });

/* -------------------------
   VARIANT
-------------------------- */
const VariantSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  name: { type: String, required: true },
  attributes: [AttributeSchema],
  standardCost: { type: Number },
  weight: { type: Number },
  volume: { type: Number },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

/* -------------------------
   CATEGORY SCHEMA
-------------------------- */
const CategorySchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  level: { type: Number, default: 0 },
  path: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Category pre-save middleware to generate path and level
CategorySchema.pre('save', async function() {
  if (this.parentId) {
    const parent = await this.constructor.findById(this.parentId);
    if (parent) {
      this.path = `${parent.path}/${this.name}`;
      this.level = parent.level + 1;
    } else {
      this.path = `/${this.name}`;
    }
  } else {
    this.path = `/${this.name}`;
  }
});

/* -------------------------
   MAIN PRODUCT SCHEMA
-------------------------- */
const ProductSchema = new mongoose.Schema({

  /* ===== IDENTITY ===== */
  orgCode: { type: String, required: true, index: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String },

  /* ===== CLASSIFICATION ===== */
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  productType: {
    type: String,
    enum: ['raw_material', 'finished_good', 'consumable', 'service'],
    required: true
  },

  /* ===== MEASUREMENT ===== */
  baseUnit: { type: String, required: true },
  alternativeUnits: [{
    unit: { type: String },
    conversionRate: { type: Number }
  }],

  /* ===== INVENTORY BEHAVIOR ===== */
  trackInventory: { type: Boolean, default: true },
  reorderLevel: { type: Number, default: 0 },
  maxStockLevel: { type: Number },

  /* ===== COSTING ===== */
  standardCost: { type: Number, required: true },
  lastPurchaseCost: { type: Number },

  /* ===== PHYSICAL PROPERTIES ===== */
  weight: { type: Number },
  volume: { type: Number },

  /* ===== VARIANTS ===== */
  variants: [VariantSchema],

  /* ===== FLEXIBLE ATTRIBUTES ===== */
  attributes: [AttributeSchema],

  /* ===== PRODUCT LIFECYCLE ===== */
  lifecycleState: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'discontinued', 'archived'],
    default: 'draft'
  },
  discontinuedAt: { type: Date },
  discontinuedReason: { type: String },

  /* ===== AUDIT ===== */
  createdBy: { type: String, required: true },
  updatedBy: { type: String },

  /* ===== VERSION CONTROL (CONCURRENCY) ===== */
  version: { 
    type: Number, 
    default: 1,
    min: 1
  }

}, { 
  timestamps: true,
  versionKey: false
});

/* -------------------------
   PRODUCT VALIDATION MIDDLEWARE (IMPROVED - THROWS ERRORS)
   Handles service vs physical product rules
-------------------------- */
ProductSchema.pre('validate', function(next) {
  const isService = this.productType === 'service';

  // ===== SERVICES =====
  if (isService) {
    // REJECT weight or volume instead of silently removing
    if (this.weight !== undefined && this.weight !== null) {
      const error = new Error('Service products cannot have weight');
      error.code = 'SERVICE_CANNOT_HAVE_WEIGHT';
      return next(error);
    }
    
    if (this.volume !== undefined && this.volume !== null) {
      const error = new Error('Service products cannot have volume');
      error.code = 'SERVICE_CANNOT_HAVE_VOLUME';
      return next(error);
    }
    
    // ALWAYS enforce trackInventory = false for services (no guessing)
    this.trackInventory = false;
    this.reorderLevel = 0;
    this.maxStockLevel = undefined;
    this.weight = undefined;
    this.volume = undefined;
  }

  // ===== PHYSICAL GOODS =====
  if (!isService) {
    // ALWAYS enforce trackInventory = true for physical goods
    this.trackInventory = true;
    
    // Optional: Add business rule - physical goods should have weight
    // Uncomment if you want to enforce weight for physical products
    // if (!this.weight && this.weight !== 0) {
    //   const error = new Error('Physical products should have weight');
    //   error.code = 'PHYSICAL_PRODUCT_NEEDS_WEIGHT';
    //   return next(error);
    // }
  }

  next();
});

/* -------------------------
   VALIDATORS: Prevent invalid data at field level
-------------------------- */
ProductSchema.path('weight').validate(function(v) {
  if (this.productType === 'service' && v !== undefined && v !== null) {
    return false;
  }
  return true;
}, 'Services cannot have weight');

ProductSchema.path('volume').validate(function(v) {
  if (this.productType === 'service' && v !== undefined && v !== null) {
    return false;
  }
  return true;
}, 'Services cannot have volume');

ProductSchema.path('trackInventory').validate(function(v) {
  if (this.productType === 'service' && v === true) {
    return false;
  }
  return true;
}, 'Services cannot track inventory');

/* -------------------------
   VIRTUAL: Derived isActive (Single source of truth)
-------------------------- */
ProductSchema.virtual('isActive').get(function() {
  return this.lifecycleState === 'active';
});

/* -------------------------
   INDEXES
-------------------------- */
ProductSchema.index({ orgCode: 1, sku: 1 }, { unique: true });
ProductSchema.index({ orgCode: 1, categoryId: 1 });
ProductSchema.index({ orgCode: 1, productType: 1 });
ProductSchema.index({ orgCode: 1, lifecycleState: 1 });
ProductSchema.index({ orgCode: 1, name: 1 });
ProductSchema.index({ orgCode: 1, 'variants.sku': 1 });
ProductSchema.index({ version: 1 });

/* -------------------------
   EXPORT
-------------------------- */
module.exports = {
  Product: mongoose.model('Product', ProductSchema),
  Category: mongoose.model('Category', CategorySchema)
};
