const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads folder exists in the public directory
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize the filename to prevent security flaws and characters problems
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${sanitized}`);
  }
});

// File type filter to allow only standard images
const fileFilter = (req, file, cb) => {
  const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  
  const fileExt = path.extname(file.originalname).toLowerCase();
  
  if (allowedMime.includes(file.mimetype) && allowedExt.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 Megabytes max size
  }
});

// Single upload wrappers for easy route usage
const uploadSingle = (req, res, next) => {
  upload.single('cover_image')(req, res, (err) => {
    if (err) {
      res.cookie('flash_error', err.message, { maxAge: 5000 });
      return res.redirect('back');
    }
    next();
  });
};

const uploadAvatar = (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      res.cookie('flash_error', err.message, { maxAge: 5000 });
      return res.redirect('back');
    }
    next();
  });
};

module.exports = {
  uploadSingle,
  uploadAvatar
};
