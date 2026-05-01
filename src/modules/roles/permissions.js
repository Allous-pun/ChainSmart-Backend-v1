const rolePermissions = {
  owner: [
    'create_branch', 'edit_branch', 'delete_branch',
    'create_user', 'edit_user', 'delete_user', 'view_users',
    'create_inventory', 'edit_inventory', 'delete_inventory', 'view_inventory',
    'create_purchase_plan', 'approve_purchase_plan', 'create_purchase_order', 'view_procurement',
    'create_supplier', 'edit_supplier', 'delete_supplier', 'view_suppliers',
    'create_shipment', 'edit_shipment', 'view_shipments',
    'view_reports', 'export_reports',
    'run_cost_simulation', 'view_cost_scenarios',
    'view_emissions',
    'edit_settings', 'view_audit_logs'
  ],
  manager: [
    'create_branch', 'edit_branch',
    'create_user', 'edit_user', 'view_users',
    'create_inventory', 'edit_inventory', 'view_inventory',
    'create_purchase_plan', 'approve_purchase_plan', 'view_procurement',
    'create_supplier', 'edit_supplier', 'view_suppliers',
    'create_shipment', 'edit_shipment', 'view_shipments',
    'view_reports', 'export_reports',
    'run_cost_simulation', 'view_cost_scenarios',
    'view_emissions'
  ],
  procurement: [
    'view_inventory',
    'create_purchase_plan', 'create_purchase_order', 'view_procurement',
    'view_suppliers',
    'view_shipments',
    'view_reports'
  ],
  analyst: [
    'view_inventory',
    'view_procurement',
    'view_suppliers',
    'view_shipments',
    'view_reports', 'export_reports',
    'view_cost_scenarios',
    'view_emissions'
  ],
  staff: [
    'view_inventory',
    'view_procurement'
  ]
};

module.exports = rolePermissions;