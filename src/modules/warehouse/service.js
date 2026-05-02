const Branch = require('../branches/model');

// Only return branches that are warehouses
const getWarehouseById = async (warehouseId, orgCode) => {
  const branch = await Branch.findOne({ 
    branchId: warehouseId, 
    orgCode, 
    isWarehouse: true,  // ← ADD THIS
    isActive: true 
  });
  if (!branch) {
    throw new Error('Warehouse not found');
  }
  return {
    id: branch.branchId,
    name: branch.branchName,
    location: {
      type: 'Point',
      coordinates: [branch.coordinates?.lng, branch.coordinates?.lat]
    },
    address: branch.formattedAddress || branch.address,
    city: branch.city,
    country: branch.country,
    isDefault: branch.isDefault
  };
};

const getAllWarehouses = async (orgCode) => {
  const branches = await Branch.find({ 
    orgCode, 
    isWarehouse: true,  // ← ADD THIS
    isActive: true 
  });
  
  return branches.map(branch => ({
    id: branch.branchId,
    name: branch.branchName,
    location: {
      type: 'Point',
      coordinates: [branch.coordinates?.lng, branch.coordinates?.lat]
    },
    address: branch.formattedAddress || branch.address,
    city: branch.city,
    country: branch.country,
    isDefault: branch.isDefault
  }));
};

const getDefaultWarehouse = async (orgCode) => {
  const branch = await Branch.findOne({ 
    orgCode, 
    isWarehouse: true,  // ← ADD THIS
    isDefault: true, 
    isActive: true 
  });
  if (!branch) {
    throw new Error('No default warehouse found');
  }
  return {
    id: branch.branchId,
    name: branch.branchName,
    location: {
      type: 'Point',
      coordinates: [branch.coordinates?.lng, branch.coordinates?.lat]
    },
    address: branch.formattedAddress || branch.address,
    city: branch.city,
    country: branch.country,
    isDefault: true
  };
};

module.exports = {
  getWarehouseById,
  getAllWarehouses,
  getDefaultWarehouse
};
