const mongoose = require('mongoose');

const TransferSchema = new mongoose.Schema({
  transferNumber: { type: String, required: true, unique: true },
  orgCode: { type: String, required: true, index: true },
  fromWarehouseId: { type: String, required: true },
  toWarehouseId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'shipped', 'received'], default: 'pending' },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' },
    quantity: Number
  }],
  createdBy: { type: String },
  source: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Transfer', TransferSchema);