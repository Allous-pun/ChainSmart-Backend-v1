const supplierService = require('./service');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

// ============ SUPPLIER CRUD ============

const createSupplier = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { name, email, phone, attributes } = req.body;  // Remove supplierCode - auto-generated
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name'
      });
    }
    
    const supplier = await supplierService.createSupplier({
      orgCode,
      name,
      email,
      phone,
      attributes
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: supplier,
      message: `Supplier created successfully. Code: ${supplier.supplierCode}`
    });
  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getSuppliers = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status, search } = req.query;
    
    const suppliers = await supplierService.getSuppliers(orgCode, { status, search });
    res.json({ success: true, data: suppliers });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getSupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const orgCode = req.user.orgCode;
    
    const supplier = await supplierService.getSupplierById(supplierId, orgCode);
    res.json({ success: true, data: supplier });
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const updateSupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const { name, email, phone, attributes, status } = req.body;
    
    const supplier = await supplierService.updateSupplier(supplierId, orgCode, {
      name,
      email,
      phone,
      attributes,
      status
    }, updatedBy);
    
    res.json({
      success: true,
      data: supplier,
      message: 'Supplier updated successfully'
    });
  } catch (error) {
    console.error('Update supplier error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const deleteSupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const orgCode = req.user.orgCode;
    
    const result = await supplierService.deleteSupplier(supplierId, orgCode);
    res.json({
      success: true,
      data: result,
      message: 'Supplier deactivated successfully'
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// ============ SUPPLIER LOCATIONS ============

const addLocation = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { 
      supplierId, name, type, address, region, country, city, 
      contactPerson, contactEmail, contactPhone 
    } = req.body;
    
    // Remove 'location' from required fields - it will be auto-geocoded
    if (!supplierId || !name || !address || !country) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: supplierId, name, address, country'
      });
    }
    
    const locationData = await supplierService.addSupplierLocation({
      orgCode,
      supplierId,
      name,
      type,
      address,
      region,
      country,
      city,
      contactPerson,
      contactEmail,
      contactPhone
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: locationData,
      message: 'Supplier location added successfully'
    });
  } catch (error) {
    console.error('Add location error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getLocations = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { supplierId } = req.query;
    
    const locations = await supplierService.getSupplierLocations(orgCode, supplierId);
    res.json({ success: true, data: locations });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// ============ SUPPLY OFFERS ============

const createSupplyOffer = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const offerData = req.body;
    
    if (!offerData.supplierId || !offerData.locationId || !offerData.productId || !offerData.basePrice) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: supplierId, locationId, productId, basePrice'
      });
    }
    
    const offer = await supplierService.createSupplyOffer({
      orgCode,
      ...offerData
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: offer,
      message: 'Supply offer created successfully'
    });
  } catch (error) {
    console.error('Create supply offer error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getSupplyOffers = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, supplierId } = req.query;
    
    const offers = await supplierService.getSupplyOffers(orgCode, productId, supplierId);
    res.json({ success: true, data: offers });
  } catch (error) {
    console.error('Get supply offers error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const updateSupplyOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const orgCode = req.user.orgCode;
    const updatedBy = req.user.id;
    const updateData = req.body;
    
    const offer = await supplierService.updateSupplyOffer(offerId, orgCode, updateData, updatedBy);
    
    res.json({
      success: true,
      data: offer,
      message: 'Supply offer updated successfully'
    });
  } catch (error) {
    console.error('Update supply offer error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// ============ RANKING (KILLER FEATURE) ============

const rankOffers = async (req, res) => {
  try {
    const { productId } = req.params;
    const context = req.body;
    const orgCode = req.user.orgCode;
    
    // Fetch organization settings for currency and region
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    const pillarSettings = await Settings.findOne({ orgCode });
    
    // Merge context with organization defaults
    const enrichedContext = {
      ...context,
      currency: context.currency || orgSettings?.region?.defaultCurrency || 'KES',
      // Use settings weightages if not provided in request
      weights: context.weights || pillarSettings?.supplier?.comparisonWeightage || {
        price: 50,
        deliveryTime: 30,
        reliability: 20
      }
    };
    
    const results = await supplierService.rankOffers(
      productId,
      enrichedContext,
      req.exchangeRateService || null
    );
    
    res.status(200).json({
      success: true,
      count: results.length,
      data: results,
      context: {
        currency: enrichedContext.currency,
        weights: enrichedContext.weights
      }
    });
  } catch (error) {
    console.error('Rank offers error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const evaluateRules = async (req, res) => {
  try {
    const { ruleId } = req.params;
    const { context } = req.body;
    
    const result = await supplierService.evaluateSourcingRules(
      ruleId,
      context,
      req.exchangeRateService || null
    );
    
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Evaluate rules error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ============ SOURCING RULES ============

const createSourcingRule = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { productId, rules, fallbackStrategy } = req.body;
    
    if (!productId || !rules) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, rules'
      });
    }
    
    const rule = await supplierService.createSourcingRule({
      orgCode,
      productId,
      rules,
      fallbackStrategy
    }, createdBy);
    
    res.status(201).json({
      success: true,
      data: rule,
      message: 'Sourcing rule created successfully'
    });
  } catch (error) {
    console.error('Create sourcing rule error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getSourcingRules = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId } = req.query;
    
    const rules = await supplierService.getSourcingRules(orgCode, productId);
    res.json({ success: true, data: rules });
  } catch (error) {
    console.error('Get sourcing rules error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// ============ PERFORMANCE ============

const updatePerformance = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { supplierId, productId, period, periodDate, metrics } = req.body;
    
    const record = await supplierService.updatePerformanceMetrics({
      orgCode,
      supplierId,
      productId,
      period,
      periodDate,
      metrics
    });
    
    res.json({
      success: true,
      data: record,
      message: 'Performance metrics updated'
    });
  } catch (error) {
    console.error('Update performance error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  // Supplier
  createSupplier,
  getSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  
  // Locations
  addLocation,
  getLocations,
  
  // Supply Offers
  createSupplyOffer,
  getSupplyOffers,
  updateSupplyOffer,
  
  // Ranking (KILLER FEATURE)
  rankOffers,
  evaluateRules,
  
  // Sourcing Rules
  createSourcingRule,
  getSourcingRules,
  
  // Performance
  updatePerformance
};