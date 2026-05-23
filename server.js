require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// Ensure public uploads folder exists
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Import database to auto-create and seed
require('./db/database');

// Import routes
const publicRouter = require('./routes/public');
const authRouter = require('./routes/auth');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');

// Import authentication and CSRF helpers
const { csrfMiddleware, flashMessages, requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Global cookie-flash renderer
app.use(flashMessages);

// Global Double-Submit CSRF check
app.use(csrfMiddleware);

// Route Groupings mounting
app.use('/', publicRouter);
app.use('/auth', authRouter);
app.use('/dashboard', requireAuth, userRouter);
app.use('/admin', requireAuth, requireAdmin, adminRouter);

// 404 Route Catch-all fallback
app.use((req, res, next) => {
  res.status(404).render('404', {
    title: '404 - Page Not Found',
    message: 'The requested academic resource does not exist, has been archived, or is undergoing editorial review.',
    cssFile: 'main.css',
    user: req.user || null
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Express Exception:', err);
  const status = err.status || 500;
  
  res.status(status).render('404', {
    title: '500 - Server Exception',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected application exception occurred. Please try again or contact support.'
      : `Internal Server Error: ${err.message}`,
    cssFile: 'main.css',
    user: req.user || null
  });
});

// Bind and Listen
app.listen(PORT, () => {
  const siteName = process.env.SITE_NAME || 'ScholarsEdge';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@scholarsedge.in';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Secure2024';

  console.log(`
╔════════════════════════════════════════╗
║     ${siteName.padEnd(20)} — Server Started    ║
╠════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}        ║
║  Admin:   http://localhost:${PORT}/admin  ║
║  Mode:    ${process.env.NODE_ENV || 'development'}                  ║
╚════════════════════════════════════════╝

Default Admin Login:
  Email:    ${adminEmail}
  Password: ${adminPassword}
  `);
});
