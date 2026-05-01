require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../modules/roles/model');
const rolePermissions = require('../modules/roles/permissions');

const seedRoles = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing roles
    await Role.deleteMany({});
    console.log('🗑️  Cleared existing roles');

    // Create roles with permissions
    const roles = Object.keys(rolePermissions).map(roleName => ({
      name: roleName,
      description: getRoleDescription(roleName),
      permissions: rolePermissions[roleName]
    }));

    await Role.insertMany(roles);
    console.log(`✅ Seeded ${roles.length} roles:`);
    roles.forEach(r => console.log(`   - ${r.name}: ${r.permissions.length} permissions`));

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

const getRoleDescription = (role) => {
  const descriptions = {
    owner: 'Full control over everything',
    manager: 'Runs daily operations',
    procurement: 'Handles purchasing and suppliers',
    analyst: 'Views reports and insights',
    staff: 'Limited read-only access'
  };
  return descriptions[role];
};

seedRoles();