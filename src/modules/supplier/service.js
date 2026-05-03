const {
  Supplier,
  SupplierLocation,
  SupplyOffer,
  ProductPerformanceMetrics,
  SourcingRule,
  ExchangeRate,
  Variant
} = require('./model');
const { geocodeFullAddress } = require('../../utils/geocoding');

// ============ SUPPLIER MANAGEMENT ============

// Helper function to generate supplier code
const generateSupplierCode = async (orgCode, name) => {
  // Get prefix from name (first 3 letters, uppercase)
  let prefix = name
    .replace(/[^a-zA-Z]/g, '')
    .substring(0, 3)
    .toUpperCase();
  
  // If prefix is too short, use 'SUP'
  if (prefix.length < 2) prefix = 'SUP';
  
  // Find the latest supplier with this prefix
  const regex = new RegExp(`^${prefix}\\d{4}$`);
  const latestSupplier = await Supplier.findOne({ 
    orgCode, 
    supplierCode: { $regex: regex } 
  }).sort({ supplierCode: -1 });
  
  let nextNumber = 1;
  if (latestSupplier) {
    const match = latestSupplier.supplierCode.match(/\d+$/);
    if (match) {
      nextNumber = parseInt(match[0]) + 1;
    }
  }
  
  // Format: XXX0001 (3 letters + 4 digits)
  return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
};

const createSupplier = async (data, createdBy) => {
  const { orgCode, name, email, phone, attributes } = data;
  
  // Auto-generate supplier code
  const supplierCode = await generateSupplierCode(orgCode, name);
  
  // Check if supplier with same name exists (optional, can have same name different code)
  const existingSupplier = await Supplier.findOne({ orgCode, name });
  if (existingSupplier) {
    throw new Error(`Supplier with name "${name}" already exists`);
  }
  
  const supplier = await Supplier.create({
    orgCode,
    supplierCode,
    name,
    email,
    phone,
    attributes: attributes || [],
    createdBy,
    updatedBy: createdBy,
    status: 'active'
  });
  
  return supplier;
};

const getSuppliers = async (orgCode, filters = {}) => {
  const query = { orgCode };
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { supplierCode: { $regex: filters.search, $options: 'i' } }
    ];
  }
  
  const suppliers = await Supplier.find(query).sort({ createdAt: -1 });
  return suppliers;
};

const getSupplierById = async (supplierId, orgCode) => {
  const supplier = await Supplier.findOne({ _id: supplierId, orgCode });
  if (!supplier) {
    throw new Error('Supplier not found');
  }
  return supplier;
};

const updateSupplier = async (supplierId, orgCode, updateData, updatedBy) => {
  const supplier = await Supplier.findOneAndUpdate(
    { _id: supplierId, orgCode },
    { ...updateData, updatedBy, updatedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!supplier) {
    throw new Error('Supplier not found');
  }
  return supplier;
};

const deleteSupplier = async (supplierId, orgCode) => {
  const supplier = await Supplier.findOneAndUpdate(
    { _id: supplierId, orgCode },
    { status: 'inactive', updatedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!supplier) {
    throw new Error('Supplier not found');
  }
  return { id: supplier._id, deleted: true };
};

// ============ SUPPLIER LOCATIONS ============

const addSupplierLocation = async (data, createdBy) => {
  const { 
    orgCode, supplierId, name, type, address, 
    region, country, city, contactPerson, contactEmail, contactPhone 
  } = data;
  
  // Build full address string
  const fullAddress = `${address}, ${city || ''}, ${region || ''}, ${country || 'Kenya'}`;
  
  // Geocode the address to get coordinates
  const geocodingResult = await geocodeFullAddress(fullAddress);
  
  let location = null;
  let formattedAddress = address;
  
  if (geocodingResult) {
    location = {
      type: 'Point',
      coordinates: [geocodingResult.longitude, geocodingResult.latitude]
    };
    formattedAddress = geocodingResult.formattedAddress;
  } else {
    throw new Error(`Could not geocode address: ${fullAddress}`);
  }
  
  const locationData = await SupplierLocation.create({
    orgCode,
    supplierId,
    name,
    type: type || 'warehouse',
    address: formattedAddress,
    location,
    region,
    country,
    city,
    contactPerson,
    contactEmail,
    contactPhone,
    isActive: true
  });
  
  return locationData;
};

const getSupplierLocations = async (orgCode, supplierId = null) => {
  const query = { orgCode, isActive: true };
  if (supplierId) query.supplierId = supplierId;
  
  // Populate supplierId with supplier name and code
  const locations = await SupplierLocation.find(query).populate('supplierId', 'name supplierCode email phone');
  
  return locations;
};

// ============ SUPPLY OFFERS ============

const createSupplyOffer = async (data, createdBy) => {
  const { orgCode, supplierId, locationId, productId, variantId, ...offerData } = data;
  
  const offer = await SupplyOffer.create({
    orgCode,
    supplierId,
    locationId,
    productId,
    variantId: variantId || null,
    ...offerData,
    createdBy,
    updatedBy: createdBy,
    isActive: true
  });
  
  return offer;
};

const getSupplyOffers = async (orgCode, productId = null, supplierId = null) => {
  const query = { orgCode, isActive: true };
  if (productId) query.productId = productId;
  if (supplierId) query.supplierId = supplierId;
  
  return await SupplyOffer.find(query).populate('supplierId', 'name supplierCode');
};

const updateSupplyOffer = async (offerId, orgCode, updateData, updatedBy) => {
  const offer = await SupplyOffer.findOneAndUpdate(
    { _id: offerId, orgCode },
    { ...updateData, updatedBy, updatedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!offer) {
    throw new Error('Supply offer not found');
  }
  return offer;
};

// ============ RANKING & COMPARISON (KILLER FEATURE) ============

const rankOffers = async (productId, context, exchangeRateService = null) => {
  if (!productId) throw new Error('productId is required');
  if (!context?.destinationLocationId) throw new Error('destinationLocationId is required');
  if (!context?.quantity) throw new Error('quantity is required');
  
  // Use weights from context (already enriched with settings)
  const weights = context.weights || null;
  
  // The model handles all the heavy computation
  const rankedOffers = await SupplyOffer.getRankedOffers(
    productId,
    context,
    weights,
    exchangeRateService
  );
  
  return rankedOffers;
};

const evaluateSourcingRules = async (ruleId, context, exchangeRateService = null) => {
  const rule = await SourcingRule.findById(ruleId);
  if (!rule) throw new Error('Sourcing rule not found');
  
  const result = await rule.evaluate(context, exchangeRateService);
  return result;
};

// ============ SOURCING RULES ============

const createSourcingRule = async (data, createdBy) => {
  const { orgCode, productId, rules, fallbackStrategy } = data;
  
  const rule = await SourcingRule.create({
    orgCode,
    productId,
    rules,
    fallbackStrategy: fallbackStrategy || 'balanced',
    createdBy
  });
  
  return rule;
};

const getSourcingRules = async (orgCode, productId = null) => {
  const query = { orgCode };
  if (productId) query.productId = productId;
  
  return await SourcingRule.find(query);
};

// ============ PERFORMANCE METRICS ============

const updatePerformanceMetrics = async (data) => {
  const { orgCode, supplierId, productId, period, periodDate, metrics } = data;
  
  const record = await ProductPerformanceMetrics.findOneAndUpdate(
    { orgCode, supplierId, productId, period, periodDate },
    { ...metrics, updatedAt: new Date() },
    { returnDocument: 'after', upsert: true }
  );
  
  // Update supplier performance summary
  const allMetrics = await ProductPerformanceMetrics.find({
    orgCode,
    supplierId,
    periodDate: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
  });
  
  const avgOnTime = allMetrics.reduce((sum, m) => sum + (m.onTimeDeliveryRate || 0), 0) / allMetrics.length;
  const avgQuality = allMetrics.reduce((sum, m) => sum + (m.qualityScore || 0), 0) / allMetrics.length;
  
  await Supplier.findOneAndUpdate(
    { _id: supplierId, orgCode },
    {
      'performanceSummary.overallScore': (avgOnTime + avgQuality) / 2,
      'performanceSummary.onTimeRate': avgOnTime,
      'performanceSummary.qualityScore': avgQuality,
      'performanceSummary.lastUpdated': new Date()
    }
  );
  
  return record;
};

module.exports = {
  // Supplier
  createSupplier,
  getSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
  
  // Locations
  addSupplierLocation,
  getSupplierLocations,
  
  // Supply Offers
  createSupplyOffer,
  getSupplyOffers,
  updateSupplyOffer,
  
  // Ranking (KILLER FEATURE)
  rankOffers,
  evaluateSourcingRules,
  
  // Sourcing Rules
  createSourcingRule,
  getSourcingRules,
  
  // Performance
  updatePerformanceMetrics
};