const PurchaseOrder = require('./purchaseOrderModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');
const emissionsService = require('../emissions/service');

const getPurchaseOrders = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status, supplierId, limit, skip } = req.query;
    
    const query = { orgCode };
    if (status) query.status = status;
    if (supplierId) query.supplierId = supplierId;
    
    const po = await PurchaseOrder.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 50)
      .skip(skip ? parseInt(skip) : 0)
      .populate('supplierId', 'name supplierCode');
    
    const total = await PurchaseOrder.countDocuments(query);
    
    res.json({ success: true, data: { po, total, limit: limit || 50, skip: skip || 0 } });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getPurchaseOrderById = async (req, res) => {
  try {
    const { poId } = req.params;
    const orgCode = req.user.orgCode;
    
    const po = await PurchaseOrder.findOne({ _id: poId, orgCode })
      .populate('supplierId', 'name supplierCode')
      .populate('items.productId', 'name sku');
    
    if (!po) {
      return res.status(404).json({ success: false, error: 'Purchase order not found' });
    }
    
    // Get emissions data if available
    let emissionsData = null;
    try {
      const emissions = await emissionsService.getEmissionByReference(po._id.toString(), 'purchase_order', orgCode);
      if (emissions) {
        emissionsData = {
          co2Emitted: emissions.co2Emitted,
          co2PerKm: emissions.co2PerKm,
          distanceKm: emissions.distanceKm,
          transportMode: emissions.transportMode,
          calculationMethod: emissions.calculationMethod
        };
      }
    } catch (emissionsErr) {
      console.error(`[Emissions] Failed to fetch for PO ${po.poNumber}:`, emissionsErr.message);
    }
    
    res.json({ 
      success: true, 
      data: {
        ...po.toObject(),
        emissions: emissionsData
      }
    });
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createPurchaseOrder = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const createdBy = req.user.id;
    const { supplierId, supplyOfferId, destinationWarehouseId, items, subtotal, totalAmount } = req.body;
    
    if (!supplierId || !destinationWarehouseId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: supplierId, destinationWarehouseId, items'
      });
    }
    
    // Fetch settings for auto-approval and lead time defaults
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultLeadTimeDays = pillarSettings?.procurement?.defaultLeadTimeDays || 5;
    const preferredOrderCadence = pillarSettings?.procurement?.preferredOrderCadence || 'weekly';
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    // Auto-approve if total amount is below threshold
    const orderTotal = totalAmount || subtotal || 0;
    const initialStatus = orderTotal <= autoApprovalThreshold ? 'approved' : 'pending_approval';
    
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Calculate expected delivery date based on lead time
    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + defaultLeadTimeDays);
    
    const po = await PurchaseOrder.create({
      poNumber,
      orgCode,
      supplierId,
      supplyOfferId,
      destinationWarehouseId,
      items,
      subtotal: subtotal || 0,
      totalAmount: totalAmount || 0,
      status: initialStatus,
      createdBy,
      source: 'manual',
      expectedDeliveryDate,
      currency: defaultCurrency,
      autoApproved: orderTotal <= autoApprovalThreshold
    });
    
    res.status(201).json({
      success: true,
      data: po,
      message: `Purchase order ${poNumber} created successfully with status: ${initialStatus}`,
      context: {
        autoApprovalThreshold,
        defaultLeadTimeDays,
        preferredOrderCadence,
        currency: defaultCurrency
      }
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { poId } = req.params;
    const orgCode = req.user.orgCode;
    const { status } = req.body;
    
    // Fetch settings for validation rules
    const pillarSettings = await Settings.findOne({ orgCode });
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    
    const po = await PurchaseOrder.findOne({ _id: poId, orgCode }).populate('supplierId', 'name supplierCode');
    
    if (!po) {
      return res.status(404).json({ success: false, error: 'Purchase order not found' });
    }
    
    // Validate status transition
    const validTransitions = {
      draft: ['pending_approval', 'cancelled'],
      pending_approval: ['approved', 'rejected', 'cancelled'],
      approved: ['ordered', 'cancelled'],
      ordered: ['shipped', 'cancelled'],
      shipped: ['received', 'cancelled'],
      received: [],
      rejected: [],
      cancelled: []
    };
    
    if (!validTransitions[po.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition from ${po.status} to ${status}`
      });
    }
    
    // Auto-approve check if moving to approved
    if (status === 'approved' && po.totalAmount <= autoApprovalThreshold) {
      // Already meets criteria, proceed
    }
    
    // If receiving, calculate and record emissions
    if (status === 'received') {
      // Calculate and record emissions for this purchase order
      try {
        // Calculate total weight from items
        let totalWeight = 0;
        let totalQuantity = 0;
        
        for (const item of po.items) {
          totalQuantity += item.quantity;
          // Estimate weight: if product has weight, use it, otherwise default to 1kg per unit
          let weightPerUnit = 1;
          if (item.productId && typeof item.productId !== 'string') {
            // If product is populated, try to get weight
            if (item.productId.weight) weightPerUnit = item.productId.weight;
          }
          totalWeight += weightPerUnit * item.quantity;
        }
        
        // Get supplier location to calculate distance
        let estimatedDistance = 100; // Default km
        let supplierLocation = null;
        
        // Try to get supplier location
        if (po.supplierId && typeof po.supplierId !== 'string') {
          const Supplier = require('../supplier/model');
          const supplier = await Supplier.findById(po.supplierId._id).populate('locations');
          if (supplier && supplier.locations && supplier.locations.length > 0) {
            // Use first location as origin
            supplierLocation = supplier.locations[0];
          }
        }
        
        // Get warehouse location for destination
        let warehouseLocation = null;
        const Warehouse = require('./warehouseModel');
        const warehouse = await Warehouse.findOne({ locationId: po.destinationWarehouseId });
        if (warehouse && warehouse.location) {
          warehouseLocation = warehouse.location.coordinates;
        }
        
        // Calculate actual distance if both locations have coordinates
        if (supplierLocation && supplierLocation.coordinates && warehouseLocation) {
          const { calculateDrivingDistance } = require('../../utils/geocoding');
          const distanceResult = await calculateDrivingDistance(
            supplierLocation.coordinates[1], supplierLocation.coordinates[0],
            warehouseLocation[1], warehouseLocation[0]
          );
          estimatedDistance = distanceResult.distanceKm;
        }
        
        // Get emissions factors from settings
        const emissionsSettings = await Settings.findOne({ orgCode });
        const co2FactorPerKmPerTon = emissionsSettings?.emissions?.co2FactorPerKm || 0.12;
        
        // Calculate CO2 emissions
        const weightInTons = totalWeight / 1000;
        const co2Emitted = estimatedDistance * co2FactorPerKmPerTon * weightInTons;
        const co2PerKm = co2FactorPerKmPerTon * weightInTons;
        const co2PerUnit = totalQuantity > 0 ? co2Emitted / totalQuantity : 0;
        
        if (co2Emitted > 0) {
          await emissionsService.saveEmissionRecord({
            referenceId: po._id.toString(),
            referenceType: 'purchase_order',
            poNumber: po.poNumber,
            productId: po.items[0]?.productId,
            productName: po.items[0]?.productId?.name,
            quantity: totalQuantity,
            weightKg: totalWeight,
            fromLocationId: po.supplierId?._id?.toString(),
            toLocationId: po.destinationWarehouseId,
            distanceKm: estimatedDistance,
            transportMode: 'road',
            vehicleType: 'truck',
            co2Emitted: co2Emitted,
            co2PerKm: co2PerKm,
            co2PerUnit: co2PerUnit,
            calculationMethod: supplierLocation && warehouseLocation ? 'geocoded' : 'estimated'
          }, orgCode, 'system');
          
          await emissionsService.updateMonthlySummary(orgCode, new Date().getFullYear(), new Date().getMonth() + 1, {
            co2Emitted: co2Emitted,
            referenceType: 'purchase_order',
            transportMode: 'road',
            distanceKm: estimatedDistance
          });
          
          console.log(`[Emissions] Recorded ${co2Emitted.toFixed(2)} kg CO2 for purchase order ${po.poNumber} (${estimatedDistance.toFixed(2)} km, ${totalWeight} kg)`);
        }
      } catch (emissionsErr) {
        console.error(`[Emissions] Failed to calculate for PO ${po.poNumber}:`, emissionsErr.message);
      }
    }
    
    const updatedPo = await PurchaseOrder.findOneAndUpdate(
      { _id: poId, orgCode },
      { status, updatedAt: new Date() },
      { new: true }
    );
    
    res.json({
      success: true,
      data: updatedPo,
      message: `Purchase order status updated to ${status}`
    });
  } catch (error) {
    console.error('Update purchase order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrderStatus
};