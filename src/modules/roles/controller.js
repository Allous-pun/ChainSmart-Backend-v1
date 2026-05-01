const roleService = require('./service');

const getRoles = async (req, res) => {
  try {
    const roles = await roleService.getAllRolesWithPermissions();
    res.json({ 
      success: true, 
      data: roles 
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getRole = async (req, res) => {
  try {
    const { roleName } = req.params;
    const role = await roleService.getRolePermissions(roleName);
    res.json({ success: true, data: role });
  } catch (error) {
    console.error('Get role error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const getPermissions = async (req, res) => {
  try {
    const allPermissions = [
      // Organization
      'create_branch', 'edit_branch', 'delete_branch',
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
    ];
    
    res.json({ success: true, data: allPermissions });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getRoles,
  getRole,
  getPermissions
};