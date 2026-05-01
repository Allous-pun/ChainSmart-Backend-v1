const { Product } = require('./model');  // ← FIXED: Destructure Product from the export
const { generateUniqueSku } = require('../../utils/skuGenerator');

const createProduct = async (data, createdBy) => {
  const { orgCode, sku, name, productType } = data;
  
  // Auto-generate SKU if not provided
  let finalSku = sku;
  if (!finalSku) {
    finalSku = await generateUniqueSku(orgCode, name, productType);
  }
  
  // Check if SKU exists (for both auto-generated and manually provided)
  const existingProduct = await Product.findOne({ orgCode, sku: finalSku });
  if (existingProduct) {
    const error = new Error(`Product with SKU ${finalSku} already exists`);
    error.code = 'DUPLICATE_SKU';
    throw error;
  }
  
  const product = await Product.create({
    ...data,
    sku: finalSku,
    orgCode,
    createdBy,
    updatedBy: createdBy,
    version: 1
  });
  
  return product;
};

const getProductById = async (productId, orgCode) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  return product;
};

const getProductBySku = async (sku, orgCode) => {
  const product = await Product.findOne({ sku, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  return product;
};

const getProducts = async (orgCode, filters = {}) => {
  const query = { orgCode };
  
  // Only filter by lifecycleState, not isActive (virtual)
  if (filters.lifecycleState) query.lifecycleState = filters.lifecycleState;
  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.productType) query.productType = filters.productType;
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { sku: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } }
    ];
  }
  
  const limit = filters.limit || 50;
  const skip = filters.skip || 0;
  
  const products = await Product.find(query)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
  
  const total = await Product.countDocuments(query);
  
  return { products, total, limit, skip };
};

const getProductsByCategory = async (orgCode, categoryId, limit = 50, skip = 0) => {
  const query = { 
    orgCode, 
    categoryId,
    lifecycleState: { $ne: 'archived' }
  };
  
  const products = await Product.find(query)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
  
  const total = await Product.countDocuments(query);
  
  return { products, total, limit, skip };
};

const updateProduct = async (productId, orgCode, updateData, updatedBy) => {
  // 1. Fetch current product
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  // 2. Validate immutable fields
  const immutableFields = ['sku', 'baseUnit', 'productType'];
  
  for (const field of immutableFields) {
    if (field in updateData && updateData[field] !== product[field]) {
      const error = new Error(`Cannot modify '${field}' - this field is immutable`);
      error.code = 'IMMUTABLE_FIELD';
      error.field = field;
      error.currentValue = product[field];
      error.attemptedValue = updateData[field];
      throw error;
    }
  }
  
  // 3. Validate lifecycle state transition
  if (updateData.lifecycleState) {
    validateLifecycleTransition(product.lifecycleState, updateData.lifecycleState);
  }
  
  // 4. OPTIONAL: Request version validation (if client sends version)
  if (updateData.version !== undefined && updateData.version !== product.version) {
    const error = new Error('Product version mismatch. Please refresh and try again.');
    error.code = 'VERSION_MISMATCH';
    error.clientVersion = updateData.version;
    error.serverVersion = product.version;
    throw error;
  }
  
  // 5. Atomic update with optimistic locking
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version  // 🔒 Critical: version lock
    },
    {
      ...updateData,
      updatedBy,
      $inc: { version: 1 }  // Increment version on successful update
    },
    { 
      new: true,
      runValidators: true
    }
  );
  
  // 6. Check if update was successful
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const deleteProduct = async (productId, orgCode, updatedBy) => {
  // Soft delete - set lifecycleState to 'archived'
  return await updateProduct(
    productId, 
    orgCode, 
    { 
      lifecycleState: 'archived',
      discontinuedAt: new Date(),
      discontinuedReason: 'Deleted by user'
    }, 
    updatedBy
  );
};

const addVariant = async (productId, orgCode, variantData, updatedBy) => {
  // Fetch with version for optimistic locking
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  // Auto-generate variant SKU if not provided
  let variantSku = variantData.sku;
  if (!variantSku) {
    variantSku = await generateUniqueSku(
      orgCode, 
      `${product.name} ${variantData.name}`, 
      product.productType
    );
    variantData.sku = variantSku;
  }
  
  // Check if variant SKU already exists
  const existingVariant = product.variants.find(v => v.sku === variantSku);
  if (existingVariant) {
    const error = new Error(`Variant with SKU ${variantSku} already exists`);
    error.code = 'DUPLICATE_VARIANT_SKU';
    throw error;
  }
  
  // Atomic update with version locking
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $push: { variants: variantData },
      $set: { updatedBy },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const updateVariant = async (productId, orgCode, variantSku, updateData, updatedBy) => {
  // Fetch with version
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  const variantIndex = product.variants.findIndex(v => v.sku === variantSku);
  if (variantIndex === -1) {
    const error = new Error(`Variant with SKU ${variantSku} not found`);
    error.code = 'VARIANT_NOT_FOUND';
    throw error;
  }
  
  // Atomic update with version locking
  const updatePath = `variants.${variantIndex}`;
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $set: { 
        [updatePath]: { ...product.variants[variantIndex].toObject(), ...updateData },
        updatedBy 
      },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const removeVariant = async (productId, orgCode, variantSku, updatedBy) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $pull: { variants: { sku: variantSku } },
      $set: { updatedBy },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const addAttribute = async (productId, orgCode, attribute, updatedBy) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  // Check if attribute key already exists
  const existingAttr = product.attributes.find(a => a.key === attribute.key);
  if (existingAttr) {
    const error = new Error(`Attribute with key '${attribute.key}' already exists`);
    error.code = 'DUPLICATE_ATTRIBUTE';
    throw error;
  }
  
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $push: { attributes: attribute },
      $set: { updatedBy },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const updateAttribute = async (productId, orgCode, attributeKey, updateData, updatedBy) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  const attributeIndex = product.attributes.findIndex(a => a.key === attributeKey);
  if (attributeIndex === -1) {
    const error = new Error(`Attribute with key '${attributeKey}' not found`);
    error.code = 'ATTRIBUTE_NOT_FOUND';
    throw error;
  }
  
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $set: { 
        [`attributes.${attributeIndex}.value`]: updateData.value,
        [`attributes.${attributeIndex}.type`]: updateData.type || product.attributes[attributeIndex].type,
        updatedBy 
      },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

const removeAttribute = async (productId, orgCode, attributeKey, updatedBy) => {
  const product = await Product.findOne({ _id: productId, orgCode });
  if (!product) {
    const error = new Error('Product not found');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      orgCode,
      version: product.version
    },
    {
      $pull: { attributes: { key: attributeKey } },
      $set: { updatedBy },
      $inc: { version: 1 }
    },
    { new: true }
  );
  
  if (!updated) {
    const error = new Error('Product was modified by another user. Please refresh and try again.');
    error.code = 'CONCURRENT_MODIFICATION';
    throw error;
  }
  
  return updated;
};

// Helper function for lifecycle validation
const validateLifecycleTransition = (currentState, newState) => {
  const allowedTransitions = {
    'draft': ['active', 'inactive', 'archived'],
    'active': ['inactive', 'discontinued'],
    'inactive': ['active', 'archived'],
    'discontinued': ['archived'],
    'archived': []
  };
  
  const allowed = allowedTransitions[currentState] || [];
  if (!allowed.includes(newState)) {
    const error = new Error(`Cannot transition from ${currentState} to ${newState}`);
    error.code = 'INVALID_STATE_TRANSITION';
    error.currentState = currentState;
    error.requestedState = newState;
    error.allowedStates = allowed;
    throw error;
  }
};

module.exports = {
  createProduct,
  getProductById,
  getProductBySku,
  getProducts,
  getProductsByCategory,
  updateProduct,
  deleteProduct,
  addVariant,
  updateVariant,
  removeVariant,
  addAttribute,
  updateAttribute,
  removeAttribute
};
