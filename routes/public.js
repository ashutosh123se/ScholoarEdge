const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { notifyAdminNewContact, sendNewsletterConfirmation } = require('../middleware/email');
const rateLimit = require('express-rate-limit');

// Rate limiter for contact: 3 per hour per IP
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  message: 'Too many contact requests from this IP. Please try again after an hour.',
  handler: (req, res) => { res.cookie('flash_error', 'Too many requests. Please try again in an hour.', { maxAge: 5000 }); res.redirect('/contact'); }
});

// Helper
function getSiteSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
}

// ── 301 Redirect middleware (runs on all public GET requests) ─────────────────
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    const redirect = db.prepare('SELECT to_url, status_code FROM redirects WHERE from_path=?').get(req.path);
    if (redirect) {
      db.prepare('UPDATE redirects SET hit_count = hit_count + 1 WHERE from_path=?').run(req.path);
      return res.redirect(redirect.status_code || 301, redirect.to_url);
    }
  } catch (e) { /* ignore */ }
  next();
});

// ── Homepage ──────────────────────────────────────────────────────────────────

router.get('/', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const featuredBlogs = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.status='published' AND b.featured=1 ORDER BY b.published_at DESC LIMIT 6`).all();
    const latestBlogs   = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.status='published' ORDER BY b.published_at DESC LIMIT 3`).all();
    const services      = db.prepare("SELECT * FROM services WHERE active=1 ORDER BY display_order").all();
    const testimonials  = db.prepare("SELECT * FROM testimonials WHERE active=1 ORDER BY display_order").all();
    const totalBlogs    = db.prepare("SELECT COUNT(*) as c FROM blogs WHERE status='published'").get().c;
    const totalViews    = db.prepare("SELECT SUM(views) as c FROM blogs").get().c || 0;

    res.render('index', {
      title: settings.site_name || 'ScholarsEdge',
      metaTitle: settings.default_meta_title || `${settings.site_name || 'ScholarsEdge'} — Academic Research & Journal Publication Services`,
      metaDescription: settings.meta_description || 'Premium academic research assistance and journal publication support. Specialized in Scopus, SCI, and UGC Care journals.',
      settings, featuredBlogs, latestBlogs, services, testimonials,
      stats: { totalBlogs, totalViews },
      cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Homepage error.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
});

// ── Blog Index ────────────────────────────────────────────────────────────────

router.get('/blog', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const page = parseInt(req.query.page) || 1, limit = 10, offset = (page - 1) * limit;
    const catFilter = req.query.category || '', searchFilter = req.query.search || '', tagFilter = req.query.tag || '';

    let qStr = `SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name, c.slug as category_slug FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.status='published'`;
    const params = [];
    if (catFilter) { qStr += ' AND c.slug=?'; params.push(catFilter); }
    if (searchFilter) { qStr += ' AND (b.title LIKE ? OR b.excerpt LIKE ? OR b.content LIKE ?)'; const lp = `%${searchFilter}%`; params.push(lp, lp, lp); }
    if (tagFilter) { qStr += ' AND b.tags LIKE ?'; params.push(`%${tagFilter}%`); }

    const cqStr = qStr.replace('b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name, c.slug as category_slug', 'COUNT(*) as count');
    const totalBlogs = db.prepare(cqStr).get(params).count;
    qStr += ' ORDER BY b.published_at DESC LIMIT ? OFFSET ?';
    const blogs = db.prepare(qStr).all([...params, limit, offset]);

    const categories  = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM blogs b WHERE b.category_id=c.id AND b.status='published') as post_count FROM categories c`).all();
    const blogsWTags  = db.prepare("SELECT tags FROM blogs WHERE status='published' AND tags!=''").all();
    const tagMap = {};
    blogsWTags.forEach(b => { b.tags.split(',').forEach(t => { const ct = t.trim(); if (ct) tagMap[ct] = (tagMap[ct] || 0) + 1; }); });
    const tagsCloud = Object.entries(tagMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15);
    const featuredBlog = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.status='published' AND b.featured=1 ORDER BY b.published_at DESC LIMIT 1`).get();

    res.render('blog', {
      title: 'Publications Blog',
      metaTitle: `Academic Research Blog | ${settings.site_name || 'ScholarsEdge'}`,
      metaDescription: 'Explore academic research guides, journal publication tips, PhD thesis advice, and data analysis strategies from ScholarsEdge editorial experts.',
      settings, blogs, categories, tagsCloud, featuredBlog,
      filters: { category: catFilter, search: searchFilter, tag: tagFilter, page, totalPages: Math.ceil(totalBlogs / limit) || 1 },
      cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Blog error.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
});

// ── Blog Post ─────────────────────────────────────────────────────────────────

router.get('/blog/:slug', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const blog = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, u.bio as author_bio, u.designation as author_designation, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.slug=?`).get(req.params.slug);
    if (!blog) return res.status(404).render('404', { title: 'Not Found', message: 'This post does not exist.', cssFile: 'main.css', settings, user: req.user || null });
    if (blog.status !== 'published') {
      const isAdmin = req.user?.role === 'admin', isAuthor = req.user?.id === blog.user_id;
      if (!isAdmin && !isAuthor) return res.status(404).render('404', { title: 'Not Found', message: 'Post pending review.', cssFile: 'main.css', settings, user: req.user || null });
    }

    db.prepare('UPDATE blogs SET views = views + 1 WHERE id=?').run(blog.id);
    const comments    = db.prepare(`SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar, u.designation as commenter_designation FROM comments c JOIN users u ON c.user_id=u.id WHERE c.blog_id=? AND c.status='approved' ORDER BY c.created_at ASC`).all(blog.id);
    const relatedBlogs = db.prepare(`SELECT b.*, u.name as author_name, u.avatar as author_avatar, c.name as category_name FROM blogs b JOIN users u ON b.user_id=u.id LEFT JOIN categories c ON b.category_id=c.id WHERE b.status='published' AND b.category_id=? AND b.id!=? ORDER BY b.published_at DESC LIMIT 3`).all(blog.category_id, blog.id);

    // Per-post SEO: use custom meta_title/description, fall back to title/excerpt
    const metaTitle       = blog.meta_title       || `${blog.title} | ${settings.site_name || 'ScholarsEdge'}`;
    const metaDescription = blog.meta_description  || blog.excerpt || settings.meta_description;
    const ogTitle         = blog.og_title          || metaTitle;
    const ogDescription   = blog.og_description    || metaDescription;
    const ogImage         = blog.og_image          || blog.cover_image || null;
    const canonicalUrl    = blog.canonical_url      || `${settings.base_url || ''}/blog/${blog.slug}`;

    res.render('blog-detail', {
      title: blog.title, settings, blog, comments, relatedBlogs,
      metaTitle, metaDescription, ogTitle, ogDescription, ogImage, canonicalUrl,
      isArticle: true,
      cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Failed to load article.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
});

// ── Comment Submit ────────────────────────────────────────────────────────────

router.post('/blog/:slug/comment', requireAuth, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.trim().length === 0) { res.cookie('flash_error', 'Comment cannot be empty.', { maxAge: 5000 }); return res.redirect(`/blog/${req.params.slug}`); }
    const blog = db.prepare('SELECT id FROM blogs WHERE slug=?').get(req.params.slug);
    if (!blog) { res.cookie('flash_error', 'Post not found.', { maxAge: 5000 }); return res.redirect('/blog'); }
    db.prepare("INSERT INTO comments (blog_id, user_id, content, status) VALUES (?, ?, ?, 'pending')").run(blog.id, req.user.id, content.trim());
    res.cookie('flash_success', 'Comment submitted and pending admin approval.', { maxAge: 5000 });
    res.redirect(`/blog/${req.params.slug}`);
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to post comment.', { maxAge: 5000 }); res.redirect('back'); }
});

// ── Services ──────────────────────────────────────────────────────────────────

router.get('/services', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const services = db.prepare("SELECT * FROM services WHERE active=1 ORDER BY display_order").all();
    res.render('services', {
      title: 'Our Services',
      metaTitle: `Academic Publication Services | ${settings.site_name || 'ScholarsEdge'}`,
      metaDescription: 'Explore ScholarsEdge academic services: PhD thesis writing, Scopus journal support, SCI publication, UGC Care journals, research paper writing, and data analysis.',
      settings, services, cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Services error.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
});

// ── Contact ───────────────────────────────────────────────────────────────────

router.get('/contact', optionalAuth, (req, res) => {
  try {
    const settings = getSiteSettings();
    const services  = db.prepare("SELECT title FROM services WHERE active=1 ORDER BY display_order").all();
    res.render('contact', {
      title: 'Contact Us',
      metaTitle: `Contact ScholarsEdge — Book a Free Consultation`,
      metaDescription: 'Get in touch with ScholarsEdge for academic research support, journal publication assistance, PhD thesis writing, and data analysis consultations.',
      settings, services, cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Contact error.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
});

router.post('/contact', contactLimiter, optionalAuth, async (req, res) => {
  try {
    const settings = getSiteSettings();
    const { name, email, phone, service, message } = req.body;
    if (!name || name.trim().length < 2) { res.cookie('flash_error', 'Please enter a valid name (min 2 characters).', { maxAge: 5000 }); return res.redirect('/contact'); }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) { res.cookie('flash_error', 'Please enter a valid email address.', { maxAge: 5000 }); return res.redirect('/contact'); }
    if (!message || message.trim().length < 10) { res.cookie('flash_error', 'Please enter a message of at least 10 characters.', { maxAge: 5000 }); return res.redirect('/contact'); }

    const contact = { name: name.trim(), email: email.trim(), phone: phone?.trim() || null, service: service || 'General Enquiry', message: message.trim() };
    db.prepare("INSERT INTO contacts (name, email, phone, service, message, status) VALUES (?, ?, ?, ?, ?, 'unread')").run(contact.name, contact.email, contact.phone, contact.service, contact.message);

    // Send admin email notification (async, non-blocking)
    notifyAdminNewContact(contact).catch(e => console.error('[Email] Contact notify failed:', e));

    res.cookie('flash_success', 'Your query has been received. We will respond within 24 hours!', { maxAge: 5000 });
    res.redirect('/contact');
  } catch (err) { console.error(err); res.cookie('flash_error', 'Failed to submit contact form.', { maxAge: 5000 }); res.redirect('/contact'); }
});

// ── Newsletter ────────────────────────────────────────────────────────────────

router.post('/newsletter', (req, res) => {
  try {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) return res.status(400).json({ success: false, error: 'Invalid email address.' });
    db.prepare('INSERT OR IGNORE INTO newsletter (email, active) VALUES (?, 1)').run(email.toLowerCase().trim());
    db.prepare('UPDATE newsletter SET active=1 WHERE email=?').run(email.toLowerCase().trim());
    // Send confirmation email (non-blocking)
    sendNewsletterConfirmation(email).catch(e => console.error('[Email] Newsletter confirm failed:', e));
    res.json({ success: true, message: 'Thank you for subscribing to our research digest!' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, error: 'Subscription failed.' }); }
});

// ── Legal / Static Pages ──────────────────────────────────────────────────────

router.get('/privacy-policy', optionalAuth, (req, res) => renderPage(req, res, 'privacy-policy'));
router.get('/terms-conditions', optionalAuth, (req, res) => renderPage(req, res, 'terms-conditions'));
router.get('/editorial-guidelines', optionalAuth, (req, res) => renderPage(req, res, 'editorial-guidelines'));

function renderPage(req, res, slug) {
  try {
    const settings = getSiteSettings();
    const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(slug);
    if (!page) return res.status(404).render('404', { title: 'Not Found', message: 'Page not found.', cssFile: 'main.css', settings, user: req.user || null });
    res.render('page', {
      title: page.title,
      metaTitle: page.meta_title || `${page.title} | ${settings.site_name || 'ScholarsEdge'}`,
      metaDescription: page.meta_description || settings.meta_description,
      settings, page, cssFile: 'main.css'
    });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error', message: 'Page error.', cssFile: 'main.css', settings: {}, user: req.user || null }); }
}

// ── Sitemap.xml ───────────────────────────────────────────────────────────────

router.get('/sitemap.xml', (req, res) => {
  try {
    const settings   = getSiteSettings();
    const baseUrl    = (settings.base_url || 'https://scholoar-edge.vercel.app').replace(/\/$/, '');
    const blogs      = db.prepare("SELECT slug, updated_at FROM blogs WHERE status='published' ORDER BY updated_at DESC").all();
    const pages      = db.prepare('SELECT slug, updated_at FROM pages').all();
    const staticUrls = [
      { url: '/', priority: '1.0', changefreq: 'weekly' },
      { url: '/blog', priority: '0.9', changefreq: 'daily' },
      { url: '/services', priority: '0.8', changefreq: 'monthly' },
      { url: '/contact', priority: '0.7', changefreq: 'monthly' },
    ];

    const today = new Date().toISOString().slice(0, 10);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    staticUrls.forEach(u => {
      xml += `  <url><loc>${baseUrl}${u.url}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>\n`;
    });
    pages.forEach(p => {
      xml += `  <url><loc>${baseUrl}/${p.slug}</loc><lastmod>${(p.updated_at || today).slice(0, 10)}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>\n`;
    });
    blogs.forEach(b => {
      xml += `  <url><loc>${baseUrl}/blog/${b.slug}</loc><lastmod>${(b.updated_at || today).slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
    });
    xml += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) { console.error(err); res.status(500).send('Sitemap error.'); }
});

// ── Robots.txt ────────────────────────────────────────────────────────────────

router.get('/robots.txt', (req, res) => {
  try {
    const settings = getSiteSettings();
    const baseUrl  = (settings.base_url || 'https://scholoar-edge.vercel.app').replace(/\/$/, '');
    const disallowPaths = (settings.robots_disallow || '/admin\n/dashboard\n/auth').split('\n').map(p => p.trim()).filter(Boolean);
    let txt = `User-agent: *\n`;
    disallowPaths.forEach(p => txt += `Disallow: ${p}\n`);
    txt += `\nSitemap: ${baseUrl}/sitemap.xml\n`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(txt);
  } catch (err) { res.status(500).send('Robots error.'); }
});

module.exports = router;
