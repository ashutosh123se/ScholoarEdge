const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiter for contact submission: 3 requests per hour per IP
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many contact requests from this IP. Please try again after an hour.',
  handler: (req, res, next, options) => {
    res.cookie('flash_error', options.message, { maxAge: 5000 });
    res.redirect('/contact');
  }
});

// Helper to fetch site settings as a key-value object
function getSiteSettings() {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  settingsRows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

// GET / - Homepage
router.get('/', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    
    // Featured blogs (limit 6)
    const featuredBlogs = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name 
      FROM blogs b 
      JOIN users u ON b.user_id = u.id 
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.status = 'published' AND b.featured = 1 
      ORDER BY b.published_at DESC 
      LIMIT 6
    `).all();

    // Latest blogs (limit 3)
    const latestBlogs = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name 
      FROM blogs b 
      JOIN users u ON b.user_id = u.id 
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.status = 'published' 
      ORDER BY b.published_at DESC 
      LIMIT 3
    `).all();

    // Active services ordered
    const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY display_order ASC').all();

    // Stats
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
    const totalBlogs = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'published'").get().count;
    const totalViewsRow = db.prepare("SELECT SUM(views) as count FROM blogs").get();
    const totalViews = totalViewsRow.count || 0;

    res.render('index', {
      title: 'Home',
      settings,
      featuredBlogs,
      latestBlogs,
      services,
      stats: {
        totalUsers,
        totalBlogs,
        totalViews
      },
      cssFile: 'main.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { 
      title: 'Server Error', 
      message: 'An error occurred while loading the homepage.', 
      cssFile: 'main.css' 
    });
  }
});

// GET /blog - Blog Listing Page
router.get('/blog', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const catFilter = req.query.category || '';
    const searchFilter = req.query.search || '';
    const tagFilter = req.query.tag || '';

    let queryStr = `
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name, c.slug as category_slug
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.status = 'published'
    `;
    const params = [];

    if (catFilter) {
      queryStr += ` AND c.slug = ?`;
      params.push(catFilter);
    }

    if (searchFilter) {
      queryStr += ` AND (b.title LIKE ? OR b.excerpt LIKE ? OR b.content LIKE ?)`;
      const likeParam = `%${searchFilter}%`;
      params.push(likeParam, likeParam, likeParam);
    }

    if (tagFilter) {
      queryStr += ` AND b.tags LIKE ?`;
      params.push(`%${tagFilter}%`);
    }

    // Clone query for count
    const countQueryStr = queryStr.replace('b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name, c.slug as category_slug', 'COUNT(*) as count');
    const totalBlogs = db.prepare(countQueryStr).get(params).count;
    const totalPages = Math.ceil(totalBlogs / limit) || 1;

    // Apply sorting and limit
    queryStr += ` ORDER BY b.published_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const blogs = db.prepare(queryStr).all(params);

    // Get categories with post count
    const categories = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM blogs b WHERE b.category_id = c.id AND b.status = 'published') as post_count 
      FROM categories c
    `).all();

    // Get tags (aggregate and unique list)
    const blogsWithTags = db.prepare("SELECT tags FROM blogs WHERE status = 'published' AND tags != ''").all();
    const tagMap = {};
    blogsWithTags.forEach(b => {
      const bTags = b.tags.split(',');
      bTags.forEach(t => {
        const cleanTag = t.trim();
        if (cleanTag) {
          tagMap[cleanTag] = (tagMap[cleanTag] || 0) + 1;
        }
      });
    });
    const tagsCloud = Object.entries(tagMap).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count).slice(0, 15);

    // Get featured blog (featured = 1)
    const featuredBlog = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.status = 'published' AND b.featured = 1
      ORDER BY b.published_at DESC
      LIMIT 1
    `).get();

    res.render('blog', {
      title: 'Publications Blog',
      settings,
      blogs,
      categories,
      tagsCloud,
      featuredBlog,
      filters: {
        category: catFilter,
        search: searchFilter,
        tag: tagFilter,
        page,
        totalPages
      },
      cssFile: 'main.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { 
      title: 'Server Error', 
      message: 'Failed to load blog posts.', 
      cssFile: 'main.css' 
    });
  }
});

// GET /blog/:slug - Single Blog Details
router.get('/blog/:slug', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const { slug } = req.params;

    // Retrieve blog post
    const blog = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, u.bio as author_bio, u.designation as author_designation, c.name as category_name
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.slug = ?
    `).get(slug);

    if (!blog) {
      return res.status(404).render('404', { 
        title: 'Blog Not Found', 
        message: 'The requested academic post does not exist or has been removed.', 
        cssFile: 'main.css' 
      });
    }

    // Safety: only author or admin can view drafts/rejected blogs
    if (blog.status !== 'published') {
      const isAdmin = req.user && req.user.role === 'admin';
      const isAuthor = req.user && req.user.id === blog.user_id;
      if (!isAdmin && !isAuthor) {
        return res.status(404).render('404', {
          title: 'Blog Not Found',
          message: 'The requested blog post is pending review or is not published.',
          cssFile: 'main.css'
        });
      }
    }

    // Increment Views
    db.prepare('UPDATE blogs SET views = views + 1 WHERE id = ?').run(blog.id);

    // Get approved comments
    const comments = db.prepare(`
      SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar, u.designation as commenter_designation
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.blog_id = ? AND c.status = 'approved'
      ORDER BY c.created_at ASC
    `).all(blog.id);

    // Get related blogs
    const relatedBlogs = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.status = 'published' AND b.category_id = ? AND b.id != ?
      ORDER BY b.published_at DESC
      LIMIT 3
    `).all(blog.category_id, blog.id);

    res.render('blog-detail', {
      title: blog.title,
      settings,
      blog,
      comments,
      relatedBlogs,
      cssFile: 'main.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { 
      title: 'Server Error', 
      message: 'Failed to load the article details.', 
      cssFile: 'main.css' 
    });
  }
});

// POST /blog/:slug/comment - Submit Comment
router.post('/blog/:slug/comment', requireAuth, (req, res) => {
  try {
    const { slug } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      res.cookie('flash_error', 'Comment content cannot be empty.', { maxAge: 5000 });
      return res.redirect(`/blog/${slug}`);
    }

    const blog = db.prepare('SELECT id FROM blogs WHERE slug = ?').get(slug);
    if (!blog) {
      res.cookie('flash_error', 'Blog post not found.', { maxAge: 5000 });
      return res.redirect('/blog');
    }

    // Insert Comment (status=pending by default for admin review)
    db.prepare('INSERT INTO comments (blog_id, user_id, content, status) VALUES (?, ?, ?, ?)').run(
      blog.id,
      req.user.id,
      content.trim(),
      'pending'
    );

    res.cookie('flash_success', 'Thank you! Your comment has been submitted and is pending administrative approval.', { maxAge: 5000 });
    res.redirect(`/blog/${slug}`);
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'An error occurred while posting your comment.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /services - Services Page
router.get('/services', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY display_order ASC').all();
    
    res.render('services', {
      title: 'Our Services',
      settings,
      services,
      cssFile: 'main.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { 
      title: 'Server Error', 
      message: 'Failed to retrieve academic services.', 
      cssFile: 'main.css' 
    });
  }
});

// GET /contact - Contact Page
router.get('/contact', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    res.render('contact', {
      title: 'Contact Us',
      settings,
      cssFile: 'main.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { 
      title: 'Server Error', 
      message: 'Failed to open contact page.', 
      cssFile: 'main.css' 
    });
  }
});

// POST /contact - Contact Form Submission
router.post('/contact', contactLimiter, optionalAuth, (req, res) => {
  try {
    const { name, email, phone, service, message } = req.body;

    // Validations
    if (!name || name.trim().length < 2) {
      res.cookie('flash_error', 'Please enter a valid name (min 2 characters).', { maxAge: 5000 });
      return res.redirect('/contact');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      res.cookie('flash_error', 'Please enter a valid email address.', { maxAge: 5000 });
      return res.redirect('/contact');
    }

    if (!message || message.trim().length < 10) {
      res.cookie('flash_error', 'Please enter a message of at least 10 characters.', { maxAge: 5000 });
      return res.redirect('/contact');
    }

    // Insert contact submission
    db.prepare(`
      INSERT INTO contacts (name, email, phone, service, message, status) 
      VALUES (?, ?, ?, ?, ?, 'unread')
    `).run(
      name.trim(),
      email.trim(),
      phone ? phone.trim() : null,
      service || 'General Enquiry',
      message.trim()
    );

    res.cookie('flash_success', 'Your query has been logged. We will get back to you within 24 hours!', { maxAge: 5000 });
    res.redirect('/contact');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to save contact details. Please try again.', { maxAge: 5000 });
    res.redirect('/contact');
  }
});

// POST /newsletter - AJax Newsletter Subscription
router.post('/newsletter', (req, res) => {
  try {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address.' });
    }

    // Insert or ignore if subscriber exists
    db.prepare('INSERT OR IGNORE INTO newsletter (email, active) VALUES (?, 1)').run(email.toLowerCase().trim());
    
    // In case the subscriber was inactive, let's reactivate them
    db.prepare('UPDATE newsletter SET active = 1 WHERE email = ?').run(email.toLowerCase().trim());

    res.json({ success: true, message: 'Thank you for subscribing to our research digest!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'An error occurred during subscription.' });
  }
});

module.exports = router;
