const InventoryTransaction = require('./transactionModel');
const StockState = require('./stockModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

const getTransactions = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, locationId, type, limit, skip, fromDate, toDate } = req.query;
    
    const query = { orgCode };
    if (productId) query.productId = productId;
    if (locationId) query.locationId = locationId;
    if (type) query.type = type;
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }
    
    // Fetch settings for default report period
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const defaultReportPeriod = pillarSettings?.reports?.defaultReportPeriod || '30days';
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const transactions = await InventoryTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 100)
      .skip(skip ? parseInt(skip) : 0)
      .populate('productId', 'name sku');
    
    const total = await InventoryTransaction.countDocuments(query);
    
    // Calculate summary statistics
    const summary = {
      totalInbound: transactions.filter(t => t.type.startsWith('IN')).reduce((sum, t) => sum + t.quantity, 0),
      totalOutbound: transactions.filter(t => t.type.startsWith('OUT')).reduce((sum, t) => sum + t.quantity, 0),
      byType: {}
    };
    
    transactions.forEach(t => {
      if (!summary.byType[t.type]) {
        summary.byType[t.type] = { count: 0, quantity: 0 };
      }
      summary.byType[t.type].count++;
      summary.byType[t.type].quantity += t.quantity;
    });
    
    res.json({
      success: true,
      data: { 
        transactions, 
        total, 
        limit: limit || 100, 
        skip: skip || 0,
        summary,
        currency: defaultCurrency
      },
      context: {
        defaultReportPeriod
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const recordTransaction = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { productId, variantId, locationId, type, quantity, reason, note, referenceId, referenceType, unitCost, totalCost } = req.body;
    
    if (!productId || !locationId || !type || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, locationId, type, quantity'
      });
    }
    
    // Fetch settings for validation rules
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const maxAdjustmentPercent = pillarSettings?.inventory?.maxAdjustmentPercent || 50;
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    const wasteAlertThreshold = pillarSettings?.reports?.wasteAlertThreshold || 5;
    
    // Get current stock
    let stock = await StockState.findOne({
      orgCode,
      productId,
      variantId: variantId || null,
      locationId
    });
    
    let stockBefore = 0;
    let stockAfter = 0;
    let validationWarning = null;
    
    if (stock) {
      stockBefore = stock.physicalStock;
      
      // Validate outbound transactions don't exceed available stock
      if (type.startsWith('OUT') && quantity > stock.physicalStock) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock. Available: ${stock.physicalStock}, Requested: ${quantity}`,
          currentStock: stock.physicalStock
        });
      }
      
      // Check for large adjustments (potential errors)
      if (type === 'IN_ADJUSTMENT' || type === 'OUT_ADJUSTMENT') {
        const adjustmentPercent = (quantity / stock.physicalStock) * 100;
        if (stock.physicalStock > 0 && adjustmentPercent > maxAdjustmentPercent && reason !== 'system_correction') {
          validationWarning = `Large adjustment of ${adjustmentPercent.toFixed(1)}% detected. This exceeds the ${maxAdjustmentPercent}% warning threshold.`;
        }
      }
      
      // Check for waste threshold (OUT_ADJUSTMENT with reason 'waste' or 'expired')
      if (type === 'OUT_ADJUSTMENT' && (reason === 'waste' || reason === 'expired')) {
        const wastePercent = (quantity / stock.physicalStock) * 100;
        if (wastePercent > wasteAlertThreshold) {
          validationWarning = `Waste alert: ${quantity} units (${wastePercent.toFixed(1)}%) exceeds threshold of ${wasteAlertThreshold}%.`;
        }
      }
      
      if (type === 'IN_PURCHASE' || type === 'IN_TRANSFER' || type === 'IN_ADJUSTMENT') {
        stock.physicalStock += quantity;
        stock.availableStock = stock.physicalStock - stock.reservedStock;
        stockAfter = stock.physicalStock;
        
        // Update average cost if unit cost provided
        if (unitCost && stock.averageCost) {
          const totalValue = (stock.averageCost * stockBefore) + (unitCost * quantity);
          stock.averageCost = totalValue / stockAfter;
        } else if (unitCost && !stock.averageCost) {
          stock.averageCost = unitCost;
        }
      } else if (type === 'OUT_SALE' || type === 'OUT_TRANSFER' || type === 'OUT_ADJUSTMENT') {
        stock.physicalStock -= quantity;
        stock.availableStock = stock.physicalStock - stock.reservedStock;
        stockAfter = stock.physicalStock;
        
        // Record COGS if sale and we have average cost
        if (type === 'OUT_SALE' && stock.averageCost) {
          const cogsValue = quantity * stock.averageCost;
          validationWarning = validationWarning 
            ? `${validationWarning} COGS: ${cogsValue} ${defaultCurrency}`
            : `COGS: ${cogsValue} ${defaultCurrency}`;
        }
      }
      
      stock.lastTransactionAt = new Date();
      stock.version += 1;
      await stock.save();
    } else {
      if (type.startsWith('OUT')) {
        return res.status(400).json({
          success: false,
          error: 'Cannot record outbound transaction: No stock record exists for this product/location'
        });
      }
      stockAfter = quantity;
      
      // Create initial stock record for inbound transactions
      stock = await StockState.create({
        orgCode,
        productId,
        variantId: variantId || null,
        locationId,
        physicalStock: quantity,
        availableStock: quantity,
        reservedStock: 0,
        unit: 'pcs',
        averageCost: unitCost || 0,
        version: 1
      });
    }
    
    // Create transaction
    const transaction = await InventoryTransaction.create({
      orgCode,
      productId,
      variantId: variantId || null,
      locationId,
      type,
      quantity,
      stockBefore,
      stockAfter,
      unitCost: unitCost || stock.averageCost,
      totalCost: totalCost || (unitCost ? unitCost * quantity : null),
      currency: defaultCurrency,
      reason,
      note,
      referenceId,
      referenceType,
      createdBy: req.user.id,
      immutable: true
    });
    
    // Check if reorder is needed after transaction
    let reorderAlert = null;
    if (stock && stock.availableStock <= (stock.reorderPoint || 0)) {
      reorderAlert = {
        message: `Stock level (${stock.availableStock}) is at or below reorder point (${stock.reorderPoint || 'not set'})`,
        productId: stock.productId,
        locationId: stock.locationId,
        currentStock: stock.availableStock,
        reorderPoint: stock.reorderPoint
      };
    }
    
    // Auto-approval check for purchase orders
    let autoApprovalInfo = null;
    if (type === 'IN_PURCHASE' && referenceType === 'PurchaseOrder' && totalCost && totalCost <= autoApprovalThreshold) {
      autoApprovalInfo = {
        message: `Transaction amount (${totalCost} ${defaultCurrency}) is within auto-approval threshold`,
        threshold: autoApprovalThreshold,
        currency: defaultCurrency
      };
    }
    
    res.status(201).json({
      success: true,
      data: transaction,
      message: 'Transaction recorded successfully',
      warnings: validationWarning ? [validationWarning] : [],
      alerts: {
        reorder: reorderAlert,
        autoApproval: autoApprovalInfo
      },
      context: {
        currency: defaultCurrency,
        stockAfter,
        version: stock.version
      }
    });
  } catch (error) {
    console.error('Record transaction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getTransactions,
  recordTransaction
};