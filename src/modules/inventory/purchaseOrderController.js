const PurchaseOrder = require('./purchaseOrderModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

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
    
    res.json({ success: true, data: po });
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
    
    const po = await PurchaseOrder.findOne({ _id: poId, orgCode });
    
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