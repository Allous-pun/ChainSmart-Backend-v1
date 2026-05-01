const categoryService = require('./categoryService');

const createCategory = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const category = await categoryService.createCategory(orgCode, req.body);
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getCategories = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const categories = await categoryService.getCategories(orgCode);
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

const getCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const orgCode = req.user.orgCode;
    const category = await categoryService.getCategoryById(categoryId, orgCode);
    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Get category error:', error);
    if (error.code === 'CATEGORY_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const orgCode = req.user.orgCode;
    const category = await categoryService.updateCategory(categoryId, orgCode, req.body);
    res.json({ success: true, data: category, message: 'Category updated successfully' });
  } catch (error) {
    console.error('Update category error:', error);
    if (error.code === 'CATEGORY_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const orgCode = req.user.orgCode;
    const result = await categoryService.deleteCategory(categoryId, orgCode);
    res.json({ success: true, data: result, message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    if (error.code === 'CATEGORY_NOT_FOUND') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.code === 'CATEGORY_HAS_PRODUCTS') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

const getCategoryTree = async (req, res) => {
  try {
    const orgCode = req.user.orgCode;
    const tree = await categoryService.getCategoryTree(orgCode);
    res.json({ success: true, data: tree });
  } catch (error) {
    console.error('Get category tree error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  createCategory,
  getCategories,
  getCategory,
  updateCategory,
  deleteCategory,
  getCategoryTree
};
