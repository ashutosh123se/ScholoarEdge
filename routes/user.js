const express = require('express');
const router = express.Router();
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { uploadSingle, uploadAvatar } = require('../middleware/upload');

const JWT_SECRET = process.env.JWT_SECRET || 'scholarsedge_jwt_secure_secret_2026_super_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Apply requireAuth middleware to all user routes
router.use(requireAuth);

// Helper to calculate reading time
const calculateReadingTime = (content) => {
  // Strip HTML tags and count words
  const cleanContent = content.replace(/<[^>]*>/g, ' ');
  const words = cleanContent.trim().split(/\s+/).filter(Boolean);
  return Math.ceil(words.length / 200) || 1;
};

// Helper to generate a unique slug
const generateUniqueSlug = (title, excludeId = null) => {
  let baseSlug = slugify(title, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    let checkQuery = 'SELECT id FROM blogs WHERE slug = ?';
    let params = [slug];
    if (excludeId) {
      checkQuery += ' AND id != ?';
      params.push(excludeId);
    }
    const existing = db.prepare(checkQuery).get(params);
    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }
  return slug;
};

// GET /dashboard - User Home
router.get('/', (req, res) => {
  try {
    const userId = req.user.id;

    // Get blog counts by status
    const statusCountsRows = db.prepare('SELECT status, COUNT(*) as count FROM blogs WHERE user_id = ? GROUP BY status').all(userId);
    const stats = { draft: 0, pending: 0, published: 0, rejected: 0 };
    statusCountsRows.forEach(row => {
      stats[row.status] = row.count;
    });

    // Total views across user's blogs
    const viewsRow = db.prepare('SELECT SUM(views) as count FROM blogs WHERE user_id = ?').get(userId);
    const totalViews = viewsRow.count || 0;

    // Recent 5 blogs
    const recentBlogs = db.prepare(`
      SELECT b.*, c.name as category_name 
      FROM blogs b 
      LEFT JOIN categories c ON b.category_id = c.id 
      WHERE b.user_id = ? 
      ORDER BY b.updated_at DESC 
      LIMIT 5
    `).all(userId);

    // Recent 3 comments on user's blogs
    const recentComments = db.prepare(`
      SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar, b.title as blog_title, b.slug as blog_slug
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN blogs b ON c.blog_id = b.id
      WHERE b.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT 3
    `).all(userId);

    res.render('user/dashboard', {
      title: 'User Dashboard',
      stats,
      totalViews,
      recentBlogs,
      recentComments,
      cssFile: 'dashboard.css'
    });
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to load dashboard metrics.', { maxAge: 5000 });
    res.redirect('/auth/logout');
  }
});

// GET /dashboard/blogs - My Blogs list
router.get('/blogs', (req, res) => {
  try {
    const userId = req.user.id;
    const activeTab = req.query.status || 'all'; // all, draft, pending, published, rejected
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM blogs WHERE user_id = ?';
    let dataQuery = `
      SELECT b.*, c.name as category_name 
      FROM blogs b 
      LEFT JOIN categories c ON b.category_id = c.id 
      WHERE b.user_id = ?
    `;
    const params = [userId];

    if (activeTab !== 'all') {
      countQuery += ' AND status = ?';
      dataQuery += ' AND b.status = ?';
      params.push(activeTab);
    }

    const totalBlogs = db.prepare(countQuery).get(params).count;
    const totalPages = Math.ceil(totalBlogs / limit) || 1;

    dataQuery += ' ORDER BY b.updated_at DESC LIMIT ? OFFSET ?';
    // push offset values
    const queryParams = [...params, limit, offset];
    const blogs = db.prepare(dataQuery).all(queryParams);

    res.render('user/blogs', {
      title: 'My Articles',
      blogs,
      activeTab,
      currentPage: page,
      totalPages,
      cssFile: 'dashboard.css'
    });
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to retrieve your blogs list.', { maxAge: 5000 });
    res.redirect('/dashboard');
  }
});

// GET /dashboard/blogs/new - Write New Blog Page
router.get('/blogs/new', (req, res) => {
  try {
    const categories = db.prepare('SELECT id, name FROM categories').all();
    res.render('user/blog-new', {
      title: 'Write New Article',
      categories,
      cssFile: 'dashboard.css'
    });
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to load content categories.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  }
});

// POST /dashboard/blogs - Create Blog
router.post('/blogs', uploadSingle, (req, res) => {
  try {
    const { title, excerpt, content, category_id, tags, action } = req.body;
    const userId = req.user.id;

    // Validations
    if (!title || title.trim().length < 5) {
      res.cookie('flash_error', 'Blog title must be at least 5 characters long.', { maxAge: 5000 });
      return res.redirect('back');
    }

    if (!content || content.trim().length < 100) {
      res.cookie('flash_error', 'Blog content must be at least 100 characters long.', { maxAge: 5000 });
      return res.redirect('back');
    }

    if (!category_id) {
      res.cookie('flash_error', 'Please select a valid category.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const slug = generateUniqueSlug(title);
    const readingTime = calculateReadingTime(content);
    const coverImage = req.file ? `/uploads/${req.file.filename}` : null;
    
    // Status resolution based on submit action
    const status = action === 'submit' ? 'pending' : 'draft';

    const info = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, cover_image, tags, status, reading_time, views)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      userId,
      parseInt(category_id),
      title.trim(),
      slug,
      excerpt ? excerpt.trim().substring(0, 200) : '',
      content,
      coverImage,
      tags ? tags.trim() : '',
      status,
      readingTime
    );

    // Log Activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, target_type, target_id, details)
      VALUES (?, ?, 'blog', ?, ?)
    `).run(
      userId,
      status === 'pending' ? 'Submit Blog' : 'Create Blog',
      info.lastInsertRowid,
      `Blog titled "${title}" saved as ${status}.`
    );

    const flashMsg = status === 'pending' 
      ? 'Blog successfully submitted for review by the administrative team.' 
      : 'Blog successfully saved as draft.';
      
    res.cookie('flash_success', flashMsg, { maxAge: 5000 });
    res.redirect('/dashboard/blogs');

  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to create blog. Check input and file size limit (5MB).', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /dashboard/blogs/:id/edit - Edit Blog Page
router.get('/blogs/:id/edit', (req, res) => {
  try {
    const blogId = req.params.id;
    const userId = req.user.id;

    const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Requested article does not exist.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    // Verify ownership
    if (blog.user_id !== userId) {
      res.cookie('flash_error', 'Access denied. You do not own this article.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    // Only editable if draft or rejected
    if (blog.status !== 'draft' && blog.status !== 'rejected') {
      res.cookie('flash_error', 'Published or pending articles cannot be edited.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    const categories = db.prepare('SELECT id, name FROM categories').all();

    res.render('user/blog-edit', {
      title: `Edit - ${blog.title}`,
      blog,
      categories,
      cssFile: 'dashboard.css'
    });
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to retrieve the blog for editing.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  }
});

// POST /dashboard/blogs/:id - Update Blog
router.post('/blogs/:id', uploadSingle, (req, res) => {
  try {
    const blogId = req.params.id;
    const userId = req.user.id;
    const { title, excerpt, content, category_id, tags, action } = req.body;

    const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    // Verify ownership
    if (blog.user_id !== userId) {
      res.cookie('flash_error', 'Access denied. You do not own this article.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    // Verify editable status
    if (blog.status !== 'draft' && blog.status !== 'rejected') {
      res.cookie('flash_error', 'Only draft or rejected articles can be modified.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    // Validations
    if (!title || title.trim().length < 5) {
      res.cookie('flash_error', 'Title must be at least 5 characters long.', { maxAge: 5000 });
      return res.redirect('back');
    }

    if (!content || content.trim().length < 100) {
      res.cookie('flash_error', 'Content must be at least 100 characters long.', { maxAge: 5000 });
      return res.redirect('back');
    }

    if (!category_id) {
      res.cookie('flash_error', 'Please select a category.', { maxAge: 5000 });
      return res.redirect('back');
    }

    // Generate slug (regenerate if title changed)
    let slug = blog.slug;
    if (title.trim().toLowerCase() !== blog.title.toLowerCase()) {
      slug = generateUniqueSlug(title, blogId);
    }

    const readingTime = calculateReadingTime(content);
    let coverImage = blog.cover_image;
    if (req.file) {
      coverImage = `/uploads/${req.file.filename}`;
    }

    const status = action === 'submit' ? 'pending' : 'draft';

    db.prepare(`
      UPDATE blogs 
      SET title = ?, slug = ?, excerpt = ?, content = ?, cover_image = ?, tags = ?, status = ?, reading_time = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title.trim(),
      slug,
      excerpt ? excerpt.trim().substring(0, 200) : '',
      content,
      coverImage,
      tags ? tags.trim() : '',
      status,
      readingTime,
      blogId
    );

    // Log Activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, target_type, target_id, details)
      VALUES (?, ?, 'blog', ?, ?)
    `).run(
      userId,
      status === 'pending' ? 'Submit Blog' : 'Update Blog',
      blogId,
      `Blog updated and saved as ${status}.`
    );

    const flashMsg = status === 'pending' 
      ? 'Blog successfully submitted for review.' 
      : 'Blog draft updated successfully.';

    res.cookie('flash_success', flashMsg, { maxAge: 5000 });
    res.redirect('/dashboard/blogs');

  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to update article.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /dashboard/blogs/:id/submit - Submit Draft to Pending Review
router.post('/blogs/:id/submit', (req, res) => {
  try {
    const blogId = req.params.id;
    const userId = req.user.id;

    const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(blogId);
    if (!blog || blog.user_id !== userId) {
      res.cookie('flash_error', 'Article not found or access denied.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    if (blog.status !== 'draft' && blog.status !== 'rejected') {
      res.cookie('flash_error', 'Only draft or rejected articles can be submitted.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    db.prepare(`UPDATE blogs SET status = 'pending', updated_at = datetime('now') WHERE id = ?`).run(blogId);

    // Log Activity
    db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Submit Blog', 'blog', ?, 'Submitted draft for review.')")
      .run(userId, blogId);

    res.cookie('flash_success', 'Blog successfully submitted for editorial review.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to submit article.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  }
});

// POST /dashboard/blogs/:id/delete - Delete Blog
router.post('/blogs/:id/delete', (req, res) => {
  try {
    const blogId = req.params.id;
    const userId = req.user.id;

    const blog = db.prepare('SELECT * FROM blogs WHERE id = ?').get(blogId);
    if (!blog || blog.user_id !== userId) {
      res.cookie('flash_error', 'Article not found or access denied.', { maxAge: 5000 });
      return res.redirect('/dashboard/blogs');
    }

    db.prepare('DELETE FROM blogs WHERE id = ?').run(blogId);

    // Log Activity
    db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Delete Blog', 'blog', ?, ?)")
      .run(userId, blogId, `Deleted blog titled "${blog.title}".`);

    res.cookie('flash_success', 'Article deleted successfully.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete article.', { maxAge: 5000 });
    res.redirect('/dashboard/blogs');
  }
});

// GET /dashboard/profile - Get Profile View
router.get('/profile', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.render('user/profile', {
      title: 'Profile Settings',
      profile: user,
      cssFile: 'dashboard.css'
    });
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to load user profile.', { maxAge: 5000 });
    res.redirect('/dashboard');
  }
});

// POST /dashboard/profile - Update Profile + Change Password
router.post('/profile', uploadAvatar, (req, res) => {
  try {
    const userId = req.user.id;
    const { name, bio, designation, current_password, new_password, confirm_new_password } = req.body;

    // Validate main details
    if (!name || name.trim().length < 2) {
      res.cookie('flash_error', 'Name must be at least 2 characters.', { maxAge: 5000 });
      return res.redirect('/dashboard/profile');
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    let avatarPath = user.avatar;
    if (req.file) {
      avatarPath = `/uploads/${req.file.filename}`;
    }

    // Update main fields
    db.prepare('UPDATE users SET name = ?, bio = ?, designation = ?, avatar = ? WHERE id = ?').run(
      name.trim(),
      bio ? bio.trim().substring(0, 300) : null,
      designation ? designation.trim().substring(0, 100) : null,
      avatarPath,
      userId
    );

    // If password change is requested
    if (new_password || current_password || confirm_new_password) {
      if (!current_password || !new_password || !confirm_new_password) {
        res.cookie('flash_error', 'Please fill out all password fields to update password.', { maxAge: 5000 });
        return res.redirect('/dashboard/profile');
      }

      // Check current password
      const match = bcrypt.compareSync(current_password, user.password);
      if (!match) {
        res.cookie('flash_error', 'Current password is incorrect.', { maxAge: 5000 });
        return res.redirect('/dashboard/profile');
      }

      // Validate new password
      const pwdRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
      if (!pwdRegex.test(new_password)) {
        res.cookie('flash_error', 'New password must be at least 8 characters long and contain both letters and numbers.', { maxAge: 5000 });
        return res.redirect('/dashboard/profile');
      }

      if (new_password !== confirm_new_password) {
        res.cookie('flash_error', 'Confirm password does not match.', { maxAge: 5000 });
        return res.redirect('/dashboard/profile');
      }

      // Hash and update password
      const hashed = bcrypt.hashSync(new_password, 12);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId);
      
      // Log password update
      db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Update Password', 'user', ?, 'Updated account security password.')")
        .run(userId, userId);
    }

    // Get fresh user details for cookie re-signing
    const freshUser = db.prepare('SELECT id, name, email, role, avatar, designation FROM users WHERE id = ?').get(userId);

    // Sign new JWT
    const token = jwt.sign(
      { id: freshUser.id, email: freshUser.email, role: freshUser.role, name: freshUser.name, avatar: freshUser.avatar },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const days = parseInt(JWT_EXPIRES_IN) || 7;
    const cookieMaxAge = days * 24 * 60 * 60 * 1000;
    
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: cookieMaxAge
    });

    // Log Profile Update
    db.prepare("INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, 'Update Profile', 'user', ?, 'Updated profile settings.')")
      .run(userId, userId);

    res.cookie('flash_success', 'Profile settings updated successfully.', { maxAge: 5000 });
    res.redirect('/dashboard/profile');

  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'An error occurred while updating profile.', { maxAge: 5000 });
    res.redirect('/dashboard/profile');
  }
});

module.exports = router;
