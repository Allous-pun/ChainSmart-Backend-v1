const mongoose = require('mongoose');

const InventoryTransactionSchema = new mongoose.Schema({
  orgCode: { type: String, required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', default: null },
  locationId: { type: String, required: true },
  type: { type: String, required: true },
  quantity: { type: Number, required: true },
  stockBefore: { type: Number, required: true },
  stockAfter: { type: Number, required: true },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  referenceType: { type: String },
  reason: { type: String },
  note: { type: String },
  createdBy: { type: String, required: true },
  immutable: { type: Boolean, default: true },
  immutableHash: { type: String },
  idempotencyKey: { type: String, sparse: true },
  sequence: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('InventoryTransaction', InventoryTransactionSchema);