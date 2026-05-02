const mongoose = require('mongoose');

const PurchaseOrderSchema = new mongoose.Schema({
  poNumber: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplyOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplyOffer' },
  destinationWarehouseId: { type: String, required: true },
  status: { type: String, default: 'draft' },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    quantity: Number,
    unitPrice: Number,
    currency: { type: String, default: 'USD' }
  }],
  subtotal: Number,
  totalAmount: Number,
  createdBy: { type: String },
  source: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);