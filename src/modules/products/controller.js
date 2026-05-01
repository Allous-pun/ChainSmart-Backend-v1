const productService = require('./service');

const createProduct = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    
    const {
      name,
      sku,
      description,
      categoryId,
      productType,
      baseUnit,
      alternativeUnits,
      trackInventory,
      reorderLevel,
      maxStockLevel,
      standardCost,
      lastPurchaseCost,
      weight,
      volume,
      hasVariants,
      variants,
      attributes,
      lifecycleState
    } = req.body;
    
    // Validation
    if (!name || !categoryId || !productType || !baseUnit || !standardCost) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, categoryId, productType, baseUnit, standardCost'
      });
    }
    
    const product = await productService.createProduct({
      orgCode,
      name,
      sku,
      description,
      categoryId,
      productType,
      baseUnit,
      alternativeUnits: alternativeUnits || [],
      trackInventory: trackInventory !== undefined ? trackInventory : true,
      reorderLevel: reorderLevel || 0,
      maxStockLevel,
      standardCost,
      lastPurchaseCost,
      weight,
      volume,
      hasVariants: hasVariants || false,
      variants: variants || [],
      attributes: attributes || [],
      lifecycleState: lifecycleState || 'draft'
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.code === 'DUPLICATE_SKU') {
      return res.status(409).json({ success: false, error: error.message, code: error.code });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const getProducts = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { categoryId, productType, lifecycleState, search, limit, skip } = req.query;
    
    const result = await productService.getProducts(orgCode, {
      categoryId,
      productType,
      lifecycleState,
      search,
      limit: limit ? parseInt(limit) : 50,
      skip: skip ? parseInt(skip) : 0
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const orgCode = req.user.orgCode;
    
    const product = await productService.getProductById(productId, orgCode);
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Get product error:', error);
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message, code: error.code });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const getProductBySku = async (req, res) => {
  try {
    const { sku } = req.params;
    const orgCode = req.user.orgCode;
    
    const product = await productService.getProductBySku(sku, orgCode);
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Get product by SKU error:', error);
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message, code: error.code });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const orgCode = req.user.orgCode;
    const { limit, skip } = req.query;
    
    const result = await productService.getProductsByCategory(
      orgCode, 
      categoryId,
      limit ? parseInt(limit) : 50,
      skip ? parseInt(skip) : 0
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const updateData = req.body;
    
    const product = await productService.updateProduct(productId, orgCode, updateData, updatedBy);
    
    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Update product error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
        return res.status(404).json({ 
          success: false, 
          error: error.message, 
          code: error.code 
        });
      case 'IMMUTABLE_FIELD':
        return res.status(400).json({
          success: false,
          error: error.message,
          code: error.code,
          field: error.field,
          currentValue: error.currentValue,
          attemptedValue: error.attemptedValue
        });
      case 'VERSION_MISMATCH':
        return res.status(409).json({
          success: false,
          error: error.message,
          code: error.code,
          clientVersion: error.clientVersion,
          serverVersion: error.serverVersion
        });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({
          success: false,
          error: error.message,
          code: error.code
        });
      case 'INVALID_STATE_TRANSITION':
        return res.status(400).json({
          success: false,
          error: error.message,
          code: error.code,
          currentState: error.currentState,
          requestedState: error.requestedState,
          allowedStates: error.allowedStates
        });
      default:
        return res.status(400).json({ success: false, error: error.message });
    }
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    
    const result = await productService.deleteProduct(productId, orgCode, updatedBy);
    
    res.json({
      success: true,
      data: result,
      message: 'Product archived successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
        return res.status(404).json({ success: false, error: error.message, code: error.code });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      default:
        res.status(400).json({ success: false, error: error.message });
    }
  }
};

const addVariant = async (req, res) => {
  try {
    const { productId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const variantData = req.body;
    
    if (!variantData.sku || !variantData.name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sku, name'
      });
    }
    
    const product = await productService.addVariant(productId, orgCode, variantData, updatedBy);
    
    res.json({
      success: true,
      data: product,
      message: 'Variant added successfully'
    });
  } catch (error) {
    console.error('Add variant error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
        return res.status(404).json({ success: false, error: error.message, code: error.code });
      case 'DUPLICATE_VARIANT_SKU':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      default:
        res.status(400).json({ success: false, error: error.message });
    }
  }
};

const updateVariant = async (req, res) => {
  try {
    const { productId, variantSku } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const updateData = req.body;
    
    const product = await productService.updateVariant(productId, orgCode, variantSku, updateData, updatedBy);
    
    res.json({
      success: true,
      data: product,
      message: 'Variant updated successfully'
    });
  } catch (error) {
    console.error('Update variant error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
      case 'VARIANT_NOT_FOUND':
        return res.status(404).json({ success: false, error: error.message, code: error.code });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      default:
        res.status(400).json({ success: false, error: error.message });
    }
  }
};

const removeVariant = async (req, res) => {
  try {
    const { productId, variantSku } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    
    const product = await productService.removeVariant(productId, orgCode, variantSku, updatedBy);
    
    res.json({
      success: true,
      data: product,
      message: 'Variant removed successfully'
    });
  } catch (error) {
    console.error('Remove variant error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
      case 'VARIANT_NOT_FOUND':
        return res.status(404).json({ success: false, error: error.message, code: error.code });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      default:
        res.status(400).json({ success: false, error: error.message });
    }
  }
};

const addAttribute = async (req, res) => {
  try {
    const { productId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const { key, value, type } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: key, value'
      });
    }
    
    const product = await productService.addAttribute(productId, orgCode, { key, value, type }, updatedBy);
    
    res.json({
      success: true,
      data: product,
      message: 'Attribute added successfully'
    });
  } catch (error) {
    console.error('Add attribute error:', error);
    
    switch (error.code) {
      case 'PRODUCT_NOT_FOUND':
        return res.status(404).json({ success: false, error: error.message, code: error.code });
      case 'DUPLICATE_ATTRIBUTE':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      case 'CONCURRENT_MODIFICATION':
        return res.status(409).json({ success: false, error: error.message, code: error.code });
      default:
        res.status(400).json({ success: false, error: error.message });
    }
  }
};

const updateAttribute = async (req, res) => {
  try {
    const { productId, attributeKey } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const { value, type } = req.body;
    
    const product = await productService.updateAttribute(
      productId, orgCode, attributeKey, { value, type }, updatedBy
    );
    
    res.json({ success: true, data: product, message: 'Attribute updated successfully' });
  } catch (error) {
    console.error('Update attribute error:', error);
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.code === 'ATTRIBUTE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.code === 'CONCURRENT_MODIFICATION') {
      return res.status(409).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const removeAttribute = async (req, res) => {
  try {
    const { productId, attributeKey } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    
    const product = await productService.removeAttribute(productId, orgCode, attributeKey, updatedBy);
    
    res.json({ success: true, data: product, message: 'Attribute removed successfully' });
  } catch (error) {
    console.error('Remove attribute error:', error);
    if (error.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.code === 'ATTRIBUTE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.code === 'CONCURRENT_MODIFICATION') {
      return res.status(409).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProduct,
  getProductBySku,
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
