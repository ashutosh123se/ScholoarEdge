const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'scholarsedge_jwt_secure_secret_2026_super_key';

// Helper to attach counts to the user object
const attachUserCounts = (user) => {
  // Query blog count for any authenticated user
  const blogCountRow = db.prepare('SELECT COUNT(*) as count FROM blogs WHERE user_id = ?').get(user.id);
  user.blog_count = blogCountRow ? blogCountRow.count : 0;

  // Query administrative counts if role is admin
  if (user.role === 'admin') {
    const pendingBlogs = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'pending'").get().count;
    const pendingComments = db.prepare("SELECT COUNT(*) as count FROM comments WHERE status = 'pending'").get().count;
    const unreadContacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'unread'").get().count;

    user.admin_counts = {
      pending_blogs: pendingBlogs,
      pending_comments: pendingComments,
      unread_contacts: unreadContacts
    };
  }
  return user;
};

// CSRF Middleware to generate and verify CSRF tokens
const csrfMiddleware = (req, res, next) => {
  // Generate token if not exists
  let token = req.cookies.csrf_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
  }
  
  res.locals.csrf_token = token;

  // Verify token on state-changing requests
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const bodyToken = req.body.csrf_token;
    const headerToken = req.headers['x-csrf-token'];
    const clientToken = bodyToken || headerToken;

    if (!clientToken || clientToken !== req.cookies.csrf_token) {
      res.locals.flash_error = 'Security check failed. Invalid or missing CSRF token.';
      return res.status(403).render('404', {
        title: '403 - Forbidden',
        message: 'Security validation failed (CSRF token invalid). Please go back and retry.',
        cssFile: 'main.css',
        user: req.user || null
      });
    }
  }
  next();
};

// optionalAuth: checks if token exists, verifies it, sets req.user and res.locals.user,
// but does NOT block if token is missing or expired.
const optionalAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    res.locals.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user is banned or still active in DB
    const user = db.prepare('SELECT id, name, email, role, avatar, designation, status FROM users WHERE id = ?').get(decoded.id);
    
    if (user && user.status === 'active') {
      let userObj = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        designation: user.designation
      };
      
      req.user = attachUserCounts(userObj);
      res.locals.user = req.user;
    } else {
      req.user = null;
      res.locals.user = null;
      res.clearCookie('token');
    }
  } catch (err) {
    req.user = null;
    res.locals.user = null;
    res.clearCookie('token');
  }
  next();
};

// requireAuth: enforces authentication. If token is missing, expired, or user is banned,
// redirects to login with flash error.
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    res.cookie('flash_error', 'Please log in to access this page.', { maxAge: 5000 });
    return res.redirect('/auth/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, avatar, designation, status FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      res.clearCookie('token');
      res.cookie('flash_error', 'User account no longer exists.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    if (user.status === 'banned') {
      res.clearCookie('token');
      res.cookie('flash_error', 'Your account has been suspended by administration.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    let userObj = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      designation: user.designation
    };
    
    req.user = attachUserCounts(userObj);
    res.locals.user = req.user;
    next();
  } catch (err) {
    res.clearCookie('token');
    res.cookie('flash_error', 'Session expired. Please log in again.', { maxAge: 5000 });
    return res.redirect('/auth/login');
  }
};

// requireAdmin: checks if user role is admin.
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    res.cookie('flash_error', 'Access denied. Administrator privileges required.', { maxAge: 5000 });
    return res.redirect('/dashboard');
  }
  next();
};

// Helper middleware to handle EJS cookie flash messages and clear them
const flashMessages = (req, res, next) => {
  res.locals.flash_success = req.cookies.flash_success || null;
  res.locals.flash_error = req.cookies.flash_error || null;
  
  // Clear cookies immediately so they don't persist on refresh
  if (req.cookies.flash_success) res.clearCookie('flash_success');
  if (req.cookies.flash_error) res.clearCookie('flash_error');
  
  next();
};

module.exports = {
  csrfMiddleware,
  optionalAuth,
  requireAuth,
  requireAdmin,
  flashMessages
};
