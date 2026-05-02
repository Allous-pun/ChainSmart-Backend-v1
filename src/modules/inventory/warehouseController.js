const Warehouse = require('./warehouseModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

const getWarehouses = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { isActive, includeStats } = req.query;
    
    const query = { orgCode };
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    // Fetch organization settings for currency and region
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    const pillarSettings = await Settings.findOne({ orgCode });
    
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    const vehicleCapacity = pillarSettings?.logistics?.vehicleCapacity || 1000;
    
    const warehouses = await Warehouse.find(query);
    
    // Optionally include statistics for each warehouse
    let enhancedWarehouses = warehouses;
    if (includeStats === 'true') {
      const StockState = require('./stockModel');
      const Transfer = require('./transferModel');
      
      enhancedWarehouses = await Promise.all(warehouses.map(async (warehouse) => {
        // Get stock counts
        const stockItems = await StockState.find({
          orgCode,
          locationId: warehouse._id.toString()
        });
        
        const totalStockValue = stockItems.reduce((sum, item) => 
          sum + (item.physicalStock * (item.averageCost || 0)), 0
        );
        
        // Get pending transfers
        const inboundTransfers = await Transfer.countDocuments({
          orgCode,
          toWarehouseId: warehouse._id.toString(),
          status: { $in: ['pending', 'shipped'] }
        });
        
        const outboundTransfers = await Transfer.countDocuments({
          orgCode,
          fromWarehouseId: warehouse._id.toString(),
          status: { $in: ['pending', 'shipped'] }
        });
        
        return {
          ...warehouse.toObject(),
          stats: {
            totalProducts: stockItems.length,
            totalStockValue,
            totalStockValueFormatted: `${defaultCurrency} ${totalStockValue.toLocaleString()}`,
            inboundTransfers,
            outboundTransfers,
            currency: defaultCurrency
          }
        };
      }));
    }
    
    res.json({ 
      success: true, 
      data: enhancedWarehouses,
      context: {
        defaultCurrency,
        vehicleCapacity
      }
    });
  } catch (error) {
    console.error('Get warehouses error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getWarehouseById = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const orgCode = req.user.orgCode;
    
    // Fetch settings for warehouse context
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    const pillarSettings = await Settings.findOne({ orgCode });
    
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    const fuelCostPerKm = pillarSettings?.logistics?.fuelCostPerKm || 150;
    const vehicleCapacity = pillarSettings?.logistics?.vehicleCapacity || 1000;
    
    const warehouse = await Warehouse.findOne({ _id: warehouseId, orgCode });
    if (!warehouse) {
      return res.status(404).json({ success: false, error: 'Warehouse not found' });
    }
    
    // Get warehouse statistics
    const StockState = require('./stockModel');
    const Transfer = require('./transferModel');
    const InventoryTransaction = require('./transactionModel');
    
    const [stockItems, inboundTransfers, outboundTransfers, recentTransactions] = await Promise.all([
      StockState.find({ orgCode, locationId: warehouseId }).populate('productId', 'name sku'),
      Transfer.find({ orgCode, toWarehouseId: warehouseId, status: { $in: ['pending', 'shipped'] } }),
      Transfer.find({ orgCode, fromWarehouseId: warehouseId, status: { $in: ['pending', 'shipped'] } }),
      InventoryTransaction.find({ orgCode, locationId: warehouseId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('productId', 'name sku')
    ]);
    
    const totalStockValue = stockItems.reduce((sum, item) => 
      sum + (item.physicalStock * (item.averageCost || 0)), 0
    );
    
    const totalStockUnits = stockItems.reduce((sum, item) => sum + item.physicalStock, 0);
    const lowStockItems = stockItems.filter(item => 
      item.physicalStock <= (item.reorderPoint || 0)
    );
    
    // Calculate warehouse utilization
    const utilizationPercent = (totalStockUnits / vehicleCapacity) * 100;
    
    const enhancedWarehouse = {
      ...warehouse.toObject(),
      analytics: {
        totalProducts: stockItems.length,
        totalStockUnits,
        totalStockValue,
        totalStockValueFormatted: `${defaultCurrency} ${totalStockValue.toLocaleString()}`,
        lowStockItems: lowStockItems.length,
        lowStockProducts: lowStockItems.map(item => ({
          id: item.productId?._id || item.productId,
          name: item.productId?.name || 'Unknown',
          sku: item.productId?.sku,
          currentStock: item.physicalStock,
          reorderPoint: item.reorderPoint
        })),
        inboundTransfers: inboundTransfers.length,
        outboundTransfers: outboundTransfers.length,
        recentTransactions: recentTransactions.map(t => ({
          id: t._id,
          type: t.type,
          quantity: t.quantity,
          productName: t.productId?.name,
          createdAt: t.createdAt
        })),
        utilizationPercent: Math.min(utilizationPercent, 100),
        currency: defaultCurrency,
        fuelCostPerKm
      }
    };
    
    res.json({ 
      success: true, 
      data: enhancedWarehouse,
      context: {
        defaultCurrency,
        vehicleCapacity,
        fuelCostPerKm
      }
    });
  } catch (error) {
    console.error('Get warehouse error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createWarehouse = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { code, name, locationId, location, address, city, country, contactPerson, contactPhone } = req.body;
    
    if (!code || !name || !location || !location.coordinates) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, name, location.coordinates'
      });
    }
    
    // Fetch organization settings for validation
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    const pillarSettings = await Settings.findOne({ orgCode });
    
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    const maxWarehouses = orgSettings?.subscription?.maxBranches || 3;
    
    // Check warehouse limit based on subscription
    const warehouseCount = await Warehouse.countDocuments({ orgCode, isActive: true });
    if (warehouseCount >= maxWarehouses) {
      return res.status(400).json({
        success: false,
        error: `Warehouse limit reached (${maxWarehouses}). Upgrade your plan to add more warehouses.`
      });
    }
    
    // Check if code already exists
    const existingWarehouse = await Warehouse.findOne({ orgCode, code });
    if (existingWarehouse) {
      return res.status(400).json({
        success: false,
        error: `Warehouse with code ${code} already exists`
      });
    }
    
    const warehouse = await Warehouse.create({
      orgCode,
      code,
      name,
      locationId: locationId || null,
      location: {
        type: 'Point',
        coordinates: location.coordinates
      },
      address: address || null,
      city: city || null,
      country: country || (orgSettings?.region?.country || 'KE'),
      contactPerson: contactPerson || null,
      contactPhone: contactPhone || null,
      isActive: true,
      currency: defaultCurrency
    });
    
    res.status(201).json({
      success: true,
      data: warehouse,
      message: `Warehouse ${name} (${code}) created successfully`,
      context: {
        remainingWarehouseSlots: maxWarehouses - (warehouseCount + 1),
        maxWarehouses,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Create warehouse error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const orgCode = req.user.orgCode;
    const { name, locationId, location, isActive, address, city, country, contactPerson, contactPhone } = req.body;
    
    // Fetch settings for validation
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const updateData = {};
    if (name) updateData.name = name;
    if (locationId !== undefined) updateData.locationId = locationId;
    if (location) updateData.location = location;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (country !== undefined) updateData.country = country;
    if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    
    const warehouse = await Warehouse.findOneAndUpdate(
      { _id: warehouseId, orgCode },
      updateData,
      { new: true }
    );
    
    if (!warehouse) {
      return res.status(404).json({ success: false, error: 'Warehouse not found' });
    }
    
    res.json({
      success: true,
      data: warehouse,
      message: 'Warehouse updated successfully',
      context: {
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Update warehouse error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deleteWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const orgCode = req.user.orgCode;
    
    // Check if warehouse has any stock before deactivating
    const StockState = require('./stockModel');
    const Transfer = require('./transferModel');
    
    const [stockItems, pendingTransfers] = await Promise.all([
      StockState.find({ orgCode, locationId: warehouseId }),
      Transfer.find({
        orgCode,
        $or: [
          { fromWarehouseId: warehouseId, status: { $in: ['pending', 'shipped', 'approved'] } },
          { toWarehouseId: warehouseId, status: { $in: ['pending', 'shipped', 'approved'] } }
        ]
      })
    ]);
    
    const hasStock = stockItems.some(item => item.physicalStock > 0);
    
    if (hasStock) {
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate warehouse with existing stock. Transfer or sell all inventory first.'
      });
    }
    
    if (pendingTransfers.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot deactivate warehouse with ${pendingTransfers.length} pending transfers. Complete or cancel transfers first.`
      });
    }
    
    const warehouse = await Warehouse.findOneAndUpdate(
      { _id: warehouseId, orgCode },
      { isActive: false, deactivatedAt: new Date() },
      { new: true }
    );
    
    if (!warehouse) {
      return res.status(404).json({ success: false, error: 'Warehouse not found' });
    }
    
    res.json({
      success: true,
      data: warehouse,
      message: 'Warehouse deactivated successfully'
    });
  } catch (error) {
    console.error('Delete warehouse error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse
};