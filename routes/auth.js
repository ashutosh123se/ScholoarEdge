const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { optionalAuth } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'scholarsedge_jwt_secure_secret_2026_super_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Rate limiter for authentication routes: max 10 requests per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
  handler: (req, res, next, options) => {
    res.cookie('flash_error', options.message, { maxAge: 5000 });
    res.redirect('/auth/login');
  }
});

// GET /auth/login - Login Page
router.get('/login', optionalAuth, (req, res) => {
  if (req.user) {
    return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
  }
  res.render('auth/login', {
    title: 'Login - ScholarsEdge',
    cssFile: 'auth.css',
    user: null
  });
});

// POST /auth/login - Process Login
router.post('/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;

    // Check empty fields
    if (!email || !password) {
      res.cookie('flash_error', 'Please enter both email and password.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    // Retrieve user from DB
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      res.cookie('flash_error', 'Invalid email or password.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    // Verify Password
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      res.cookie('flash_error', 'Invalid email or password.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    // Verify account status
    if (user.status === 'banned') {
      res.cookie('flash_error', 'Your account has been suspended. Please contact administrator.', { maxAge: 5000 });
      return res.redirect('/auth/login');
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, avatar: user.avatar },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Calculate maxAge in milliseconds for cookie (default 7 days)
    const days = parseInt(JWT_EXPIRES_IN) || 7;
    const cookieMaxAge = days * 24 * 60 * 60 * 1000;

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: cookieMaxAge
    });

    // Update last login timestamp
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    // Track login activity
    db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Login', 'user', ?, 'User logged in successfully.')")
      .run(user.id, user.id);

    res.cookie('flash_success', `Welcome back, ${user.name}!`, { maxAge: 5000 });
    res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');

  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'An error occurred during login. Please try again.', { maxAge: 5000 });
    res.redirect('/auth/login');
  }
});

// GET /auth/register - Registration Page
router.get('/register', optionalAuth, (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.render('auth/register', {
    title: 'Register - ScholarsEdge',
    cssFile: 'auth.css',
    user: null
  });
});

// POST /auth/register - Process Registration
router.post('/register', authLimiter, (req, res) => {
  try {
    const { name, email, password, confirm_password } = req.body;

    // Validation
    if (!name || name.trim().length < 2) {
      res.cookie('flash_error', 'Name must be at least 2 characters long.', { maxAge: 5000 });
      return res.redirect('/auth/register');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      res.cookie('flash_error', 'Please provide a valid email address.', { maxAge: 5000 });
      return res.redirect('/auth/register');
    }

    // Password validations: min 8, has letters and numbers
    const pwdRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!password || !pwdRegex.test(password)) {
      res.cookie('flash_error', 'Password must be at least 8 characters long and contain both letters and numbers.', { maxAge: 5000 });
      return res.redirect('/auth/register');
    }

    if (password !== confirm_password) {
      res.cookie('flash_error', 'Confirm password does not match.', { maxAge: 5000 });
      return res.redirect('/auth/register');
    }

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      res.cookie('flash_error', 'Email is already registered. Please login.', { maxAge: 5000 });
      return res.redirect('/auth/register');
    }

    // Hash Password
    const hashedPassword = bcrypt.hashSync(password, 12);

    // Insert User
    const info = db.prepare(`
      INSERT INTO users (name, email, password, role, status, email_verified)
      VALUES (?, ?, ?, 'user', 'active', 0)
    `).run(name.trim(), email.toLowerCase().trim(), hashedPassword);

    const userId = info.lastInsertRowid;

    // Auto-login: Sign JWT
    const token = jwt.sign(
      { id: userId, email: email.toLowerCase().trim(), role: 'user', name: name.trim(), avatar: null },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set cookie
    const days = parseInt(JWT_EXPIRES_IN) || 7;
    const cookieMaxAge = days * 24 * 60 * 60 * 1000;
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: cookieMaxAge
    });

    // Update last login
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);

    // Log Activity
    db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Register', 'user', ?, 'New account created.')")
      .run(userId, userId);

    res.cookie('flash_success', 'Welcome! Start writing your first blog.', { maxAge: 5000 });
    res.redirect('/dashboard');

  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Registration failed. Please check details and try again.', { maxAge: 5000 });
    res.redirect('/auth/register');
  }
});

// GET /auth/logout - Clear Auth Cookie
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.cookie('flash_success', 'Logged out successfully.', { maxAge: 5000 });
  res.redirect('/auth/login');
});

module.exports = router;
