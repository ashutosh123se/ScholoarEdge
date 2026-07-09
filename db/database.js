const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file path (detect Vercel to use writable /tmp folder)
const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
const dbPath = isVercel
  ? '/tmp/scholarsedge.db'
  : path.join(__dirname, '../scholarsedge.db');
const db = new Database(dbPath, { verbose: null });

// Enable foreign keys support in SQLite
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────────────────────────────────────
// CREATE TABLES
// ─────────────────────────────────────────────────────────────────────────────
db.transaction(() => {
  // Users Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      avatar TEXT DEFAULT NULL,
      bio TEXT DEFAULT NULL,
      designation TEXT DEFAULT NULL,
      status TEXT DEFAULT 'active',
      email_verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT NULL
    )
  `).run();

  // Blog Categories Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#c9a84c',
      display_order INTEGER DEFAULT 0
    )
  `).run();

  // Blogs Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt TEXT,
      content TEXT NOT NULL,
      cover_image TEXT DEFAULT NULL,
      cover_image_alt TEXT DEFAULT NULL,
      tags TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      rejection_reason TEXT DEFAULT NULL,
      views INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      allow_comments INTEGER DEFAULT 1,
      meta_title TEXT DEFAULT NULL,
      meta_description TEXT DEFAULT NULL,
      og_title TEXT DEFAULT NULL,
      og_description TEXT DEFAULT NULL,
      og_image TEXT DEFAULT NULL,
      canonical_url TEXT DEFAULT NULL,
      scheduled_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )
  `).run();

  // Comments Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blog_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  // Services Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      tag TEXT DEFAULT NULL,
      cta_url TEXT DEFAULT NULL,
      display_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Contact Submissions Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      service TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      admin_note TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Newsletter Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1
    )
  `).run();

  // Site Settings Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      label TEXT,
      type TEXT DEFAULT 'text',
      group_name TEXT DEFAULT 'general'
    )
  `).run();

  // Activity Log Table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Testimonials Table (NEW)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      designation TEXT NOT NULL,
      quote TEXT NOT NULL,
      avatar_seed TEXT DEFAULT NULL,
      display_order INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // URL Redirects Table (NEW)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS redirects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_path TEXT UNIQUE NOT NULL,
      to_url TEXT NOT NULL,
      status_code INTEGER DEFAULT 301,
      note TEXT DEFAULT NULL,
      hit_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Static / Legal Pages Table (NEW)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_title TEXT DEFAULT NULL,
      meta_description TEXT DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Media Library Table (NEW)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT DEFAULT NULL,
      size_bytes INTEGER DEFAULT 0,
      alt_text TEXT DEFAULT NULL,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `).run();
})();

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATIONS: Add columns to existing tables if they don't exist
// ─────────────────────────────────────────────────────────────────────────────
const addColumnIfMissing = (table, column, definition) => {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`[DB Migration] Added column: ${table}.${column}`);
  } catch (e) {
    // Column already exists — ignore the error
  }
};

addColumnIfMissing('blogs', 'cover_image_alt', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'allow_comments', 'INTEGER DEFAULT 1');
addColumnIfMissing('blogs', 'meta_title', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'meta_description', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'og_title', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'og_description', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'og_image', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'canonical_url', 'TEXT DEFAULT NULL');
addColumnIfMissing('blogs', 'scheduled_at', 'DATETIME DEFAULT NULL');
addColumnIfMissing('services', 'cta_url', 'TEXT DEFAULT NULL');
addColumnIfMissing('categories', 'display_order', 'INTEGER DEFAULT 0');
addColumnIfMissing('settings', 'group_name', "TEXT DEFAULT 'general'");

// ─────────────────────────────────────────────────────────────────────────────
// SEEDING DEFAULT DATA
// ─────────────────────────────────────────────────────────────────────────────
const seedDatabase = () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@scholarsedge.in';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Secure2024';

  // --- Users ---
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password, role, designation, bio, status, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const adminPassHash = bcrypt.hashSync(adminPassword, 12);
    insertUser.run('Admin Manager', adminEmail, adminPassHash, 'admin', 'Chief Academic Editor', 'Managing Director and Peer Review Board Lead at ScholarsEdge.', 'active', 1);
    const userPassHash = bcrypt.hashSync('Test@1234', 12);
    insertUser.run('Dr. Priya Sharma', 'priya@test.com', userPassHash, 'user', 'PhD Scholar, IIT Bombay', 'Researching machine learning applications in healthcare.', 'active', 1);
    console.log('[Seed] Users table seeded.');
  }

  // --- Categories ---
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (categoryCount === 0) {
    const insertCat = db.prepare(`INSERT INTO categories (name, slug, description, color, display_order) VALUES (?, ?, ?, ?, ?)`);
    insertCat.run('Research Methodology', 'research-methodology', 'Insights into qualitative, quantitative, and mixed research designs.', '#0d1b2a', 1);
    insertCat.run('Publication Tips', 'publication-tips', 'Guidelines for choosing journals, writing cover letters, and handling reviews.', '#c9a84c', 2);
    insertCat.run('PhD Journey', 'phd-journey', 'Surviving and thriving through thesis writing, defense, and research obstacles.', '#16a34a', 3);
    insertCat.run('Academic Writing', 'academic-writing', 'Grammar check, formatting styles (APA, IEEE, Harvard), and structure enhancements.', '#dc2626', 4);
    insertCat.run('Data Science', 'data-science', 'Statistical modeling, data analytics, software support (R, Python, SPSS).', '#d97706', 5);
    console.log('[Seed] Categories table seeded.');
  }

  // --- Services ---
  const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get().count;
  if (serviceCount === 0) {
    const insertService = db.prepare(`INSERT INTO services (title, description, icon, tag, cta_url, display_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insertService.run('PhD Thesis Writing', 'End-to-end guidance from research proposal design to final compilation and defense preparation with strict formatting compliance.', 'fa-graduation-cap', 'Premium', '/contact?service=PhD+Thesis+Writing', 1, 1);
    insertService.run('Scopus Publication', 'Strategic journal matching, manuscript styling, and response assistance to editorial reviews to secure fast Scopus indexing.', 'fa-book-open', 'Popular', '/contact?service=Scopus+Publication', 2, 1);
    insertService.run('SCI Journal Support', 'Comprehensive review and technical editing by subject-matter experts to meet high impact factor SCI standards.', 'fa-flask', 'Fast-Track', '/contact?service=SCI+Journal+Support', 3, 1);
    insertService.run('UGC Care Journals', 'Navigating regional listing standards and publishing in verified UGC-approved academic directories.', 'fa-certificate', null, '/contact?service=UGC+Care+Journals', 4, 1);
    insertService.run('Research Paper Writing', 'Structuring review and research articles, developing hypotheses, and drafting publication-ready scripts.', 'fa-pen-nib', 'Popular', '/contact?service=Research+Paper+Writing', 5, 1);
    insertService.run('Data Analysis & Modeling', 'Professional statistical computation utilizing R, SPSS, AMOS, and Python to back your research with empirical evidence.', 'fa-chart-line', 'Expert Support', '/contact?service=Data+Analysis', 6, 1);
    console.log('[Seed] Services table seeded.');
  }

  // --- Settings ---
  const settingCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
  if (settingCount === 0) {
    const s = db.prepare(`INSERT INTO settings (key, value, label, type, group_name) VALUES (?, ?, ?, ?, ?)`);
    // Brand
    s.run('site_name', 'ScholarsEdge', 'Site Name', 'text', 'brand');
    s.run('site_tagline', 'Empowering Researchers, Elevating Publications', 'Site Tagline', 'text', 'brand');
    s.run('meta_description', 'Premium academic research assistance and journal publication support. Specialized in Scopus, SCI, and UGC Care journals.', 'Default Meta Description', 'textarea', 'seo');
    s.run('default_meta_title', 'ScholarsEdge — Academic Research & Journal Publication Services', 'Default Meta Title', 'text', 'seo');
    // Contact
    s.run('contact_phone', '+91 98765 43210', 'Contact Phone', 'tel', 'contact');
    s.run('contact_email', 'support@scholarsedge.in', 'Contact Email', 'email', 'contact');
    s.run('contact_address', 'Level 4, Academic Plaza, IIT Bombay Road, Powai, Mumbai - 400076', 'Contact Address', 'textarea', 'contact');
    // Social
    s.run('facebook_url', 'https://facebook.com/scholarsedge', 'Facebook URL', 'url', 'social');
    s.run('twitter_url', 'https://twitter.com/scholarsedge', 'Twitter URL', 'url', 'social');
    s.run('linkedin_url', 'https://linkedin.com/company/scholarsedge', 'LinkedIn URL', 'url', 'social');
    s.run('whatsapp_number', '+919876543210', 'WhatsApp Number', 'text', 'social');
    // Stats (editable numbers)
    s.run('stats_publications_base', '1420', 'Publications Base Count', 'number', 'stats');
    s.run('stats_years_experience', '15', 'Years of Experience', 'number', 'stats');
    s.run('stats_success_rate', '98.4', 'Success Rate (%)', 'text', 'stats');
    s.run('stats_human_written', '100', 'Human Written % (0% AI)', 'number', 'stats');
    // Hero Section
    s.run('hero_heading', 'Accelerate Your <em>Academic Impact</em> with Expert Journal Care', 'Hero Heading (HTML allowed)', 'textarea', 'homepage');
    s.run('hero_subheading', 'ScholarsEdge provides end-to-end PhD thesis mentoring, strategic Scopus and SCI journal publications, and professional data analysis support. Work with veteran peer reviewers to secure acceptance.', 'Hero Subheading', 'textarea', 'homepage');
    s.run('hero_cta_primary_text', 'Explore Services', 'Hero CTA Primary Text', 'text', 'homepage');
    s.run('hero_cta_primary_url', '/services', 'Hero CTA Primary URL', 'text', 'homepage');
    s.run('hero_cta_secondary_text', 'Book Consultation', 'Hero CTA Secondary Text', 'text', 'homepage');
    s.run('hero_cta_secondary_url', '/contact', 'Hero CTA Secondary URL', 'text', 'homepage');
    // Footer
    s.run('footer_about_text', 'Premium peer-reviewed academic services empowering PhD candidates, university scholars, and medical researchers to successfully publish in Scopus, SCI, and UGC Care journals.', 'Footer About Text', 'textarea', 'footer');
    s.run('footer_copyright', '© 2026 ScholarsEdge. All academic rights reserved.', 'Footer Copyright', 'text', 'footer');
    // Editorial
    s.run('default_rejection_reason', 'Thank you for your submission. However, our editorial board has reviewed your draft and determined it requires further academic proofreading and structural adjustments before it can be published on the site. Please revise your manuscript and submit again.', 'Default Rejection Message', 'textarea', 'editorial');
    // Robots/SEO
    s.run('robots_disallow', '/admin\n/dashboard\n/auth', 'Robots.txt Disallow Paths (one per line)', 'textarea', 'seo');
    s.run('base_url', process.env.BASE_URL || 'https://scholoar-edge.vercel.app', 'Site Base URL (for sitemap)', 'url', 'seo');
    console.log('[Seed] Settings table seeded.');
  } else {
    // Insert any missing setting keys for existing deployments
    const insertIgnore = db.prepare(`INSERT OR IGNORE INTO settings (key, value, label, type, group_name) VALUES (?, ?, ?, ?, ?)`);
    insertIgnore.run('stats_publications_base', '1420', 'Publications Base Count', 'number', 'stats');
    insertIgnore.run('stats_years_experience', '15', 'Years of Experience', 'number', 'stats');
    insertIgnore.run('stats_success_rate', '98.4', 'Success Rate (%)', 'text', 'stats');
    insertIgnore.run('stats_human_written', '100', 'Human Written % (0% AI)', 'number', 'stats');
    insertIgnore.run('hero_heading', 'Accelerate Your <em>Academic Impact</em> with Expert Journal Care', 'Hero Heading', 'textarea', 'homepage');
    insertIgnore.run('hero_subheading', 'ScholarsEdge provides end-to-end PhD thesis mentoring, strategic Scopus and SCI journal publications, and professional data analysis support.', 'Hero Subheading', 'textarea', 'homepage');
    insertIgnore.run('hero_cta_primary_text', 'Explore Services', 'Hero CTA Primary Text', 'text', 'homepage');
    insertIgnore.run('hero_cta_primary_url', '/services', 'Hero CTA Primary URL', 'text', 'homepage');
    insertIgnore.run('hero_cta_secondary_text', 'Book Consultation', 'Hero CTA Secondary Text', 'text', 'homepage');
    insertIgnore.run('hero_cta_secondary_url', '/contact', 'Hero CTA Secondary URL', 'text', 'homepage');
    insertIgnore.run('footer_about_text', 'Premium peer-reviewed academic services empowering PhD candidates, university scholars, and medical researchers to successfully publish in Scopus, SCI, and UGC Care journals.', 'Footer About Text', 'textarea', 'footer');
    insertIgnore.run('footer_copyright', '© 2026 ScholarsEdge. All academic rights reserved.', 'Footer Copyright', 'text', 'footer');
    insertIgnore.run('default_meta_title', 'ScholarsEdge — Academic Research & Journal Publication Services', 'Default Meta Title', 'text', 'seo');
    insertIgnore.run('robots_disallow', '/admin\n/dashboard\n/auth', 'Robots.txt Disallow Paths', 'textarea', 'seo');
    insertIgnore.run('base_url', process.env.BASE_URL || 'https://scholoar-edge.vercel.app', 'Site Base URL', 'url', 'seo');
  }

  // --- Blogs ---
  const blogCount = db.prepare('SELECT COUNT(*) as count FROM blogs').get().count;
  if (blogCount === 0) {
    const adminId = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()?.id || 1;
    const userId = db.prepare("SELECT id FROM users WHERE role = 'user' LIMIT 1").get()?.id || 2;
    const catPubTips = db.prepare("SELECT id FROM categories WHERE slug = 'publication-tips' LIMIT 1").get()?.id;
    const catJourney = db.prepare("SELECT id FROM categories WHERE slug = 'phd-journey' LIMIT 1").get()?.id;
    const catWriting = db.prepare("SELECT id FROM categories WHERE slug = 'academic-writing' LIMIT 1").get()?.id;
    const catData = db.prepare("SELECT id FROM categories WHERE slug = 'data-science' LIMIT 1").get()?.id;

    const insertBlog = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, status, views, reading_time, featured, published_at, meta_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `);
    insertBlog.run(adminId, catPubTips, 'How to Write a Scopus-Worthy Research Paper in 2024', 'how-to-write-a-scopus-worthy-research-paper-in-2024', 'Learn the essential steps to draft an academic paper that meets Scopus standards, focusing on research structure, journal selection, and addressing reviewer queries.', '<p>Securing a publication in a <strong>Scopus-indexed journal</strong> is a major milestone for any researcher. In this article, we outline the exact step-by-step roadmap to elevate your research. We discuss key points such as framing research questions, outlining the introduction, detailing the methodology, and preparing logical discussions of empirical results.</p><h2>1. Focus on Novelty</h2><p>Journals reject 80% of submissions due to a lack of originality. Make sure you highlight your work\'s distinct contribution in your abstract and introduction.</p><h2>2. Follow the IMRAD Structure</h2><p>Structure your paper clearly: Introduction, Methods, Results, And Discussion. Each section has a specific purpose that must be respected.</p>', 'published', 142, 5, 1, 'Step-by-step guide to writing a Scopus-worthy research paper: novelty, IMRAD structure, journal selection, and addressing reviewer queries in 2024.');
    insertBlog.run(adminId, catJourney, 'Common PhD Thesis Mistakes and How to Avoid Them', 'common-phd-thesis-mistakes-and-how-to-avoid-them', 'Discover critical formatting, structuring, and scoping mistakes PhD candidates make during thesis writing, and strategies to prevent them.', '<p>A PhD thesis is the culmination of years of hard work, yet many candidates make preventable structural and procedural errors. In this post, we discuss how to manage review cycles, align the literature review with empirical outcomes, and manage references without errors.</p><h2>1. Inconsistent Citation Style</h2><p>Ensure that you stick to one style (APA, IEEE, etc.) throughout your thesis. Use referencing software like Mendeley or Zotero.</p>', 'published', 89, 4, 0, 'Avoid these critical PhD thesis mistakes: inconsistent citations, poor structure, missed deadlines, and misaligned literature reviews. Expert guidance from ScholarsEdge.');
    insertBlog.run(adminId, catWriting, 'Understanding Plagiarism Thresholds in Top Journals', 'understanding-plagiarism-thresholds-in-top-journals', 'A deep dive into Turnitin metrics, similarity indexes, and how top publishers like Elsevier, Springer, and IEEE handle text overlapping.', '<p>What is a safe similarity index? Most top journals require similarity to be under 15% overall, and under 1% from any single source. Learn how paraphrasing, block quoting, and proper citations reduce plagiarism risks.</p>', 'published', 215, 6, 0, 'Understanding plagiarism thresholds at Elsevier, Springer, and IEEE: Turnitin similarity indexes, acceptable limits, and how to reduce text overlap in academic papers.');

    const insertPending = db.prepare(`INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, status, views, reading_time, featured) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0)`);
    insertPending.run(userId, catPubTips, 'My Journey from Research Paper to Scopus Publication', 'my-journey-from-research-paper-to-scopus-publication', 'A personal narrative on writing, formatting, submitting, and revising a paper until it was indexed in Scopus.', '<p>This article chronicles the real struggle and revisions needed to satisfy reviewers for a Scopus Q1 journal. From initial rejection to major revisions and final acceptance, read the insights from a PhD student.</p>', 0, 5);
    insertPending.run(userId, catData, 'Statistical Methods for Beginners: SPSS vs R', 'statistical-methods-for-beginners-spss-vs-r', 'An introductory guide comparing SPSS and R programming for basic research analytics, listing pros, cons, and learning curves.', '<p>Deciding between SPSS and R is critical for early-career researchers. While SPSS offers a visual menu interface, R provides superior flexibility and vector charting capabilities. This guide will help you choose.</p>', 0, 7);
    console.log('[Seed] Blogs table seeded.');
  }

  // --- Contacts ---
  const contactCount = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
  if (contactCount === 0) {
    const c = db.prepare(`INSERT INTO contacts (name, email, phone, service, message, status) VALUES (?, ?, ?, ?, ?, ?)`);
    c.run('Prof. Rajesh Kumar', 'rajesh.kumar@university.edu', '+91 9988776655', 'SCI Journal Support', 'Hello, I have a draft manuscript on neural networks that I want to target for an SCI journal. I need help formatting and selecting suitable journals. Please contact me.', 'unread');
    c.run('Ananya Sen', 'ananya.sen@outlook.com', '+91 8877665544', 'PhD Thesis Writing', 'I need thesis support for my upcoming research submission in management studies. Can we schedule a brief call next week to discuss rates and timeline?', 'unread');
    c.run('Dr. Keith Carter', 'kcarter@scienceinst.org', '+1 555-0199', 'Data Analysis & Modeling', 'I need complex statistical modeling (structural equation modeling) done for a medical trial study in R. Do you have experts in AMOS/R available?', 'unread');
    console.log('[Seed] Contacts table seeded.');
  }

  // --- Newsletter Subscribers ---
  const newsletterCount = db.prepare('SELECT COUNT(*) as count FROM newsletter').get().count;
  if (newsletterCount === 0) {
    const n = db.prepare(`INSERT INTO newsletter (email, active) VALUES (?, 1)`);
    n.run('researcher1@gmail.com');
    n.run('scholar_hub@yahoo.com');
    n.run('p.chatterjee@academy.org');
    n.run('mary.watson@mit.edu');
    n.run('j.smith@cambridge.edu');
    console.log('[Seed] Newsletter table seeded.');
  }

  // --- Testimonials ---
  const testimonialCount = db.prepare('SELECT COUNT(*) as count FROM testimonials').get().count;
  if (testimonialCount === 0) {
    const t = db.prepare(`INSERT INTO testimonials (name, designation, quote, avatar_seed, display_order, featured, active) VALUES (?, ?, ?, ?, ?, ?, 1)`);
    t.run('Dr. Priya Sharma', 'Assistant Professor, IIT Bombay', 'The editorial team at ScholarsEdge was exceptional. They helped me clean up my methodology section and matched my paper with a Q2 Elsevier journal. It got accepted within 4 months!', 'Priya', 1, 0);
    t.run('Dr. Sanjay Nair', 'PhD Graduate, IISc Bangalore', 'I was struggling to write my thesis proposal. ScholarsEdge experts gave me structured feedback that transformed my literature review. Highly recommended for PhD candidates.', 'Sanjay', 2, 1);
    t.run('Dr. Rebecca Scott', 'Medical Researcher, University of Delhi', 'Their statistical data analysis services saved me weeks of coding in R. The regression models and structural equation modeling (SEM) they built were directly accepted by the reviewers.', 'Rebecca', 3, 0);
    console.log('[Seed] Testimonials table seeded.');
  }

  // --- Legal Pages ---
  const pageCount = db.prepare('SELECT COUNT(*) as count FROM pages').get().count;
  if (pageCount === 0) {
    const p = db.prepare(`INSERT INTO pages (slug, title, content, meta_title, meta_description) VALUES (?, ?, ?, ?, ?)`);
    p.run('privacy-policy', 'Privacy Policy', `<h2>Privacy Policy</h2>
<p><strong>Last Updated:</strong> January 2026</p>
<p>ScholarsEdge ("we," "our," or "us") is committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, and safeguard your information.</p>

<h3>1. Information We Collect</h3>
<p>We collect information you provide directly to us, such as when you fill out a contact form, register an account, or subscribe to our newsletter. This includes your name, email address, phone number, and any message content you submit.</p>

<h3>2. How We Use Your Information</h3>
<ul>
<li>To respond to your enquiries and provide academic consultation services</li>
<li>To send our research digest newsletter (only if subscribed)</li>
<li>To improve our website services and user experience</li>
<li>To comply with legal obligations</li>
</ul>

<h3>3. Information Sharing</h3>
<p>We do not sell, trade, or rent your personal information to third parties. We may share your information with trusted service providers who assist us in operating our website and delivering services, subject to strict confidentiality agreements.</p>

<h3>4. Data Retention</h3>
<p>We retain your personal data only as long as necessary to fulfil the purposes outlined in this policy, or as required by law.</p>

<h3>5. Your Rights</h3>
<p>You have the right to access, correct, or delete your personal data at any time. Contact us at <a href="mailto:support@scholarsedge.in">support@scholarsedge.in</a> to exercise these rights.</p>

<h3>6. Cookies</h3>
<p>We use essential cookies for authentication and security (CSRF protection). We do not use advertising or tracking cookies.</p>

<h3>7. Contact Us</h3>
<p>For privacy-related questions, contact us at: <strong>support@scholarsedge.in</strong></p>`, 'Privacy Policy — ScholarsEdge', 'Read the ScholarsEdge Privacy Policy to understand how we collect, use, and protect your personal information.');

    p.run('terms-conditions', 'Terms & Conditions', `<h2>Terms & Conditions</h2>
<p><strong>Last Updated:</strong> January 2026</p>
<p>By accessing and using the ScholarsEdge website and services, you accept and agree to be bound by the following terms and conditions.</p>

<h3>1. Services</h3>
<p>ScholarsEdge provides academic research consulting, journal publication guidance, thesis writing support, and data analysis services. All services are provided for legitimate academic and research purposes.</p>

<h3>2. Intellectual Property</h3>
<p>All content on this website, including text, graphics, and logos, is the property of ScholarsEdge and protected by applicable copyright laws. You may not reproduce or distribute any content without prior written permission.</p>

<h3>3. Academic Integrity</h3>
<p>Our services are designed to assist and guide academic work. Clients are responsible for ensuring their use of our services complies with their institution's academic integrity policies. We strictly oppose any form of academic fraud or misrepresentation.</p>

<h3>4. Limitation of Liability</h3>
<p>ScholarsEdge shall not be liable for any indirect, incidental, or consequential damages arising from the use of our services. We do not guarantee publication acceptance, as final decisions rest with journal editors.</p>

<h3>5. Governing Law</h3>
<p>These terms are governed by the laws of India. Any disputes shall be subject to the jurisdiction of courts in Mumbai, Maharashtra.</p>

<h3>6. Changes to Terms</h3>
<p>We reserve the right to modify these terms at any time. Continued use of our services after changes constitutes acceptance of the revised terms.</p>

<h3>7. Contact</h3>
<p>For questions regarding these terms, email: <strong>support@scholarsedge.in</strong></p>`, 'Terms & Conditions — ScholarsEdge', 'Read the ScholarsEdge Terms and Conditions governing the use of our academic research and journal publication services.');

    p.run('editorial-guidelines', 'Editorial Guidelines', `<h2>Editorial Guidelines</h2>
<p><strong>Last Updated:</strong> January 2026</p>
<p>ScholarsEdge maintains the highest standards of academic integrity and publication ethics. The following guidelines govern all content published on our platform and the services we provide.</p>

<h3>1. Publication Ethics</h3>
<p>We adhere to the principles established by the Committee on Publication Ethics (COPE). All manuscripts are reviewed for originality, ethical compliance, and scientific merit before publication or submission.</p>

<h3>2. Originality & Plagiarism</h3>
<p>All submitted manuscripts must be original work. We use industry-standard plagiarism detection tools. We require a similarity index of less than 15% overall and less than 1% from any single source. Any detected plagiarism will result in immediate rejection.</p>

<h3>3. AI-Generated Content Policy</h3>
<p>ScholarsEdge maintains a strict 0% AI-generated content policy. All content produced through our services is written by qualified human experts — academic editors, subject matter specialists, and peer reviewers.</p>

<h3>4. Authorship</h3>
<p>All listed authors must have made a substantial contribution to the research. Ghost authorship and gift authorship are not supported or condoned by ScholarsEdge.</p>

<h3>5. Peer Review Process</h3>
<p>Our internal pre-review follows a double-blind format where appropriate. External journal submissions are guided to venues with rigorous peer review processes.</p>

<h3>6. Data Integrity</h3>
<p>Research data must be accurately represented. We do not manipulate, falsify, or fabricate data. Statistical analyses are conducted transparently with all assumptions clearly stated.</p>

<h3>7. Conflicts of Interest</h3>
<p>All potential conflicts of interest must be disclosed. Our editorial team maintains independence from financial or personal interests that could influence assessment.</p>

<h3>8. Corrections & Retractions</h3>
<p>If errors are discovered post-publication, we will issue corrections promptly. Serious ethical violations may result in retraction with full documentation.</p>

<h3>9. Contact the Editorial Board</h3>
<p>For editorial concerns, contact: <strong>editorial@scholarsedge.in</strong></p>`, 'Editorial Guidelines — ScholarsEdge', 'ScholarsEdge editorial guidelines covering publication ethics, plagiarism policy, AI content policy, peer review, and academic integrity standards.');
    console.log('[Seed] Legal pages seeded.');
  }
};

// Auto run seeding on import
try {
  seedDatabase();
} catch (err) {
  console.error('[DB] Error seeding database:', err);
}

module.exports = db;
