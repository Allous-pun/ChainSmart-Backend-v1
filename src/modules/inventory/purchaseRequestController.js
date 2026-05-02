const PurchaseRequest = require('./purchaseRequestModel');
const PurchaseOrder = require('./purchaseOrderModel');
const StockState = require('./stockModel');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

const getPurchaseRequests = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const { status, branchId, priority, limit, skip } = req.query;
    
    const query = { orgCode };
    if (status) query.status = status;
    if (branchId) query.requestedByBranchId = branchId;
    if (priority) query.priority = priority;
    
    // Fetch settings for context
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const requests = await PurchaseRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(limit ? parseInt(limit) : 50)
      .skip(skip ? parseInt(skip) : 0)
      .populate('items.productId', 'name sku unit standardCost');
    
    const total = await PurchaseRequest.countDocuments(query);
    
    // Calculate summary statistics
    const summary = {
      totalRequests: requests.length,
      totalDraft: requests.filter(r => r.status === 'draft').length,
      totalPending: requests.filter(r => r.status === 'pending').length,
      totalApproved: requests.filter(r => r.status === 'approved').length,
      totalConverted: requests.filter(r => r.status === 'converted').length,
      totalRejected: requests.filter(r => r.status === 'rejected').length,
      totalCancelled: requests.filter(r => r.status === 'cancelled').length,
      totalEstimatedValue: requests.reduce((sum, r) => sum + r.totalEstimatedAmount, 0)
    };
    
    res.json({ 
      success: true, 
      data: { 
        requests, 
        total, 
        limit: limit || 50, 
        skip: skip || 0,
        summary,
        currency: defaultCurrency
      },
      context: {
        autoApprovalThreshold,
        defaultCurrency
      }
    });
  } catch (error) {
    console.error('Get purchase requests error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getPurchaseRequestById = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    
    // Fetch settings for context
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode })
      .populate('items.productId', 'name sku unit standardCost')
      .populate('convertedToPO', 'poNumber status totalAmount');
    
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    // Calculate approval progress
    const approvalProgress = request.maxApprovalLevel > 0 
      ? (request.approvalLevel / request.maxApprovalLevel) * 100 
      : request.status === 'approved' ? 100 : 0;
    
    res.json({ 
      success: true, 
      data: {
        ...request.toObject(),
        approvalProgress,
        currency: defaultCurrency
      },
      context: {
        autoApprovalThreshold,
        defaultCurrency
      }
    });
  } catch (error) {
    console.error('Get purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createPurchaseRequest = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const userName = req.user.name;
    const { 
      requestedByBranchId, department, items, justification, 
      requiredByDate, priority, attachedDocuments 
    } = req.body;
    
    if (!requestedByBranchId || !items || items.length === 0 || !justification) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: requestedByBranchId, items, justification'
      });
    }
    
    // Fetch settings for validation
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultLeadTimeDays = pillarSettings?.procurement?.defaultLeadTimeDays || 5;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    // Calculate estimated totals for items
    let totalEstimatedAmount = 0;
    const processedItems = items.map(item => {
      const estimatedTotal = item.estimatedTotal || (item.estimatedUnitPrice * item.quantity);
      totalEstimatedAmount += estimatedTotal;
      return {
        ...item,
        estimatedTotal,
        currency: item.currency || defaultCurrency
      };
    });
    
    // Check if request qualifies for auto-approval based on amount
    const autoApprovable = totalEstimatedAmount <= autoApprovalThreshold;
    
    // Generate PR number
    const prNumber = `PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const request = await PurchaseRequest.create({
      prNumber,
      orgCode,
      requestedBy: userId,
      requestedByName: userName,
      requestedByBranchId,
      department,
      items: processedItems,
      justification,
      requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
      priority: priority || 'medium',
      attachedDocuments,
      status: autoApprovable ? 'approved' : 'draft',
      totalEstimatedAmount,
      currency: defaultCurrency,
      expectedLeadTimeDays: defaultLeadTimeDays,
      createdBy: userId,
      updatedBy: userId
    });
    
    // If auto-approved, set approved timestamp
    if (autoApprovable) {
      request.approvedAt = new Date();
      request.approvalHistory.push({
        step: 1,
        approverId: 'system',
        approverName: 'Auto-Approval System',
        approverRole: 'system',
        action: 'approved',
        comments: `Auto-approved: Amount (${totalEstimatedAmount} ${defaultCurrency}) is within threshold (${autoApprovalThreshold} ${defaultCurrency})`,
        timestamp: new Date()
      });
      await request.save();
    }
    
    res.status(201).json({
      success: true,
      data: request,
      message: autoApprovable 
        ? `Purchase request ${prNumber} created and auto-approved`
        : `Purchase request ${prNumber} created successfully (pending approval)`,
      context: {
        autoApprovalThreshold,
        defaultLeadTimeDays,
        defaultCurrency,
        autoApprovable
      }
    });
  } catch (error) {
    console.error('Create purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const submitPurchaseRequest = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    
    // Fetch settings for approval flow
    const pillarSettings = await Settings.findOne({ orgCode });
    const maxApprovalLevel = pillarSettings?.procurement?.maxApprovalLevel || 2;
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    if (request.status !== 'draft') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot submit request with status: ${request.status}` 
      });
    }
    
    request.status = 'pending';
    request.submittedAt = new Date();
    request.maxApprovalLevel = maxApprovalLevel;
    request.updatedBy = userId;
    await request.save();
    
    res.json({
      success: true,
      data: request,
      message: `Purchase request ${request.prNumber} submitted for approval`,
      context: {
        maxApprovalLevel,
        currentApprovalLevel: 0
      }
    });
  } catch (error) {
    console.error('Submit purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const approvePurchaseRequest = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const userName = req.user.name;
    const userRole = req.user.role;
    const { comments } = req.body;
    
    // Fetch settings for approval rules
    const pillarSettings = await Settings.findOne({ orgCode });
    const maxApprovalLevel = pillarSettings?.procurement?.maxApprovalLevel || 2;
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot approve request with status: ${request.status}` 
      });
    }
    
    // Add approval to history
    request.approvalHistory.push({
      step: request.approvalLevel + 1,
      approverId: userId,
      approverName: userName,
      approverRole: userRole,
      action: 'approved',
      comments: comments || null,
      timestamp: new Date()
    });
    
    request.approvalLevel += 1;
    
    // Check if fully approved
    if (request.approvalLevel >= maxApprovalLevel) {
      request.status = 'approved';
      request.approvedAt = new Date();
    }
    
    request.updatedBy = userId;
    await request.save();
    
    res.json({
      success: true,
      data: request,
      message: request.status === 'approved' 
        ? `Purchase request ${request.prNumber} fully approved`
        : `Purchase request ${request.prNumber} approved at level ${request.approvalLevel} of ${maxApprovalLevel}`,
      context: {
        maxApprovalLevel,
        currentApprovalLevel: request.approvalLevel,
        approvalProgress: (request.approvalLevel / maxApprovalLevel) * 100
      }
    });
  } catch (error) {
    console.error('Approve purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const rejectPurchaseRequest = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const userName = req.user.name;
    const userRole = req.user.role;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ success: false, error: 'Rejection reason is required' });
    }
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot reject request with status: ${request.status}` 
      });
    }
    
    // Add rejection to history
    request.approvalHistory.push({
      step: request.approvalLevel + 1,
      approverId: userId,
      approverName: userName,
      approverRole: userRole,
      action: 'rejected',
      comments: reason,
      timestamp: new Date()
    });
    
    request.status = 'rejected';
    request.rejectionReason = reason;
    request.rejectedBy = userId;
    request.rejectedAt = new Date();
    request.updatedBy = userId;
    await request.save();
    
    res.json({
      success: true,
      data: request,
      message: `Purchase request ${request.prNumber} rejected`
    });
  } catch (error) {
    console.error('Reject purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const cancelPurchaseRequest = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const { reason } = req.body;
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    if (request.status === 'converted') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot cancel a request that has been converted to PO' 
      });
    }
    
    if (request.status === 'rejected') {
      return res.status(400).json({ 
        success: false, 
        error: 'Request already rejected' 
      });
    }
    
    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.rejectionReason = reason || 'Cancelled by user';
    request.updatedBy = userId;
    await request.save();
    
    res.json({
      success: true,
      data: request,
      message: `Purchase request ${request.prNumber} cancelled`
    });
  } catch (error) {
    console.error('Cancel purchase request error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const convertToPurchaseOrder = async (req, res) => {
  try {
    const { prId } = req.params;
    const orgCode = req.user.orgCode;
    const userId = req.user.id;
    const { supplierId, supplyOfferId, notes } = req.body;
    
    if (!supplierId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Supplier ID is required to convert to purchase order' 
      });
    }
    
    // Fetch settings for PO creation
    const pillarSettings = await Settings.findOne({ orgCode });
    const orgSettings = await OrganizationSettings.findOne({ orgCode });
    
    const autoApprovalThreshold = pillarSettings?.procurement?.autoApprovalThreshold || 10000;
    const defaultLeadTimeDays = pillarSettings?.procurement?.defaultLeadTimeDays || 5;
    const defaultCurrency = orgSettings?.region?.defaultCurrency || 'KES';
    
    const request = await PurchaseRequest.findOne({ _id: prId, orgCode });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Purchase request not found' });
    }
    
    if (request.status !== 'approved') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot convert request with status: ${request.status}. Only approved requests can be converted.` 
      });
    }
    
    if (request.convertedToPO) {
      return res.status(400).json({ 
        success: false, 
        error: 'Purchase request already converted to a purchase order' 
      });
    }
    
    // Calculate expected delivery date
    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + (request.expectedLeadTimeDays || defaultLeadTimeDays));
    
    // Create purchase order from request items
    const poItems = request.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.estimatedUnitPrice || 0,
      currency: item.currency || defaultCurrency
    }));
    
    const totalAmount = poItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    const poNumber = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Auto-approve PO if under threshold
    const poStatus = totalAmount <= autoApprovalThreshold ? 'approved' : 'draft';
    
    const purchaseOrder = await PurchaseOrder.create({
      poNumber,
      orgCode,
      supplierId,
      supplyOfferId: supplyOfferId || null,
      destinationWarehouseId: request.requestedByBranchId,
      items: poItems,
      subtotal: totalAmount,
      totalAmount,
      status: poStatus,
      currency: defaultCurrency,
      expectedDeliveryDate,
      createdBy: userId,
      source: 'purchase_request',
      autoApproved: poStatus === 'approved'
    });
    
    // Update purchase request
    request.convertedToPO = purchaseOrder._id;
    request.convertedAt = new Date();
    request.status = 'converted';
    request.updatedBy = userId;
    await request.save();
    
    res.status(201).json({
      success: true,
      data: {
        purchaseRequest: request,
        purchaseOrder: purchaseOrder
      },
      message: `Purchase request ${request.prNumber} converted to purchase order ${purchaseOrder.poNumber}`,
      context: {
        autoApprovalThreshold,
        defaultLeadTimeDays,
        defaultCurrency,
        poStatus,
        expectedDeliveryDate
      }
    });
  } catch (error) {
    console.error('Convert to purchase order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getPurchaseRequests,
  getPurchaseRequestById,
  createPurchaseRequest,
  submitPurchaseRequest,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  cancelPurchaseRequest,
  convertToPurchaseOrder
};