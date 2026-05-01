/**
 * SKU Generator - Creates unique SKUs from product names
 * Format: [ORG_CODE]-[CATEGORY_CODE]-[PRODUCT_CODE]-[SEQUENCE]
 */

const { Product } = require('../modules/products/model');

// Category to code mapping
const categoryCodeMap = {
  'raw_material': 'RM',
  'finished_good': 'FG',
  'consumable': 'CS',
  'service': 'SV'
};

// Generate base SKU from name
const generateBaseSku = (name, productType) => {
  // Remove special characters and convert to uppercase
  const cleanName = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)  // Take first 3 words
    .map(word => word.substring(0, 3))  // Take first 3 letters of each word
    .join('');
  
  const typeCode = categoryCodeMap[productType] || 'PRD';
  
  return `${typeCode}-${cleanName}`;
};

// Generate unique SKU with sequence number
const generateUniqueSku = async (orgCode, name, productType) => {
  const baseSku = generateBaseSku(name, productType);
  
  // Check if SKU exists
  const existingProduct = await Product.findOne({ 
    orgCode, 
    sku: { $regex: `^${baseSku}` } 
  }).sort({ sku: -1 });
  
  if (!existingProduct) {
    return `${baseSku}-001`;
  }
  
  // Extract sequence number from existing SKU
  const lastSku = existingProduct.sku;
  const match = lastSku.match(/-(\d+)$/);
  
  if (match) {
    const nextNumber = parseInt(match[1]) + 1;
    return `${baseSku}-${nextNumber.toString().padStart(3, '0')}`;
  }
  
  return `${baseSku}-001`;
};

// Alternative: Simple sequential SKU with org prefix
const generateSimpleSku = async (orgCode, productType) => {
  const prefix = productType === 'raw_material' ? 'RM' :
                 productType === 'finished_good' ? 'FG' :
                 productType === 'consumable' ? 'CS' : 'SV';
  
  // Count existing products of this type
  const count = await Product.countDocuments({ 
    orgCode, 
    productType,
    sku: { $regex: `^${orgCode}-${prefix}` }
  });
  
  const sequence = (count + 1).toString().padStart(5, '0');
  return `${orgCode}-${prefix}-${sequence}`;
};

module.exports = {
  generateBaseSku,
  generateUniqueSku,
  generateSimpleSku,
  categoryCodeMap
};