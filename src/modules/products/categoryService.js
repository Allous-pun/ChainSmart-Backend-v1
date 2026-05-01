const { Category } = require('./model');

const createCategory = async (orgCode, data) => {
  const { name, description, parentId } = data;
  
  const existing = await Category.findOne({ orgCode, name });
  if (existing) {
    const error = new Error(`Category '${name}' already exists`);
    error.code = 'DUPLICATE_CATEGORY';
    throw error;
  }
  
  const category = await Category.create({ orgCode, name, description, parentId });
  return category;
};

const getCategories = async (orgCode) => {
  return await Category.find({ orgCode, isActive: true }).sort({ path: 1 });
};

const getCategoryById = async (categoryId, orgCode) => {
  const category = await Category.findOne({ _id: categoryId, orgCode });
  if (!category) {
    const error = new Error('Category not found');
    error.code = 'CATEGORY_NOT_FOUND';
    throw error;
  }
  return category;
};

const updateCategory = async (categoryId, orgCode, updateData) => {
  const category = await Category.findOneAndUpdate(
    { _id: categoryId, orgCode },
    { ...updateData },
    { new: true }
  );
  
  if (!category) {
    const error = new Error('Category not found');
    error.code = 'CATEGORY_NOT_FOUND';
    throw error;
  }
  
  return category;
};

const deleteCategory = async (categoryId, orgCode) => {
  // Check if category has products
  const { Product } = require('./model');
  const hasProducts = await Product.exists({ orgCode, categoryId });
  
  if (hasProducts) {
    const error = new Error('Cannot delete category with existing products');
    error.code = 'CATEGORY_HAS_PRODUCTS';
    throw error;
  }
  
  const category = await Category.findOneAndUpdate(
    { _id: categoryId, orgCode },
    { isActive: false },
    { new: true }
  );
  
  if (!category) {
    const error = new Error('Category not found');
    error.code = 'CATEGORY_NOT_FOUND';
    throw error;
  }
  
  return { id: category._id, name: category.name, deleted: true };
};

const getCategoryTree = async (orgCode) => {
  const categories = await Category.find({ orgCode, isActive: true });
  
  // Build tree structure
  const buildTree = (parentId = null) => {
    return categories
      .filter(cat => String(cat.parentId) === String(parentId))
      .map(cat => ({
        ...cat.toObject(),
        children: buildTree(cat._id)
      }));
  };
  
  return buildTree(null);
};

module.exports = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  getCategoryTree
};
