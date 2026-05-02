const warehouseService = require('./service');

const getWarehouses = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const warehouses = await warehouseService.getAllWarehouses(orgCode);
    res.json({ success: true, data: warehouses });
  } catch (error) {
    console.error('Get warehouses error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const orgCode = req.user.orgCode;
    const warehouse = await warehouseService.getWarehouseById(warehouseId, orgCode);
    res.json({ success: true, data: warehouse });
  } catch (error) {
    console.error('Get warehouse error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

const getDefaultWarehouse = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const warehouse = await warehouseService.getDefaultWarehouse(orgCode);
    res.json({ success: true, data: warehouse });
  } catch (error) {
    console.error('Get default warehouse error:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

module.exports = {
  getWarehouses,
  getWarehouse,
  getDefaultWarehouse
};
