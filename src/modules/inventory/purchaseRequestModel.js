const mongoose = require('mongoose');

const PurchaseRequestItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  quantity: { type: Number, required: true, min: 1 },
  unit: { type: String, default: 'pcs' },
  estimatedUnitPrice: { type: Number },
  estimatedTotal: { type: Number },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  notes: { type: String }
}, { _id: false });

const ApprovalHistorySchema = new mongoose.Schema({
  step: { type: Number, required: true },
  approverId: { type: String, required: true },
  approverName: { type: String, required: true },
  approverRole: { type: String, required: true },
  action: { type: String, enum: ['approved', 'rejected', 'returned'], required: true },
  comments: { type: String },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const PurchaseRequestSchema = new mongoose.Schema({
  prNumber: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  
  // Requestor information
  requestedBy: { type: String, required: true }, // userId
  requestedByName: { type: String },
  requestedByBranchId: { type: String, required: true }, // branchId string
  department: { type: String },
  
  // Request details
  items: [PurchaseRequestItemSchema],
  totalEstimatedCost: { type: Number, default: 0 },
  currency: { type: String, default: 'KES' },
  
  // Justification
  justification: { type: String, required: true },
  requiredByDate: { type: Date },
  attachedDocuments: [{ type: String }], // URLs or IDs
  
  // Status workflow
  status: { 
    type: String, 
    enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled', 'converted'],
    default: 'draft'
  },
  
  // Approval workflow
  approvalLevel: { type: Number, default: 0 },
  maxApprovalLevel: { type: Number, default: 0 }, // How many approvals needed
  approvalHistory: [ApprovalHistorySchema],
  
  // Rejection info
  rejectionReason: { type: String },
  rejectedBy: { type: String },
  rejectedAt: { type: Date },
  
  // Conversion to PO
  convertedToPO: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
  convertedAt: { type: Date },
  
  // Metadata
  source: { type: String, enum: ['manual', 'auto_reorder', 'system'], default: 'manual' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  
  // Timestamps
  submittedAt: { type: Date },
  approvedAt: { type: Date },
  cancelledAt: { type: Date },
  
  createdBy: { type: String, required: true },
  updatedBy: { type: String }
}, { timestamps: true });

// Indexes
PurchaseRequestSchema.index({ orgCode: 1, prNumber: 1 }, { unique: true });
PurchaseRequestSchema.index({ orgCode: 1, status: 1 });
PurchaseRequestSchema.index({ orgCode: 1, requestedByBranchId: 1 });
PurchaseRequestSchema.index({ orgCode: 1, requestedBy: 1 });
PurchaseRequestSchema.index({ orgCode: 1, status: 1, priority: 1 });
PurchaseRequestSchema.index({ requiredByDate: 1 });
PurchaseRequestSchema.index({ createdAt: -1 });

// Generate PR number before saving - FIXED: removed 'next' parameter
PurchaseRequestSchema.pre('save', async function() {
  if (!this.prNumber) {
    const prefix = `PR-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const lastPR = await this.constructor.findOne({ prNumber: { $regex: `^${prefix}` } }).sort({ prNumber: -1 });
    
    let sequence = 1;
    if (lastPR) {
      const lastSeq = parseInt(lastPR.prNumber.slice(-4));
      sequence = lastSeq + 1;
    }
    
    this.prNumber = `${prefix}${String(sequence).padStart(4, '0')}`;
  }
  // No next() call needed
});

// Calculate total before save - FIXED: removed 'next' parameter
PurchaseRequestSchema.pre('save', function() {
  if (this.items && this.items.length > 0) {
    this.totalEstimatedCost = this.items.reduce((sum, item) => {
      return sum + (item.estimatedTotal || (item.estimatedUnitPrice * item.quantity) || 0);
    }, 0);
  }
  // No next() call needed
});

// Virtual for approval progress
PurchaseRequestSchema.virtual('approvalProgress').get(function() {
  if (this.maxApprovalLevel === 0) return 100;
  return (this.approvalLevel / this.maxApprovalLevel) * 100;
});

module.exports = mongoose.model('PurchaseRequest', PurchaseRequestSchema);