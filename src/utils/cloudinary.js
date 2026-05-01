const { v2: cloudinary } = require('cloudinary');
const streamifier = require('streamifier');

// Configure Cloudinary from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Allowed file types
const ALLOWED_IMAGES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_PDFS = ['application/pdf'];
const ALLOWED_DOCUMENTS = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Upload options
 * @param {string} options.folder - Folder name (e.g., 'logos', 'invoices', 'reports')
 * @param {string} options.publicId - Custom public ID (optional)
 * @param {string} options.resourceType - 'image', 'raw', 'auto' (default: 'auto')
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadBuffer = async (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: options.folder || 'general',
      resource_type: options.resourceType || 'auto'
    };
    
    if (options.publicId) {
      uploadOptions.public_id = options.publicId;
    }
    
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

/**
 * Upload an image (with automatic optimization)
 * @param {Buffer} buffer - Image buffer
 * @param {string} folder - Folder name
 * @returns {Promise<Object>}
 */
const uploadImage = async (buffer, folder = 'images') => {
  const result = await uploadBuffer(buffer, {
    folder,
    resourceType: 'image'
  });
  
  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes
  };
};

/**
 * Upload a PDF document
 * @param {Buffer} buffer - PDF buffer
 * @param {string} folder - Folder name
 * @returns {Promise<Object>}
 */
const uploadPDF = async (buffer, folder = 'documents') => {
  const result = await uploadBuffer(buffer, {
    folder,
    resourceType: 'raw'
  });
  
  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    format: 'pdf'
  };
};

/**
 * Upload organization logo (specific use case)
 * @param {Buffer} buffer - Logo image buffer
 * @param {string} orgCode - Organization code
 * @returns {Promise<Object>}
 */
const uploadLogo = async (buffer, orgCode) => {
  const result = await uploadBuffer(buffer, {
    folder: `organizations/${orgCode}/logo`,
    resourceType: 'image'
  });
  
  // Generate optimized URL for logo
  const optimizedUrl = cloudinary.url(result.public_id, {
    fetch_format: 'auto',
    quality: 'auto',
    width: 200,
    height: 200,
    crop: 'fill',
    gravity: 'auto'
  });
  
  return {
    url: result.secure_url,
    optimizedUrl,
    publicId: result.public_id,
    width: result.width,
    height: result.height
  };
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>}
 */
const deleteFile = async (publicId) => {
  return await cloudinary.uploader.destroy(publicId);
};

/**
 * Get optimized URL for an existing image
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} transformations - Cloudinary transformations
 * @returns {string}
 */
const getOptimizedUrl = (publicId, transformations = {}) => {
  const defaultTransform = {
    fetch_format: 'auto',
    quality: 'auto'
  };
  
  return cloudinary.url(publicId, { ...defaultTransform, ...transformations });
};

module.exports = {
  uploadBuffer,
  uploadImage,
  uploadPDF,
  uploadLogo,
  deleteFile,
  getOptimizedUrl,
  ALLOWED_IMAGES,
  ALLOWED_PDFS,
  ALLOWED_DOCUMENTS
};