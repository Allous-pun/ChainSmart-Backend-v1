const StockState = require('./stockModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

const getStock = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, locationId, variantId } = req.query;
    
    const query = { orgCode };
    if (productId) query.productId = productId;
    if (locationId) query.locationId = locationId;
    if (variantId) query.variantId = variantId;
    
    // Fetch settings for stock thresholds
    const pillarSettings = await Settings.findOne({ orgCode });
    const reorderPointThreshold = pillarSettings?.inventory?.reorderPointThreshold || 20;
    const defaultSafetyStockDays = pillarSettings?.inventory?.defaultSafetyStockDays || 7;
    
    const stock = await StockState.find(query).populate('productId', 'name sku');
    
    // Enhance stock data with health indicators based on settings
    const enhancedStock = stock.map(item => {
      const reorderPoint = item.reorderPoint || (item.averageDailyDemand * defaultSafetyStockDays);
      const isLowStock = item.availableStock <= reorderPoint;
      const isCriticalStock = item.availableStock <= (reorderPoint * 0.5);
      const reorderNeeded = item.availableStock <= (reorderPointThreshold / 100 * reorderPoint);
      
      return {
        ...item.toObject(),
        health: {
          isLowStock,
          isCriticalStock,
          reorderNeeded,
          reorderPoint,
          daysUntilStockout: item.averageDailyDemand > 0 ? Math.floor(item.availableStock / item.averageDailyDemand) : null
        }
      };
    });
    
    res.json({ 
      success: true, 
      data: enhancedStock,
      context: {
        reorderPointThreshold,
        defaultSafetyStockDays
      }
    });
  } catch (error) {
    console.error('Get stock error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getStockById = async (req, res) => {
  try {
    const { stockId } = req.params;
    const orgCode = req.user.orgCode;
    
    // Fetch settings for stock analysis
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const reorderPointThreshold = pillarSettings?.inventory?.reorderPointThreshold || 20;
    const defaultSafetyStockDays = pillarSettings?.inventory?.defaultSafetyStockDays || 7;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const stock = await StockState.findOne({ _id: stockId, orgCode }).populate('productId', 'name sku');
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock record not found' });
    }
    
    // Calculate health metrics
    const reorderPoint = stock.reorderPoint || (stock.averageDailyDemand * defaultSafetyStockDays);
    const isLowStock = stock.availableStock <= reorderPoint;
    const isCriticalStock = stock.availableStock <= (reorderPoint * 0.5);
    const reorderNeeded = stock.availableStock <= (reorderPointThreshold / 100 * reorderPoint);
    
    const enhancedStock = {
      ...stock.toObject(),
      health: {
        isLowStock,
        isCriticalStock,
        reorderNeeded,
        reorderPoint,
        daysUntilStockout: stock.averageDailyDemand > 0 ? Math.floor(stock.availableStock / stock.averageDailyDemand) : null,
        stockValue: stock.physicalStock * (stock.averageCost || 0),
        currency: defaultCurrency
      }
    };
    
    res.json({ 
      success: true, 
      data: enhancedStock,
      context: {
        reorderPointThreshold,
        defaultSafetyStockDays,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Get stock by ID error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createOrUpdateStock = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, variantId, locationId, physicalStock, reservedStock, reorderPoint, maxStockLevel, unit, averageDailyDemand, averageCost } = req.body;
    
    if (!productId || !locationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, locationId'
      });
    }
    
    // Fetch settings for default values
    const pillarSettings = await Settings.findOne({ orgCode });
    const defaultSafetyStockDays = pillarSettings?.inventory?.defaultSafetyStockDays || 7;
    const maxStockLevelDefault = pillarSettings?.inventory?.maxStockLevel || 1000;
    
    const availableStock = (physicalStock || 0) - (reservedStock || 0);
    
    // Auto-calculate reorder point if not provided
    let finalReorderPoint = reorderPoint;
    if (!finalReorderPoint && averageDailyDemand) {
      finalReorderPoint = averageDailyDemand * defaultSafetyStockDays;
    }
    
    // Auto-calculate max stock level if not provided
    let finalMaxStockLevel = maxStockLevel;
    if (!finalMaxStockLevel && finalReorderPoint) {
      finalMaxStockLevel = finalReorderPoint * 3; // Standard 3x reorder point
    }
    
    const stock = await StockState.findOneAndUpdate(
      { orgCode, productId, variantId: variantId || null, locationId },
      {
        orgCode,
        productId,
        variantId: variantId || null,
        locationId,
        physicalStock: physicalStock || 0,
        reservedStock: reservedStock || 0,
        availableStock,
        reorderPoint: finalReorderPoint || 0,
        maxStockLevel: finalMaxStockLevel || maxStockLevelDefault,
        unit: unit || 'pcs',
        averageDailyDemand: averageDailyDemand || 0,
        averageCost: averageCost || 0,
        lastCalculatedAt: new Date()
      },
      { upsert: true, returnDocument: 'after' }
    );
    
    // Check if reorder is needed
    const needsReorder = availableStock <= (stock.reorderPoint || 0);
    
    res.json({
      success: true,
      data: stock,
      message: 'Stock updated successfully',
      alert: needsReorder ? `Warning: Stock level (${availableStock}) is at or below reorder point (${stock.reorderPoint})` : null
    });
  } catch (error) {
    console.error('Create/update stock error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const adjustStock = async (req, res) => {
  try {
    const { stockId } = req.params;
    const orgCode = req.user.orgCode;
    const { adjustment, reason, note } = req.body;
    
    if (adjustment === undefined) {
      return res.status(400).json({ success: false, error: 'Adjustment amount is required' });
    }
    
    // Fetch settings for adjustment validation
    const pillarSettings = await Settings.findOne({ orgCode });
    const maxAdjustmentPercent = pillarSettings?.inventory?.maxAdjustmentPercent || 50; // Prevent large adjustments
    
    const stock = await StockState.findOne({ _id: stockId, orgCode });
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock record not found' });
    }
    
    // Validate adjustment isn't too large (safety check)
    const adjustmentPercent = Math.abs(adjustment) / stock.physicalStock * 100;
    if (stock.physicalStock > 0 && adjustmentPercent > maxAdjustmentPercent && reason !== 'system_correction') {
      return res.status(400).json({
        success: false,
        error: `Adjustment of ${adjustmentPercent.toFixed(1)}% exceeds maximum allowed (${maxAdjustmentPercent}%). Use system_correction reason to override.`
      });
    }
    
    const oldPhysicalStock = stock.physicalStock;
    stock.physicalStock += adjustment;
    stock.availableStock = stock.physicalStock - stock.reservedStock;
    stock.lastCalculatedAt = new Date();
    stock.version += 1;
    await stock.save();
    
    // Record transaction
    const InventoryTransaction = require('./transactionModel');
    await InventoryTransaction.create({
      orgCode,
      productId: stock.productId,
      variantId: stock.variantId,
      locationId: stock.locationId,
      type: adjustment > 0 ? 'IN_ADJUSTMENT' : 'OUT_ADJUSTMENT',
      quantity: Math.abs(adjustment),
      stockBefore: oldPhysicalStock,
      stockAfter: stock.physicalStock,
      reason: reason || 'manual_adjustment',
      note,
      createdBy: req.user.id,
      immutable: true
    });
    
    res.json({
      success: true,
      data: stock,
      message: `Stock adjusted by ${adjustment}`,
      context: {
        adjustmentPercent: adjustmentPercent.toFixed(1),
        oldStock: oldPhysicalStock,
        newStock: stock.physicalStock
      }
    });
  } catch (error) {
    console.error('Adjust stock error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getStock,
  getStockById,
  createOrUpdateStock,
  adjustStock
};