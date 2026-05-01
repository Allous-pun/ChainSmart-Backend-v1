const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['owner', 'manager', 'procurement', 'analyst', 'staff'],
    required: true,
    unique: true
  },
  description: String,
  permissions: [{
    type: String,
    enum: [
      // Branches
      'view_branches', 'create_branch', 'edit_branch', 'delete_branch',
      // Users
      'create_user', 'edit_user', 'delete_user', 'view_users',
      // Inventory
      'create_inventory', 'edit_inventory', 'delete_inventory', 'view_inventory',
      // Procurement
      'create_purchase_plan', 'approve_purchase_plan', 'create_purchase_order', 'view_procurement',
      // Suppliers
      'create_supplier', 'edit_supplier', 'delete_supplier', 'view_suppliers',
      // Logistics
      'create_shipment', 'edit_shipment', 'view_shipments',
      // Reports
      'view_reports', 'export_reports',
      // Cost Simulation
      'run_cost_simulation', 'view_cost_scenarios',
      // Emissions
      'view_emissions',
      // Settings
      'edit_settings', 'view_audit_logs'
    ]
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Role', RoleSchema);