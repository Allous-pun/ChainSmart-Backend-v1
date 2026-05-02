const Transfer = require('./transferModel');
const StockState = require('./stockModel');
const InventoryTransaction = require('./transactionModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

const getTransfers = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status, fromWarehouseId, toWarehouseId, limit, skip } = req.query;
    
    const query = { orgCode };
    if (status) query.status = status;
    if (fromWarehouseId) query.fromWarehouseId = fromWarehouseId;
    if (toWarehouseId) query.toWarehouseId = toWarehouseId;
    
    // Fetch settings for logistics defaults
    const pillarSettings = await Settings.findOne({ orgCode });
    const maxDeliveryStopsPerRoute = pillarSettings?.logistics?.maxDeliveryStopsPerRoute || 10;
    const vehicleCapacity = pillarSettings?.logistics?.vehicleCapacity || 1000;
    const fuelCostPerKm = pillarSettings?.logistics?.fuelCostPerKm || 150;
    
    const transfers = await Transfer.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 50)
      .skip(skip ? parseInt(skip) : 0)
      .populate('items.productId', 'name sku');
    
    const total = await Transfer.countDocuments(query);
    
    // Calculate transfer statistics
    const stats = {
      totalTransfers: transfers.length,
      pending: transfers.filter(t => t.status === 'pending').length,
      inTransit: transfers.filter(t => t.status === 'shipped').length,
      completed: transfers.filter(t => t.status === 'received').length,
      cancelled: transfers.filter(t => t.status === 'cancelled').length,
      totalItemsShipped: transfers.reduce((sum, t) => sum + t.items.reduce((s, i) => s + i.quantity, 0), 0)
    };
    
    res.json({ 
      success: true, 
      data: { transfers, total, limit: limit || 50, skip: skip || 0, stats },
      context: {
        maxDeliveryStopsPerRoute,
        vehicleCapacity,
        fuelCostPerKm
      }
    });
  } catch (error) {
    console.error('Get transfers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getTransferById = async (req, res) => {
  try {
    const { transferId } = req.params;
    const orgCode = req.user.orgCode;
    
    // Fetch settings for cost calculation
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const fuelCostPerKm = pillarSettings?.logistics?.fuelCostPerKm || 150;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const transfer = await Transfer.findOne({ _id: transferId, orgCode })
      .populate('items.productId', 'name sku');
    
    if (!transfer) {
      return res.status(404).json({ success: false, error: 'Transfer not found' });
    }
    
    // Calculate estimated cost if distance available
    let estimatedCost = null;
    if (transfer.distanceKm) {
      estimatedCost = transfer.distanceKm * fuelCostPerKm;
    }
    
    // Calculate total quantity and value
    const totalQuantity = transfer.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = transfer.items.reduce((sum, item) => sum + (item.quantity * (item.unitCost || 0)), 0);
    
    res.json({ 
      success: true, 
      data: {
        ...transfer.toObject(),
        analytics: {
          totalQuantity,
          totalValue,
          estimatedTransportCost: estimatedCost,
          currency: defaultCurrency,
          costPerUnit: totalQuantity > 0 ? (estimatedCost / totalQuantity) : null
        }
      },
      context: {
        fuelCostPerKm,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Get transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createTransfer = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { fromWarehouseId, toWarehouseId, items, source, distanceKm, notes, priority } = req.body;
    
    if (!fromWarehouseId || !toWarehouseId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fromWarehouseId, toWarehouseId, items'
      });
    }
    
    // Fetch settings for transfer validation
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const vehicleCapacity = pillarSettings?.logistics?.vehicleCapacity || 1000;
    const maxDeliveryStopsPerRoute = pillarSettings?.logistics?.maxDeliveryStopsPerRoute || 10;
    const fuelCostPerKm = pillarSettings?.logistics?.fuelCostPerKm || 150;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    // Validate total quantity doesn't exceed vehicle capacity
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity > vehicleCapacity) {
      return res.status(400).json({
        success: false,
        error: `Total quantity (${totalQuantity}) exceeds vehicle capacity (${vehicleCapacity})`
      });
    }
    
    // Check stock availability at source warehouse
    for (const item of items) {
      const sourceStock = await StockState.findOne({
        orgCode,
        productId: item.productId,
        variantId: item.variantId || null,
        locationId: fromWarehouseId
      });
      
      if (!sourceStock || sourceStock.physicalStock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock for product ${item.productId}. Available: ${sourceStock?.physicalStock || 0}, Required: ${item.quantity}`
        });
      }
    }
    
    // Check if transfer would exceed max stops per route
    const existingTransfers = await Transfer.countDocuments({
      orgCode,
      fromWarehouseId,
      toWarehouseId,
      status: { $in: ['pending', 'shipped'] }
    });
    
    if (existingTransfers >= maxDeliveryStopsPerRoute) {
      return res.status(400).json({
        success: false,
        error: `Maximum concurrent transfers (${maxDeliveryStopsPerRoute}) exceeded for this route. Complete existing transfers first.`
      });
    }
    
    const transferNumber = `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Calculate estimated transport cost
    const estimatedTransportCost = distanceKm ? distanceKm * fuelCostPerKm : null;
    
    const transfer = await Transfer.create({
      transferNumber,
      orgCode,
      fromWarehouseId,
      toWarehouseId,
      items,
      status: 'pending',
      createdBy,
      source: source || 'manual',
      distanceKm: distanceKm || null,
      notes: notes || null,
      priority: priority || 'normal',
      estimatedTransportCost,
      currency: defaultCurrency
    });
    
    // Reserve stock at source warehouse
    for (const item of items) {
      await StockState.findOneAndUpdate(
        {
          orgCode,
          productId: item.productId,
          variantId: item.variantId || null,
          locationId: fromWarehouseId
        },
        { $inc: { reservedStock: item.quantity } }
      );
    }
    
    res.status(201).json({
      success: true,
      data: transfer,
      message: `Transfer ${transferNumber} created successfully`,
      context: {
        vehicleCapacity,
        maxDeliveryStopsPerRoute,
        fuelCostPerKm,
        currency: defaultCurrency,
        estimatedTransportCost
      }
    });
  } catch (error) {
    console.error('Create transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateTransferStatus = async (req, res) => {
  try {
    const { transferId } = req.params;
    const orgCode = req.user.orgCode;
    const { status, actualCost, trackingNumber } = req.body;
    
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const holdingCostPercent = pillarSettings?.costSimulation?.holdingCostPercent || 15;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const transfer = await Transfer.findOne({ _id: transferId, orgCode });
    if (!transfer) {
      return res.status(404).json({ success: false, error: 'Transfer not found' });
    }
    
    // Validate status transitions
    const validTransitions = {
      pending: ['approved', 'cancelled'],
      approved: ['shipped', 'cancelled'],
      shipped: ['received', 'lost', 'cancelled'],
      received: [],
      lost: [],
      cancelled: []
    };
    
    if (!validTransitions[transfer.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition from ${transfer.status} to ${status}`
      });
    }
    
    // If shipping, verify stock is still available
    if (status === 'shipped' && transfer.status === 'approved') {
      for (const item of transfer.items) {
        const sourceStock = await StockState.findOne({
          orgCode,
          productId: item.productId,
          variantId: item.variantId || null,
          locationId: transfer.fromWarehouseId
        });
        
        if (!sourceStock || sourceStock.physicalStock < item.quantity) {
          return res.status(400).json({
            success: false,
            error: `Stock no longer available for product ${item.productId}. Available: ${sourceStock?.physicalStock || 0}, Required: ${item.quantity}`
          });
        }
      }
    }
    
    // If receiving, update stock (move from reserved to actual out, and add to destination)
    if (status === 'received' && transfer.status === 'shipped') {
      for (const item of transfer.items) {
        // Decrease stock and reserved at source warehouse
        const sourceStock = await StockState.findOne({
          orgCode,
          productId: item.productId,
          variantId: item.variantId || null,
          locationId: transfer.fromWarehouseId
        });
        
        if (sourceStock) {
          const oldStock = sourceStock.physicalStock;
          sourceStock.physicalStock -= item.quantity;
          sourceStock.reservedStock -= item.quantity;
          sourceStock.availableStock = sourceStock.physicalStock - sourceStock.reservedStock;
          sourceStock.version += 1;
          await sourceStock.save();
          
          // Record outgoing transaction
          await InventoryTransaction.create({
            orgCode,
            productId: item.productId,
            variantId: item.variantId,
            locationId: transfer.fromWarehouseId,
            type: 'OUT_TRANSFER',
            quantity: item.quantity,
            stockBefore: oldStock,
            stockAfter: sourceStock.physicalStock,
            referenceId: transfer._id,
            referenceType: 'Transfer',
            reason: 'transfer_out',
            createdBy: 'system',
            immutable: true,
            unitCost: item.unitCost,
            totalCost: item.unitCost ? item.unitCost * item.quantity : null,
            currency: defaultCurrency
          });
        }
        
        // Increase stock at destination warehouse
        let destStock = await StockState.findOne({
          orgCode,
          productId: item.productId,
          variantId: item.variantId || null,
          locationId: transfer.toWarehouseId
        });
        
        let oldDestStock = destStock ? destStock.physicalStock : 0;
        
        if (destStock) {
          destStock.physicalStock += item.quantity;
          destStock.availableStock = destStock.physicalStock - destStock.reservedStock;
          destStock.version += 1;
          await destStock.save();
        } else {
          destStock = await StockState.create({
            orgCode,
            productId: item.productId,
            variantId: item.variantId || null,
            locationId: transfer.toWarehouseId,
            physicalStock: item.quantity,
            availableStock: item.quantity,
            reservedStock: 0,
            unit: 'pcs',
            version: 1,
            averageCost: item.unitCost || 0
          });
        }
        
        // Record incoming transaction
        await InventoryTransaction.create({
          orgCode,
          productId: item.productId,
          variantId: item.variantId,
          locationId: transfer.toWarehouseId,
          type: 'IN_TRANSFER',
          quantity: item.quantity,
          stockBefore: oldDestStock,
          stockAfter: destStock.physicalStock,
          referenceId: transfer._id,
          referenceType: 'Transfer',
          reason: 'transfer_in',
          createdBy: 'system',
          immutable: true,
          unitCost: item.unitCost,
          totalCost: item.unitCost ? item.unitCost * item.quantity : null,
          currency: defaultCurrency
        });
      }
      
      // Calculate holding cost savings if applicable
      if (transfer.distanceKm && transfer.estimatedTransportCost) {
        const actualTransportCost = actualCost || transfer.estimatedTransportCost;
        const holdingCostSavings = (transfer.totalValue || 0) * (holdingCostPercent / 100);
        
        transfer.actualTransportCost = actualTransportCost;
        transfer.totalCost = actualTransportCost;
        transfer.holdingCostSavings = holdingCostSavings;
      }
    }
    
    // If cancelled, release reserved stock
    if (status === 'cancelled' && transfer.status === 'pending') {
      for (const item of transfer.items) {
        await StockState.findOneAndUpdate(
          {
            orgCode,
            productId: item.productId,
            variantId: item.variantId || null,
            locationId: transfer.fromWarehouseId
          },
          { $inc: { reservedStock: -item.quantity } }
        );
      }
    }
    
    const updateData = {
      status,
      updatedAt: new Date()
    };
    
    if (trackingNumber) updateData.trackingNumber = trackingNumber;
    if (actualCost) updateData.actualTransportCost = actualCost;
    if (status === 'received') updateData.receivedAt = new Date();
    if (status === 'shipped') updateData.shippedAt = new Date();
    
    const updatedTransfer = await Transfer.findOneAndUpdate(
      { _id: transferId, orgCode },
      updateData,
      { new: true }
    );
    
    res.json({
      success: true,
      data: updatedTransfer,
      message: `Transfer status updated to ${status}`,
      context: {
        holdingCostPercent,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Update transfer status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getTransfers,
  getTransferById,
  createTransfer,
  updateTransferStatus
};