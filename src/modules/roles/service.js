const Role = require('./model');
const rolePermissions = require('./permissions');

const getAllRoles = async () => {
  const roles = await Role.find({}).select('-__v');
  return roles;
};

const getRoleByName = async (name) => {
  const role = await Role.findOne({ name });
  return role;
};

const getRolePermissions = async (roleName) => {
  const permissions = rolePermissions[roleName] || [];
  return {
    role: roleName,
    permissions
  };
};

const getAllRolesWithPermissions = async () => {
  const roles = await Role.find({}).select('-__v');
  
  const rolesWithPermissions = roles.map(role => ({
    id: role._id,
    name: role.name,
    description: role.description,
    permissions: rolePermissions[role.name] || []
  }));
  
  return rolesWithPermissions;
};

module.exports = {
  getAllRoles,
  getRoleByName,
  getRolePermissions,
  getAllRolesWithPermissions
};