const express = require('express');
const router = express.Router();
const db = require('../db/database');
const slugify = require('slugify');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');

router.use(requireAuth);
router.use(requireAdmin);

// ── Helpers ──────────────────────────────────────────────────────────────────

const logAdminAction = (req, action, targetType, targetId, details) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  db.prepare(`INSERT INTO activity_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user.id, action, targetType, targetId, `${details} | IP: ${ip}`);
};

const generateUniqueSlug = (title, excludeId = null) => {
  let base = slugify(title, { lower: true, strict: true });
  let slug = base, counter = 1;
  while (true) {
    let q = 'SELECT id FROM blogs WHERE slug = ?';
    const params = [slug];
    if (excludeId) { q += ' AND id != ?'; params.push(excludeId); }
    if (!db.prepare(q).get(params)) break;
    slug = `${base}-${counter++}`;
  }
  return slug;
};

const calcReadingTime = (html) => {
  const words = html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean);
  return Math.ceil(words.length / 200) || 1;
};

const getSiteSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
};

// Multer instance for media library uploads (field: media_file)
const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
const mediaUploadDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../public/uploads');
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, mediaUploadDir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/jpg','image/png','image/webp','image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only image files allowed.'), ok);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const total_users    = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const total_blogs    = db.prepare('SELECT COUNT(*) as c FROM blogs').get().c;
    const published_blogs = db.prepare("SELECT COUNT(*) as c FROM blogs WHERE status='published'").get().c;
    const pending_blogs  = db.prepare("SELECT COUNT(*) as c FROM blogs WHERE status='pending'").get().c;
    const total_views    = db.prepare('SELECT SUM(views) as c FROM blogs').get().c || 0;
    const total_contacts = db.prepare('SELECT COUNT(*) as c FROM contacts').get().c;
    const unread_contacts = db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status='unread'").get().c;
    const total_subscribers = db.prepare("SELECT COUNT(*) as c FROM newsletter WHERE active=1").get().c;

    const blogsPerMonth = db.prepare(`SELECT strftime('%Y-%m', published_at) as month, COUNT(*) as count FROM blogs WHERE status='published' AND published_at >= date('now','-12 months') GROUP BY month ORDER BY month ASC`).all();
    const registrationsPerMonth = db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM users WHERE created_at >= date('now','-6 months') GROUP BY month ORDER BY month ASC`).all();

    const chartBlogs = { labels: [], data: [] };
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const mStr = d.toISOString().slice(0, 7);
      chartBlogs.labels.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
      chartBlogs.data.push((blogsPerMonth.find(x => x.month === mStr) || {}).count || 0);
    }
    const chartUsers = { labels: [], data: [] };
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const mStr = d.toISOString().slice(0, 7);
      chartUsers.labels.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
      chartUsers.data.push((registrationsPerMonth.find(x => x.month === mStr) || {}).count || 0);
    }

    const recent_contacts = db.prepare(`SELECT * FROM contacts ORDER BY CASE WHEN status='unread' THEN 0 ELSE 1 END, created_at DESC LIMIT 5`).all();
    const recent_blogs    = db.prepare(`SELECT b.*, u.name as author_name FROM blogs b JOIN users u ON b.user_id=u.id WHERE b.status='pending' ORDER BY b.updated_at DESC LIMIT 5`).all();
    const recent_users    = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5').all();
    const activity_log    = db.prepare(`SELECT a.*, u.name as user_name FROM activity_log a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT 10`).all();

    res.render('admin/dashboard', {
      title: 'Admin Panel', settings: getSiteSettings(),
      counts: { total_users, total_blogs, published_blogs, pending_blogs, total_views, total_contacts, unread_contacts, total_subscribers },
      charts: { blogs: chartBlogs, users: chartUsers },
      recent_contacts, recent_blogs, recent_users, activity_log, cssFile: 'admin.css'
    });
  } catch (err) { console.error(err); res.status(500).send('Dashboard error.'); }
});

// ── Blog List ─────────────────────────────────────────────────────────────────

router.get('/blogs', (req, res) => {
  try {
    const status   = req.query.status   || 'pending';
    const category = req.query.category || '';
    const search   = req.query.search   || '';
    const page     = parseInt(req.query.page) || 1;
    const limit    = 15, offset = (page - 1) * limit;

    let cq = `SELECT COUNT(*) as count FROM blogs b LEFT JOIN categories c ON b.category_id=c.id JOIN users u ON b.user_id=u.id WHERE 1=1`;
    let dq = `SELECT b.*, u.name as author_name, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE 1=1`;
    const params = [];

    if (status !== 'all') { cq += ' AND b.status=?'; dq += ' AND b.status=?'; params.push(status); }
    if (category) { cq += ' AND c.slug=?'; dq += ' AND c.slug=?'; params.push(category); }
    if (search) {
      cq += ' AND (b.title LIKE ? OR u.name LIKE ?)'; dq += ' AND (b.title LIKE ? OR u.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const totalBlogs = db.prepare(cq).get(params).count;
    const totalPages = Math.ceil(totalBlogs / limit) || 1;
    dq += ' ORDER BY b.updated_at DESC LIMIT ? OFFSET ?';
    const blogs = db.prepare(dq).all([...params, limit, offset]);
    const categories     = db.prepare('SELECT id, name, slug FROM categories ORDER BY display_order').all();
    const pendingCount   = db.prepare("SELECT COUNT(*) as c FROM blogs WHERE status='pending'").get().c;
    const pendingCommentsCount = db.prepare("SELECT COUNT(*) as c FROM comments WHERE status='pending'").get().c;

    res.render('admin/blogs', {
      title: 'Manage Blogs', settings: getSiteSettings(), blogs, categories, pendingCount, pendingCommentsCount,
      filters: { status, category, search, page, totalPages }, cssFile: 'admin.css'
    });
  } catch (err) { console.error(err); res.status(500).send('Blog list error.'); }
});

// ── Blog Create ───────────────────────────────────────────────────────────────

router.get('/blogs/create', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY display_order').all();
    const authors    = db.prepare("SELECT id, name, designation FROM users WHERE status='active' ORDER BY name").all();
    res.render('admin/blog-compose', {
      title: 'Create Blog Post', settings: getSiteSettings(),
      blog: null, categories, authors, cssFile: 'admin.css', useQuill: true
    });
  } catch (err) { console.error(err); res.status(500).send('Error loading compose form.'); }
});

router.post('/blogs/create', uploadSingle, (req, res) => {
  try {
    const { title, slug: rawSlug, excerpt, content, category_id, tags, status, featured,
            allow_comments, reading_time, scheduled_at, author_id,
            meta_title, meta_description, og_title, og_description, og_image, canonical_url, cover_image_alt } = req.body;

    if (!title || !content || title.trim().length < 3) {
      res.cookie('flash_error', 'Title and content are required.', { maxAge: 5000 });
      return res.redirect('back');
    }
    if (!meta_title || !meta_description) {
      res.cookie('flash_error', 'SEO Meta Title and Meta Description are required before publishing.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const slug = rawSlug && rawSlug.trim()
      ? (() => { const s = slugify(rawSlug, { lower: true, strict: true }); const ex = db.prepare('SELECT id FROM blogs WHERE slug=?').get(s); return ex ? generateUniqueSlug(title) : s; })()
      : generateUniqueSlug(title);

    const readTime = parseInt(reading_time) || calcReadingTime(content);
    const authorId = parseInt(author_id) || req.user.id;
    const coverImage = req.file ? `/uploads/${req.file.filename}` : null;
    const publishedAt = status === 'published' ? "datetime('now')" : null;
    const scheduledAtVal = status === 'scheduled' && scheduled_at ? scheduled_at : null;

    const info = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, cover_image, cover_image_alt,
        tags, status, featured, allow_comments, reading_time, scheduled_at, published_at,
        meta_title, meta_description, og_title, og_description, og_image, canonical_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'published' ? "datetime('now')" : 'NULL'}, ?, ?, ?, ?, ?, ?)
    `).run(
      authorId, category_id || null, title.trim(), slug, excerpt?.trim() || null, content,
      coverImage, cover_image_alt?.trim() || null, tags?.trim() || '',
      status || 'draft', featured ? 1 : 0, allow_comments === 'on' ? 1 : 0,
      readTime, scheduledAtVal,
      meta_title?.trim() || null, meta_description?.trim() || null,
      og_title?.trim() || null, og_description?.trim() || null,
      og_image?.trim() || null, canonical_url?.trim() || null
    );

    // Track in media library if image uploaded
    if (req.file) {
      db.prepare(`INSERT INTO media (filename, original_name, url, mime_type, size_bytes, alt_text, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(req.file.filename, req.file.originalname, `/uploads/${req.file.filename}`, req.file.mimetype, req.file.size, cover_image_alt?.trim() || title.trim(), req.user.id);
    }

    logAdminAction(req, 'Create Blog', 'blog', info.lastInsertRowid, `Created blog "${title.trim()}" with status "${status}"`);
    res.cookie('flash_success', `Blog post "${title.trim()}" created successfully!`, { maxAge: 5000 });
    res.redirect(`/admin/blogs/${info.lastInsertRowid}/edit`);
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to create blog post.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Blog Edit ─────────────────────────────────────────────────────────────────

router.get('/blogs/:id/edit', (req, res) => {
  try {
    const blog = db.prepare(`SELECT b.*, u.name as author_name FROM blogs b JOIN users u ON b.user_id=u.id WHERE b.id=?`).get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Blog not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    const categories = db.prepare('SELECT * FROM categories ORDER BY display_order').all();
    const authors    = db.prepare("SELECT id, name, designation FROM users WHERE status='active' ORDER BY name").all();
    res.render('admin/blog-compose', {
      title: `Edit: ${blog.title}`, settings: getSiteSettings(),
      blog, categories, authors, cssFile: 'admin.css', useQuill: true
    });
  } catch (err) { console.error(err); res.status(500).send('Error loading edit form.'); }
});

router.post('/blogs/:id/edit', uploadSingle, (req, res) => {
  try {
    const blogId = req.params.id;
    const existing = db.prepare('SELECT * FROM blogs WHERE id=?').get(blogId);
    if (!existing) { res.cookie('flash_error', 'Blog not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }

    const { title, slug: rawSlug, excerpt, content, category_id, tags, status, featured,
            allow_comments, reading_time, scheduled_at, author_id,
            meta_title, meta_description, og_title, og_description, og_image, canonical_url, cover_image_alt } = req.body;

    if (!title || !content) { res.cookie('flash_error', 'Title and content are required.', { maxAge: 5000 }); return res.redirect('back'); }

    const slug = rawSlug && rawSlug.trim()
      ? (() => { const s = slugify(rawSlug, { lower: true, strict: true }); const ex = db.prepare('SELECT id FROM blogs WHERE slug=? AND id!=?').get(s, blogId); return ex ? existing.slug : s; })()
      : existing.slug;

    const readTime = parseInt(reading_time) || calcReadingTime(content);
    const coverImage = req.file ? `/uploads/${req.file.filename}` : existing.cover_image;
    const publishedAt = status === 'published' && !existing.published_at ? "datetime('now')" : existing.published_at;
    const scheduledAtVal = status === 'scheduled' && scheduled_at ? scheduled_at : null;

    db.prepare(`
      UPDATE blogs SET
        user_id=?, category_id=?, title=?, slug=?, excerpt=?, content=?, cover_image=?, cover_image_alt=?,
        tags=?, status=?, featured=?, allow_comments=?, reading_time=?, scheduled_at=?,
        published_at=CASE WHEN ? IS NOT NULL THEN ? WHEN status!='published' AND ?='published' THEN datetime('now') ELSE published_at END,
        meta_title=?, meta_description=?, og_title=?, og_description=?, og_image=?, canonical_url=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      parseInt(author_id) || existing.user_id, category_id || null, title.trim(), slug, excerpt?.trim() || null, content,
      coverImage, cover_image_alt?.trim() || existing.cover_image_alt || null,
      tags?.trim() || '', status || 'draft', featured ? 1 : 0, allow_comments === 'on' ? 1 : 0,
      readTime, scheduledAtVal,
      existing.published_at, existing.published_at, status,
      meta_title?.trim() || null, meta_description?.trim() || null,
      og_title?.trim() || null, og_description?.trim() || null,
      og_image?.trim() || null, canonical_url?.trim() || null,
      blogId
    );

    if (req.file) {
      db.prepare(`INSERT INTO media (filename, original_name, url, mime_type, size_bytes, alt_text, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(req.file.filename, req.file.originalname, `/uploads/${req.file.filename}`, req.file.mimetype, req.file.size, cover_image_alt?.trim() || title.trim(), req.user.id);
    }

    logAdminAction(req, 'Edit Blog', 'blog', blogId, `Updated blog "${title.trim()}"`);
    res.cookie('flash_success', 'Blog post updated successfully!', { maxAge: 5000 });
    res.redirect(`/admin/blogs/${blogId}/edit`);
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to update blog post: ' + err.message, { maxAge: 5000 }); res.redirect('back'); }
});

// ── Blog Duplicate ────────────────────────────────────────────────────────────

router.post('/blogs/:id/duplicate', (req, res) => {
  try {
    const blog = db.prepare('SELECT * FROM blogs WHERE id=?').get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Blog not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    const newSlug = generateUniqueSlug(`${blog.title} copy`);
    const info = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, cover_image, cover_image_alt,
        tags, status, reading_time, featured, allow_comments, meta_title, meta_description, og_title, og_description, og_image, canonical_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, blog.category_id, `${blog.title} (Copy)`, newSlug, blog.excerpt, blog.content,
      blog.cover_image, blog.cover_image_alt, blog.tags, blog.reading_time, blog.allow_comments || 1,
      blog.meta_title, blog.meta_description, blog.og_title, blog.og_description, blog.og_image, blog.canonical_url
    );
    logAdminAction(req, 'Duplicate Blog', 'blog', info.lastInsertRowid, `Duplicated blog "${blog.title}"`);
    res.cookie('flash_success', 'Blog duplicated as draft. You can now edit it.', { maxAge: 5000 });
    res.redirect(`/admin/blogs/${info.lastInsertRowid}/edit`);
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to duplicate blog.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Blog Detail / Review ──────────────────────────────────────────────────────

router.get('/blogs/:id', (req, res) => {
  try {
    const blog = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, u.designation as author_designation, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.id=?`).get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Article not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    const comments = db.prepare(`SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar FROM comments c JOIN users u ON c.user_id=u.id WHERE c.blog_id=? ORDER BY c.created_at ASC`).all(req.params.id);
    const settings = getSiteSettings();
    res.render('admin/blog-detail', { title: `Review — ${blog.title}`, settings, blog, comments, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error loading blog detail.'); }
});

// ── Blog Status Actions ───────────────────────────────────────────────────────

router.post('/blogs/:id/approve', (req, res) => {
  try {
    const blog = db.prepare('SELECT title FROM blogs WHERE id=?').get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Article not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    db.prepare("UPDATE blogs SET status='published', published_at=datetime('now') WHERE id=?").run(req.params.id);
    logAdminAction(req, 'Approve Blog', 'blog', req.params.id, `Approved blog "${blog.title}"`);
    res.cookie('flash_success', 'Blog approved and published!', { maxAge: 5000 });
    res.redirect('/admin/blogs?status=published');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to approve blog.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/blogs/:id/reject', (req, res) => {
  try {
    const { rejection_reason } = req.body;
    if (!rejection_reason || rejection_reason.trim().length < 10) {
      res.cookie('flash_error', 'Rejection reason must be at least 10 characters.', { maxAge: 5000 }); return res.redirect('back');
    }
    const blog = db.prepare('SELECT title FROM blogs WHERE id=?').get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Article not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    db.prepare("UPDATE blogs SET status='rejected', rejection_reason=? WHERE id=?").run(rejection_reason.trim(), req.params.id);
    logAdminAction(req, 'Reject Blog', 'blog', req.params.id, `Rejected blog "${blog.title}"`);
    res.cookie('flash_success', 'Blog rejected and returned to author.', { maxAge: 5000 });
    res.redirect('/admin/blogs?status=rejected');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to reject blog.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/blogs/:id/feature', (req, res) => {   // FIXED: was /admin/blogs/:id/feature
  try {
    const blog = db.prepare('SELECT featured, title FROM blogs WHERE id=?').get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Article not found.', { maxAge: 5000 }); return res.redirect('back'); }
    const newFeatured = blog.featured === 1 ? 0 : 1;
    db.prepare('UPDATE blogs SET featured=? WHERE id=?').run(newFeatured, req.params.id);
    logAdminAction(req, 'Feature Toggle', 'blog', req.params.id, `Toggled featured to ${newFeatured} on "${blog.title}"`);
    res.cookie('flash_success', `Featured status updated.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to toggle featured.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/blogs/:id/delete', (req, res) => {   // FIXED: was /admin/blogs/:id/delete
  try {
    const blog = db.prepare('SELECT title FROM blogs WHERE id=?').get(req.params.id);
    if (!blog) { res.cookie('flash_error', 'Article not found.', { maxAge: 5000 }); return res.redirect('/admin/blogs'); }
    db.prepare('DELETE FROM blogs WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Blog', 'blog', req.params.id, `Deleted blog "${blog.title}"`);
    res.cookie('flash_success', 'Blog deleted successfully.', { maxAge: 5000 });
    res.redirect('/admin/blogs');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to delete blog.', { maxAge: 5000 }); res.redirect('/admin/blogs'); }
});

// ── Comments ──────────────────────────────────────────────────────────────────

router.get('/comments', (req, res) => {
  try {
    const commentsList = db.prepare(`SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar, b.title as blog_title, b.slug as blog_slug FROM comments c JOIN users u ON c.user_id=u.id JOIN blogs b ON c.blog_id=b.id WHERE c.status='pending' ORDER BY c.created_at DESC`).all();
    const categories   = db.prepare('SELECT id, name FROM categories').all();
    const pendingCount = db.prepare("SELECT COUNT(*) as c FROM blogs WHERE status='pending'").get().c;
    res.render('admin/blogs', {
      title: 'Moderate Comments', settings: getSiteSettings(), blogs: [], categories,
      pendingCount, pendingCommentsCount: commentsList.length, commentsList,
      filters: { status: 'comments', category: '', search: '', page: 1, totalPages: 1 }, cssFile: 'admin.css'
    });
  } catch (err) { console.error(err); res.status(500).send('Error loading comments.'); }
});

router.post('/comments/:id/approve', (req, res) => {
  try {
    db.prepare("UPDATE comments SET status='approved' WHERE id=?").run(req.params.id);
    logAdminAction(req, 'Approve Comment', 'comment', req.params.id, 'Approved comment');
    res.cookie('flash_success', 'Comment approved.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/comments/:id/reject', (req, res) => {
  try {
    db.prepare("UPDATE comments SET status='rejected' WHERE id=?").run(req.params.id);
    logAdminAction(req, 'Reject Comment', 'comment', req.params.id, 'Rejected comment');
    res.cookie('flash_success', 'Comment rejected.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/comments/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM comments WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Comment', 'comment', req.params.id, 'Deleted comment');
    res.cookie('flash_success', 'Comment deleted.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM blogs b WHERE b.category_id=c.id) as post_count FROM categories c ORDER BY c.display_order ASC`).all();
    res.render('admin/categories', { title: 'Manage Categories', settings: getSiteSettings(), categories, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error loading categories.'); }
});

router.post('/categories', (req, res) => {
  try {
    const { name, description, color, display_order } = req.body;
    if (!name || name.trim().length < 2) { res.cookie('flash_error', 'Category name is required.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    const slug = slugify(name, { lower: true, strict: true });
    const existing = db.prepare('SELECT id FROM categories WHERE slug=?').get(slug);
    if (existing) { res.cookie('flash_error', 'A category with that name/slug already exists.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    const info = db.prepare(`INSERT INTO categories (name, slug, description, color, display_order) VALUES (?, ?, ?, ?, ?)`).run(name.trim(), slug, description?.trim() || null, color || '#c9a84c', parseInt(display_order) || 0);
    logAdminAction(req, 'Create Category', 'category', info.lastInsertRowid, `Created category "${name.trim()}"`);
    res.cookie('flash_success', 'Category created successfully!', { maxAge: 5000 });
    res.redirect('/admin/categories');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to create category.', { maxAge: 5000 }); res.redirect('/admin/categories'); }
});

router.post('/categories/:id/edit', (req, res) => {
  try {
    const { name, description, color, display_order } = req.body;
    if (!name) { res.cookie('flash_error', 'Name required.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
    if (!cat) { res.cookie('flash_error', 'Category not found.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    const newSlug = slugify(name, { lower: true, strict: true });
    const conflict = db.prepare('SELECT id FROM categories WHERE slug=? AND id!=?').get(newSlug, req.params.id);
    if (conflict) { res.cookie('flash_error', 'Another category already uses that slug.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    db.prepare('UPDATE categories SET name=?, slug=?, description=?, color=?, display_order=? WHERE id=?').run(name.trim(), newSlug, description?.trim() || null, color || '#c9a84c', parseInt(display_order) || 0, req.params.id);
    logAdminAction(req, 'Edit Category', 'category', req.params.id, `Updated category "${name.trim()}"`);
    res.cookie('flash_success', 'Category updated.', { maxAge: 5000 });
    res.redirect('/admin/categories');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to update category.', { maxAge: 5000 }); res.redirect('/admin/categories'); }
});

router.post('/categories/:id/delete', (req, res) => {
  try {
    const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(req.params.id);
    if (!cat) { res.cookie('flash_error', 'Category not found.', { maxAge: 5000 }); return res.redirect('/admin/categories'); }
    db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Category', 'category', req.params.id, `Deleted category "${cat.name}"`);
    res.cookie('flash_success', 'Category deleted.', { maxAge: 5000 });
    res.redirect('/admin/categories');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to delete category.', { maxAge: 5000 }); res.redirect('/admin/categories'); }
});

// ── Testimonials ──────────────────────────────────────────────────────────────

router.get('/testimonials', (req, res) => {
  try {
    const testimonials = db.prepare('SELECT * FROM testimonials ORDER BY display_order ASC').all();
    res.render('admin/testimonials', { title: 'Manage Testimonials', settings: getSiteSettings(), testimonials, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error loading testimonials.'); }
});

router.post('/testimonials', (req, res) => {
  try {
    const { name, designation, quote, avatar_seed, display_order, featured } = req.body;
    if (!name || !designation || !quote) { res.cookie('flash_error', 'Name, designation and quote are required.', { maxAge: 5000 }); return res.redirect('/admin/testimonials'); }
    const info = db.prepare('INSERT INTO testimonials (name, designation, quote, avatar_seed, display_order, featured, active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(name.trim(), designation.trim(), quote.trim(), avatar_seed?.trim() || name.trim(), parseInt(display_order) || 0, featured ? 1 : 0);
    logAdminAction(req, 'Create Testimonial', 'testimonial', info.lastInsertRowid, `Added testimonial from "${name.trim()}"`);
    res.cookie('flash_success', 'Testimonial added!', { maxAge: 5000 });
    res.redirect('/admin/testimonials');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to add testimonial.', { maxAge: 5000 }); res.redirect('/admin/testimonials'); }
});

router.post('/testimonials/:id/edit', (req, res) => {
  try {
    const { name, designation, quote, avatar_seed, display_order, featured } = req.body;
    db.prepare('UPDATE testimonials SET name=?, designation=?, quote=?, avatar_seed=?, display_order=?, featured=? WHERE id=?').run(name.trim(), designation.trim(), quote.trim(), avatar_seed?.trim() || name.trim(), parseInt(display_order) || 0, featured ? 1 : 0, req.params.id);
    logAdminAction(req, 'Edit Testimonial', 'testimonial', req.params.id, `Updated testimonial from "${name.trim()}"`);
    res.cookie('flash_success', 'Testimonial updated.', { maxAge: 5000 });
    res.redirect('/admin/testimonials');
  } catch (err) { res.cookie('flash_error', 'Failed to update.', { maxAge: 5000 }); res.redirect('/admin/testimonials'); }
});

router.post('/testimonials/:id/toggle', (req, res) => {
  try {
    const t = db.prepare('SELECT active FROM testimonials WHERE id=?').get(req.params.id);
    if (!t) { res.cookie('flash_error', 'Not found.', { maxAge: 5000 }); return res.redirect('back'); }
    db.prepare('UPDATE testimonials SET active=? WHERE id=?').run(t.active ? 0 : 1, req.params.id);
    res.cookie('flash_success', 'Testimonial visibility toggled.', { maxAge: 5000 });
    res.redirect('/admin/testimonials');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/testimonials/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM testimonials WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Testimonial', 'testimonial', req.params.id, 'Deleted testimonial');
    res.cookie('flash_success', 'Testimonial deleted.', { maxAge: 5000 });
    res.redirect('/admin/testimonials');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Services ──────────────────────────────────────────────────────────────────

router.get('/services', (req, res) => {
  try {
    const services = db.prepare('SELECT * FROM services ORDER BY display_order').all();
    res.render('admin/services', { title: 'Manage Services', settings: getSiteSettings(), services, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/services', (req, res) => {
  try {
    const { title, description, icon, tag, cta_url, display_order } = req.body;
    if (!title || !description || !icon) { res.cookie('flash_error', 'Title, description and icon are required.', { maxAge: 5000 }); return res.redirect('/admin/services'); }
    const info = db.prepare('INSERT INTO services (title, description, icon, tag, cta_url, display_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(title.trim(), description.trim(), icon.trim(), tag?.trim() || null, cta_url?.trim() || null, parseInt(display_order) || 0);
    logAdminAction(req, 'Create Service', 'service', info.lastInsertRowid, `Created service "${title}"`);
    res.cookie('flash_success', 'Service added!', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('/admin/services'); }
});

router.post('/services/:id', (req, res) => {
  try {
    const { title, description, icon, tag, cta_url, display_order } = req.body;
    db.prepare('UPDATE services SET title=?, description=?, icon=?, tag=?, cta_url=?, display_order=? WHERE id=?').run(title.trim(), description.trim(), icon.trim(), tag?.trim() || null, cta_url?.trim() || null, parseInt(display_order) || 0, req.params.id);
    logAdminAction(req, 'Update Service', 'service', req.params.id, `Updated service "${title}"`);
    res.cookie('flash_success', 'Service updated.', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('/admin/services'); }
});

router.post('/services/:id/toggle', (req, res) => {
  try {
    const svc = db.prepare('SELECT active, title FROM services WHERE id=?').get(req.params.id);
    if (!svc) { res.cookie('flash_error', 'Not found.', { maxAge: 5000 }); return res.redirect('/admin/services'); }
    db.prepare('UPDATE services SET active=? WHERE id=?').run(svc.active ? 0 : 1, req.params.id);
    res.cookie('flash_success', 'Service status toggled.', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('/admin/services'); }
});

router.post('/services/:id/delete', (req, res) => {
  try {
    const svc = db.prepare('SELECT title FROM services WHERE id=?').get(req.params.id);
    if (!svc) { res.cookie('flash_error', 'Not found.', { maxAge: 5000 }); return res.redirect('/admin/services'); }
    db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Service', 'service', req.params.id, `Deleted service "${svc.title}"`);
    res.cookie('flash_success', 'Service deleted.', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('/admin/services'); }
});

// ── Homepage Editor ───────────────────────────────────────────────────────────

router.get('/homepage', (req, res) => {
  try {
    const settings = getSiteSettings();
    const testimonials = db.prepare('SELECT * FROM testimonials ORDER BY display_order').all();
    res.render('admin/homepage', { title: 'Homepage Editor', settings, testimonials, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/homepage', (req, res) => {
  try {
    const updates = req.body;
    const allowedKeys = ['hero_heading','hero_subheading','hero_cta_primary_text','hero_cta_primary_url',
      'hero_cta_secondary_text','hero_cta_secondary_url','stats_publications_base','stats_years_experience',
      'stats_success_rate','stats_human_written','footer_about_text','footer_copyright'];
    const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, label, type, group_name) VALUES (?, ?, (SELECT label FROM settings WHERE key=?), (SELECT type FROM settings WHERE key=?), (SELECT group_name FROM settings WHERE key=?))');
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (key !== 'csrf_token' && allowedKeys.includes(key)) {
          updateStmt.run(key, (value || '').trim(), key, key, key);
        }
      }
    })();
    logAdminAction(req, 'Update Homepage', 'settings', 0, 'Updated homepage/stats content');
    res.cookie('flash_success', 'Homepage content saved!', { maxAge: 5000 });
    res.redirect('/admin/homepage');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to save homepage settings.', { maxAge: 5000 }); res.redirect('/admin/homepage'); }
});

// ── Legal Pages ───────────────────────────────────────────────────────────────

router.get('/pages', (req, res) => {
  try {
    const pages = db.prepare('SELECT id, slug, title, updated_at FROM pages ORDER BY slug').all();
    res.render('admin/pages', { title: 'Legal Pages', settings: getSiteSettings(), pages, editPage: null, cssFile: 'admin.css', useQuill: true });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.get('/pages/:slug/edit', (req, res) => {
  try {
    const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
    if (!page) { res.cookie('flash_error', 'Page not found.', { maxAge: 5000 }); return res.redirect('/admin/pages'); }
    const pages = db.prepare('SELECT id, slug, title, updated_at FROM pages ORDER BY slug').all();
    res.render('admin/pages', { title: `Edit: ${page.title}`, settings: getSiteSettings(), pages, editPage: page, cssFile: 'admin.css', useQuill: true });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/pages/:slug/edit', (req, res) => {
  try {
    const { title, content, meta_title, meta_description } = req.body;
    if (!title || !content) { res.cookie('flash_error', 'Title and content are required.', { maxAge: 5000 }); return res.redirect('back'); }
    db.prepare('UPDATE pages SET title=?, content=?, meta_title=?, meta_description=?, updated_at=datetime(\'now\') WHERE slug=?').run(title.trim(), content, meta_title?.trim() || null, meta_description?.trim() || null, req.params.slug);
    logAdminAction(req, 'Edit Page', 'page', 0, `Updated legal page "${req.params.slug}"`);
    res.cookie('flash_success', 'Page updated successfully!', { maxAge: 5000 });
    res.redirect(`/admin/pages/${req.params.slug}/edit`);
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to update page.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Redirect Manager ──────────────────────────────────────────────────────────

router.get('/redirects', (req, res) => {
  try {
    const redirects = db.prepare('SELECT * FROM redirects ORDER BY created_at DESC').all();
    res.render('admin/redirects', { title: 'Redirect Manager', settings: getSiteSettings(), redirects, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/redirects', (req, res) => {
  try {
    const { from_path, to_url, status_code, note } = req.body;
    if (!from_path || !to_url) { res.cookie('flash_error', 'From path and To URL are required.', { maxAge: 5000 }); return res.redirect('/admin/redirects'); }
    const fromPath = from_path.trim().startsWith('/') ? from_path.trim() : `/${from_path.trim()}`;
    const existing = db.prepare('SELECT id FROM redirects WHERE from_path=?').get(fromPath);
    if (existing) { res.cookie('flash_error', 'A redirect from that path already exists.', { maxAge: 5000 }); return res.redirect('/admin/redirects'); }
    const info = db.prepare('INSERT INTO redirects (from_path, to_url, status_code, note) VALUES (?, ?, ?, ?)').run(fromPath, to_url.trim(), parseInt(status_code) || 301, note?.trim() || null);
    logAdminAction(req, 'Create Redirect', 'redirect', info.lastInsertRowid, `Created redirect ${fromPath} → ${to_url}`);
    res.cookie('flash_success', 'Redirect created!', { maxAge: 5000 });
    res.redirect('/admin/redirects');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to create redirect.', { maxAge: 5000 }); res.redirect('/admin/redirects'); }
});

router.post('/redirects/:id/delete', (req, res) => {
  try {
    const r = db.prepare('SELECT from_path FROM redirects WHERE id=?').get(req.params.id);
    db.prepare('DELETE FROM redirects WHERE id=?').run(req.params.id);
    logAdminAction(req, 'Delete Redirect', 'redirect', req.params.id, `Deleted redirect from "${r?.from_path}"`);
    res.cookie('flash_success', 'Redirect removed.', { maxAge: 5000 });
    res.redirect('/admin/redirects');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Media Library ─────────────────────────────────────────────────────────────

router.get('/media', (req, res) => {
  try {
    const page  = parseInt(req.query.page) || 1;
    const limit = 24, offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as c FROM media').get().c;
    const files = db.prepare('SELECT m.*, u.name as uploader FROM media m LEFT JOIN users u ON m.uploaded_by=u.id ORDER BY m.created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.render('admin/media', { title: 'Media Library', settings: getSiteSettings(), files, currentPage: page, totalPages: Math.ceil(total / limit) || 1, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/media/upload', (req, res) => {
  mediaUpload.single('media_file')(req, res, (err) => {
    if (err) {
      if (req.headers.accept?.includes('json')) return res.status(400).json({ success: false, error: err.message });
      res.cookie('flash_error', err.message, { maxAge: 5000 }); return res.redirect('/admin/media');
    }
    if (!req.file) {
      if (req.headers.accept?.includes('json')) return res.status(400).json({ success: false, error: 'No file uploaded.' });
      res.cookie('flash_error', 'No file uploaded.', { maxAge: 5000 }); return res.redirect('/admin/media');
    }
    const { alt_text } = req.body;
    const url = `/uploads/${req.file.filename}`;
    const info = db.prepare('INSERT INTO media (filename, original_name, url, mime_type, size_bytes, alt_text, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.file.filename, req.file.originalname, url, req.file.mimetype, req.file.size, alt_text?.trim() || req.file.originalname, req.user.id);
    logAdminAction(req, 'Upload Media', 'media', info.lastInsertRowid, `Uploaded "${req.file.originalname}"`);
    if (req.headers.accept?.includes('json')) return res.json({ success: true, url, id: info.lastInsertRowid });
    res.cookie('flash_success', 'File uploaded to media library!', { maxAge: 5000 });
    res.redirect('/admin/media');
  });
});

router.post('/media/:id/update-alt', (req, res) => {
  try {
    const { alt_text } = req.body;
    db.prepare('UPDATE media SET alt_text=? WHERE id=?').run(alt_text?.trim() || '', req.params.id);
    res.cookie('flash_success', 'Alt text updated.', { maxAge: 5000 });
    res.redirect('/admin/media');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/media/:id/delete', (req, res) => {
  try {
    const file = db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id);
    if (file) {
      const filePath = isVercel ? `/tmp/uploads/${file.filename}` : path.join(__dirname, '../public/uploads', file.filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      db.prepare('DELETE FROM media WHERE id=?').run(req.params.id);
      logAdminAction(req, 'Delete Media', 'media', req.params.id, `Deleted file "${file.filename}"`);
    }
    if (req.headers.accept?.includes('json')) return res.json({ success: true });
    res.cookie('flash_success', 'File deleted.', { maxAge: 5000 });
    res.redirect('/admin/media');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  try {
    const search = req.query.search || '', role = req.query.role || '', status = req.query.status || '';
    const page = parseInt(req.query.page) || 1, limit = 15, offset = (page - 1) * limit;
    let cq = 'SELECT COUNT(*) as count FROM users WHERE 1=1', dq = `SELECT u.*, (SELECT COUNT(*) FROM blogs b WHERE b.user_id=u.id) as blog_count FROM users u WHERE 1=1`;
    const params = [];
    if (search) { cq += ' AND (name LIKE ? OR email LIKE ?)'; dq += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (role)   { cq += ' AND role=?'; dq += ' AND u.role=?'; params.push(role); }
    if (status) { cq += ' AND status=?'; dq += ' AND u.status=?'; params.push(status); }
    const totalUsers = db.prepare(cq).get(params).count;
    dq += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    const users = db.prepare(dq).all([...params, limit, offset]);
    res.render('admin/users', { title: 'Manage Users', settings: getSiteSettings(), users, filters: { search, role, status, page, totalPages: Math.ceil(totalUsers / limit) || 1 }, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.get('/users/:id', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) { res.cookie('flash_error', 'User not found.', { maxAge: 5000 }); return res.redirect('/admin/users'); }
    const blogs    = db.prepare(`SELECT b.*, c.name as category_name FROM blogs b LEFT JOIN categories c ON b.category_id=c.id WHERE b.user_id=? ORDER BY b.created_at DESC`).all(req.params.id);
    const comments = db.prepare(`SELECT c.*, b.title as blog_title, b.slug as blog_slug FROM comments c JOIN blogs b ON c.blog_id=b.id WHERE c.user_id=? ORDER BY c.created_at DESC`).all(req.params.id);
    const timeline = db.prepare('SELECT * FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 15').all(req.params.id);
    res.render('admin/user-detail', { title: `User — ${user.name}`, settings: getSiteSettings(), profileUser: user, blogs, comments, timeline, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/users/:id/toggle-status', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) { res.cookie('flash_error', 'You cannot ban yourself.', { maxAge: 5000 }); return res.redirect('back'); }
    const user = db.prepare('SELECT status, name FROM users WHERE id=?').get(targetId);
    if (!user) { res.cookie('flash_error', 'Not found.', { maxAge: 5000 }); return res.redirect('back'); }
    const newStatus = user.status === 'active' ? 'banned' : 'active';
    db.prepare('UPDATE users SET status=? WHERE id=?').run(newStatus, targetId);
    logAdminAction(req, 'Toggle User Status', 'user', targetId, `Toggled "${user.name}" to "${newStatus}"`);
    res.cookie('flash_success', `User status set to ${newStatus}.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/users/:id/change-role', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) { res.cookie('flash_error', 'Cannot change your own role.', { maxAge: 5000 }); return res.redirect('back'); }
    const user = db.prepare('SELECT role, name FROM users WHERE id=?').get(targetId);
    if (!user) { res.cookie('flash_error', 'Not found.', { maxAge: 5000 }); return res.redirect('back'); }
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    db.prepare('UPDATE users SET role=? WHERE id=?').run(newRole, targetId);
    logAdminAction(req, 'Change Role', 'user', targetId, `Changed "${user.name}" to "${newRole}"`);
    res.cookie('flash_success', `Role updated to ${newRole}.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/users/:id/delete', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) { res.cookie('flash_error', 'Cannot delete yourself.', { maxAge: 5000 }); return res.redirect('back'); }
    const user = db.prepare('SELECT name FROM users WHERE id=?').get(targetId);
    db.prepare('DELETE FROM users WHERE id=?').run(targetId);
    logAdminAction(req, 'Delete User', 'user', targetId, `Deleted user "${user?.name}"`);
    res.cookie('flash_success', 'User deleted.', { maxAge: 5000 });
    res.redirect('/admin/users');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Contacts ──────────────────────────────────────────────────────────────────

router.get('/contacts', (req, res) => {
  try {
    const status = req.query.status || 'unread', page = parseInt(req.query.page) || 1;
    const limit = 20, offset = (page - 1) * limit;
    let cq = 'SELECT COUNT(*) as count FROM contacts WHERE 1=1', dq = 'SELECT * FROM contacts WHERE 1=1';
    const params = [];
    if (status !== 'all') { cq += ' AND status=?'; dq += ' AND status=?'; params.push(status); }
    const total = db.prepare(cq).get(params).count;
    dq += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const contacts = db.prepare(dq).all([...params, limit, offset]);
    const unreadCount = db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status='unread'").get().c;
    res.render('admin/contacts', { title: 'Contact Submissions', settings: getSiteSettings(), contacts, unreadCount, filters: { status, page, totalPages: Math.ceil(total / limit) || 1 }, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/contacts/:id/read', (req, res) => {
  try {
    db.prepare("UPDATE contacts SET status='read' WHERE id=?").run(req.params.id);
    if (req.headers.accept?.includes('json')) return res.json({ success: true });
    res.cookie('flash_success', 'Marked as read.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) {
    if (req.headers.accept?.includes('json')) return res.status(500).json({ success: false });
    res.redirect('back');
  }
});

router.post('/contacts/:id/replied', (req, res) => {
  try {
    const { admin_note } = req.body;
    db.prepare("UPDATE contacts SET status='replied', admin_note=? WHERE id=?").run(admin_note || '', req.params.id);
    logAdminAction(req, 'Reply Contact', 'contact', req.params.id, `Marked contact as replied`);
    res.cookie('flash_success', 'Response recorded.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/contacts/:id/convert', (req, res) => {
  try {
    db.prepare("UPDATE contacts SET status='converted' WHERE id=?").run(req.params.id);
    logAdminAction(req, 'Convert Lead', 'contact', req.params.id, `Marked contact as converted`);
    res.cookie('flash_success', 'Lead marked as converted!', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

router.post('/contacts/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
    res.cookie('flash_success', 'Submission deleted.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Newsletter ────────────────────────────────────────────────────────────────

router.get('/newsletter', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 20, offset = (page - 1) * limit;
    const total  = db.prepare('SELECT COUNT(*) as c FROM newsletter').get().c;
    const active = db.prepare('SELECT COUNT(*) as c FROM newsletter WHERE active=1').get().c;
    const unsub  = db.prepare('SELECT COUNT(*) as c FROM newsletter WHERE active=0').get().c;
    const subscribers = db.prepare('SELECT * FROM newsletter ORDER BY subscribed_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    res.render('admin/newsletter', { title: 'Newsletter Subscribers', settings: getSiteSettings(), subscribers, totalCount: total, activeCount: active, unsubscribedCount: unsub, currentPage: page, totalPages: Math.ceil(total / limit) || 1, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.get('/newsletter/export', (req, res) => {
  try {
    const subscribers = db.prepare('SELECT email, subscribed_at, active FROM newsletter ORDER BY subscribed_at DESC').all();
    const csv = ['Email,Subscribed At,Active', ...subscribers.map(s => `${s.email},${s.subscribed_at},${s.active ? 'Yes' : 'No'}`)].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="scholarsedge-subscribers-${new Date().toISOString().slice(0,10)}.csv"`);
    logAdminAction(req, 'Export Newsletter', 'newsletter', 0, `Exported ${subscribers.length} subscribers as CSV`);
    res.send(csv);
  } catch (err) { console.error(err); res.status(500).send('Export failed.'); }
});

router.post('/newsletter/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM newsletter WHERE id=?').run(req.params.id);
    res.cookie('flash_success', 'Subscriber removed.', { maxAge: 5000 }); res.redirect('back');
  } catch (err) { res.cookie('flash_error', 'Failed.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  try {
    const settingsList = db.prepare('SELECT * FROM settings ORDER BY group_name, key').all();
    res.render('admin/settings', { title: 'Site Settings', settings: getSiteSettings(), settingsList, cssFile: 'admin.css' });
  } catch (err) { console.error(err); res.status(500).send('Error.'); }
});

router.post('/settings', (req, res) => {
  try {
    const updates = req.body;
    const updateStmt = db.prepare('UPDATE settings SET value=? WHERE key=?');
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (key !== 'csrf_token') updateStmt.run((value || '').trim(), key);
      }
    })();
    logAdminAction(req, 'Update Settings', 'settings', 0, 'Updated global site settings');
    res.cookie('flash_success', 'Settings saved successfully!', { maxAge: 5000 });
    res.redirect('/admin/settings');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to save settings.', { maxAge: 5000 }); res.redirect('/admin/settings'); }
});

// ── Sitemap Preview ───────────────────────────────────────────────────────────

router.get('/sitemap', (req, res) => {
  try {
    const settings  = getSiteSettings();
    const baseUrl   = settings.base_url || 'https://scholoar-edge.vercel.app';
    const blogs     = db.prepare("SELECT slug, updated_at FROM blogs WHERE status='published' ORDER BY updated_at DESC").all();
    const pages     = db.prepare('SELECT slug, updated_at FROM pages').all();
    res.render('admin/sitemap-preview', { title: 'Sitemap', settings, baseUrl, blogs, pages, cssFile: 'admin.css' });
  } catch (err) { res.status(500).send('Error.'); }
});

// ── API: Slug uniqueness check ────────────────────────────────────────────────

router.get('/api/check-slug', (req, res) => {
  const { slug, excludeId } = req.query;
  if (!slug) return res.json({ available: false });
  const s = slugify(slug, { lower: true, strict: true });
  let q = 'SELECT id FROM blogs WHERE slug=?';
  const params = [s];
  if (excludeId) { q += ' AND id!=?'; params.push(excludeId); }
  const existing = db.prepare(q).get(params);
  res.json({ available: !existing, slug: s });
});

// ── API: Duplicate meta check ─────────────────────────────────────────────────

router.get('/api/check-meta', (req, res) => {
  const { field, value, excludeId } = req.query;
  if (!field || !value || !['meta_title','meta_description'].includes(field)) return res.json({ duplicates: [] });
  let q = `SELECT id, title, slug FROM blogs WHERE ${field}=? AND ${field} IS NOT NULL`;
  const params = [value.trim()];
  if (excludeId) { q += ' AND id!=?'; params.push(excludeId); }
  const duplicates = db.prepare(q).all(params);
  res.json({ duplicates });
});

module.exports = router;
