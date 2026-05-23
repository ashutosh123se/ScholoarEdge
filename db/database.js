const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Database file path
const dbPath = path.join(__dirname, '../scholarsedge.db');
const db = new Database(dbPath, { verbose: null });

// Enable foreign keys support in SQLite
db.pragma('foreign_keys = ON');

// Create Tables in a transaction
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
      color TEXT DEFAULT '#c9a84c'
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
      tags TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      rejection_reason TEXT DEFAULT NULL,
      views INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
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
      type TEXT DEFAULT 'text'
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
})();

// Seeding Default Data
const seedDatabase = () => {
  // Load variables from process.env (assuming dotenv is configured in server.js or env is loaded)
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@scholarsedge.in';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Secure2024';

  // Seed Users
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password, role, designation, bio, status, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Admin User
    const adminPassHash = bcrypt.hashSync(adminPassword, 12);
    insertUser.run('Admin Manager', adminEmail, adminPassHash, 'admin', 'Chief Academic Editor', 'Managing Director and Peer Review Board Lead at ScholarsEdge.', 'active', 1);

    // Test User
    const userPassHash = bcrypt.hashSync('Test@1234', 12);
    insertUser.run('Dr. Priya Sharma', 'priya@test.com', userPassHash, 'user', 'PhD Scholar, IIT Bombay', 'Researching machine learning applications in healthcare.', 'active', 1);
    
    console.log('Seeded users table.');
  }

  // Seed Categories
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (categoryCount === 0) {
    const insertCat = db.prepare(`
      INSERT INTO categories (name, slug, description, color)
      VALUES (?, ?, ?, ?)
    `);

    insertCat.run('Research Methodology', 'research-methodology', 'Insights into qualitative, quantitative, and mixed research designs.', '#0d1b2a');
    insertCat.run('Publication Tips', 'publication-tips', 'Guidelines for choosing journals, writing cover letters, and handling reviews.', '#c9a84c');
    insertCat.run('PhD Journey', 'phd-journey', 'Surviving and thriving through thesis writing, defense, and research obstacles.', '#16a34a');
    insertCat.run('Academic Writing', 'academic-writing', 'Grammar check, formatting styles (APA, IEEE, Harvard), and structure enhancements.', '#dc2626');
    insertCat.run('Data Science', 'data-science', 'Statistical modeling, data analytics, software support (R, Python, SPSS).', '#d97706');
    
    console.log('Seeded categories table.');
  }

  // Seed Services
  const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get().count;
  if (serviceCount === 0) {
    const insertService = db.prepare(`
      INSERT INTO services (title, description, icon, tag, display_order, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertService.run('PhD Thesis Writing', 'End-to-end guidance from research proposal design to final compilation and defense preparation with strict formatting compliance.', 'fa-graduation-cap', 'Premium', 1, 1);
    insertService.run('Scopus Publication', 'Strategic journal matching, manuscript styling, and response assistance to editorial reviews to secure fast Scopus indexing.', 'fa-book-open', 'Popular', 2, 1);
    insertService.run('SCI Journal Support', 'Comprehensive review and technical editing by subject-matter experts to meet high impact factor SCI standards.', 'fa-flask', 'Fast-Track', 3, 1);
    insertService.run('UGC Care Journals', 'Navigating regional listing standards and publishing in verified UGC-approved academic directories.', 'fa-certificate', null, 4, 1);
    insertService.run('Research Paper Writing', 'Structuring review and research articles, developing hypotheses, and drafting publication-ready scripts.', 'fa-pen-nib', 'Popular', 5, 1);
    insertService.run('Data Analysis & Modeling', 'Professional statistical computation utilizing R, SPSS, AMOS, and Python to back your research with empirical evidence.', 'fa-chart-line', 'Expert Support', 6, 1);

    console.log('Seeded services table.');
  }

  // Seed Site Settings
  const settingCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
  if (settingCount === 0) {
    const insertSetting = db.prepare(`
      INSERT INTO settings (key, value, label, type)
      VALUES (?, ?, ?, ?)
    `);

    insertSetting.run('site_name', 'ScholarsEdge', 'Site Name', 'text');
    insertSetting.run('site_tagline', 'Empowering Researchers, Elevating Publications', 'Site Tagline', 'text');
    insertSetting.run('contact_phone', '+91 98765 43210', 'Contact Phone', 'tel');
    insertSetting.run('contact_email', 'support@scholarsedge.in', 'Contact Email', 'email');
    insertSetting.run('contact_address', 'Level 4, Academic Plaza, IIT Bombay Road, Powai, Mumbai - 400076', 'Contact Address', 'textarea');
    insertSetting.run('meta_description', 'Premium academic research assistance and journal publication support. Specialized in Scopus, SCI, and UGC Care journals.', 'Meta Description', 'textarea');
    insertSetting.run('facebook_url', 'https://facebook.com/scholarsedge', 'Facebook URL', 'url');
    insertSetting.run('twitter_url', 'https://twitter.com/scholarsedge', 'Twitter URL', 'url');
    insertSetting.run('linkedin_url', 'https://linkedin.com/company/scholarsedge', 'LinkedIn URL', 'url');
    insertSetting.run('whatsapp_number', '+919876543210', 'WhatsApp Number', 'text');
    insertSetting.run('default_rejection_reason', 'Thank you for your submission. However, our editorial board has reviewed your draft and determined it requires further academic proofreading and structural adjustments before it can be published on the site. Please revise your manuscript and submit again.', 'Default Rejection Message', 'textarea');

    console.log('Seeded settings table.');
  }

  // Seed Blogs (sample data)
  const blogCount = db.prepare('SELECT COUNT(*) as count FROM blogs').get().count;
  if (blogCount === 0) {
    // Get user IDs
    const adminId = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()?.id || 1;
    const userId = db.prepare("SELECT id FROM users WHERE role = 'user' LIMIT 1").get()?.id || 2;

    // Get category IDs
    const catPubTips = db.prepare("SELECT id FROM categories WHERE slug = 'publication-tips' LIMIT 1").get()?.id;
    const catJourney = db.prepare("SELECT id FROM categories WHERE slug = 'phd-journey' LIMIT 1").get()?.id;
    const catWriting = db.prepare("SELECT id FROM categories WHERE slug = 'academic-writing' LIMIT 1").get()?.id;
    const catData = db.prepare("SELECT id FROM categories WHERE slug = 'data-science' LIMIT 1").get()?.id;

    const insertBlog = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, status, views, reading_time, featured, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Sample Published Blogs
    insertBlog.run(
      adminId,
      catPubTips,
      'How to Write a Scopus-Worthy Research Paper in 2024',
      'how-to-write-a-scopus-worthy-research-paper-in-2024',
      'Learn the essential steps to draft an academic paper that meets Scopus standards, focusing on research structure, journal selection, and addressing reviewer queries.',
      '<p>Securing a publication in a <strong>Scopus-indexed journal</strong> is a major milestone for any researcher. In this article, we outline the exact step-by-step roadmap to elevate your research. We discuss key points such as framing research questions, outlining the introduction, detailing the methodology, and preparing logical discussions of empirical results.</p><h2>1. Focus on Novelty</h2><p>Journals reject 80% of submissions due to a lack of originality. Make sure you highlight your work\'s distinct contribution in your abstract and introduction.</p><h2>2. Follow the IMRAD Structure</h2><p>Structure your paper clearly: Introduction, Methods, Results, And Discussion. Each section has a specific purpose that must be respected.</p>',
      'published',
      142,
      5,
      1
    );

    insertBlog.run(
      adminId,
      catJourney,
      'Common PhD Thesis Mistakes and How to Avoid Them',
      'common-phd-thesis-mistakes-and-how-to-avoid-them',
      'Discover critical formatting, structuring, and scoping mistakes PhD candidates make during thesis writing, and strategies to prevent them.',
      '<p>A PhD thesis is the culmination of years of hard work, yet many candidates make preventable structural and procedural errors. In this post, we discuss how to manage review cycles, align the literature review with empirical outcomes, and manage references without errors.</p><h2>1. Inconsistent Citation Style</h2><p>Ensure that you stick to one style (APA, IEEE, etc.) throughout your thesis. Use referencing software like Mendeley or Zotero.</p>',
      'published',
      89,
      4,
      0
    );

    insertBlog.run(
      adminId,
      catWriting,
      'Understanding Plagiarism Thresholds in Top Journals',
      'understanding-plagiarism-thresholds-in-top-journals',
      'A deep dive into Turnitin metrics, similarity indexes, and how top publishers like Elsevier, Springer, and IEEE handle text overlapping.',
      '<p>What is a safe similarity index? Most top journals require similarity to be under 15% overall, and under 1% from any single source. Learn how to paraphrasing, block quoting, and proper citations reduce plagiarism risks.</p>',
      'published',
      215,
      6,
      0
    );

    // Sample Pending Blogs (by test user Priya)
    const insertPendingBlog = db.prepare(`
      INSERT INTO blogs (user_id, category_id, title, slug, excerpt, content, status, views, reading_time, featured)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0)
    `);

    insertPendingBlog.run(
      userId,
      catPubTips,
      'My Journey from Research Paper to Scopus Publication',
      'my-journey-from-research-paper-to-scopus-publication',
      'A personal narrative on writing, formatting, submitting, and revising a paper until it was indexed in Scopus.',
      '<p>This article chronicles the real struggle and revisions needed to satisfy reviewers for a Scopus Q1 journal. From initial rejection to major revisions and final acceptance, read the insights from a PhD student.</p>',
      0,
      5
    );

    insertPendingBlog.run(
      userId,
      catData,
      'Statistical Methods for Beginners: SPSS vs R',
      'statistical-methods-for-beginners-spss-vs-r',
      'An introductory guide comparing SPSS and R programming for basic research analytics, listing pros, cons, and learning curves.',
      '<p>Deciding between SPSS and R is critical for early-career researchers. While SPSS offers a visual menu interface, R provides superior flexibility and vector charting capabilities. This guide will help you choose.</p>',
      0,
      7
    );

    console.log('Seeded blogs table.');
  }

  // Seed Contacts (sample data)
  const contactCount = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
  if (contactCount === 0) {
    const insertContact = db.prepare(`
      INSERT INTO contacts (name, email, phone, service, message, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertContact.run('Prof. Rajesh Kumar', 'rajesh.kumar@university.edu', '+91 9988776655', 'SCI Journal Support', 'Hello, I have a draft manuscript on neural networks that I want to target for an SCI journal. I need help formatting and selecting suitable journals. Please contact me.', 'unread');
    insertContact.run('Ananya Sen', 'ananya.sen@outlook.com', '+91 8877665544', 'PhD Thesis Writing', 'I need thesis support for my upcoming research submission in management studies. Can we schedule a brief call next week to discuss rates and timeline?', 'unread');
    insertContact.run('Dr. Keith Carter', 'kcarter@scienceinst.org', '+1 555-0199', 'Data Analysis & Modeling', 'I need complex statistical modeling (structural equation modeling) done for a medical trial study in R. Do you have experts in AMOS/R available?', 'unread');
    
    console.log('Seeded contacts table.');
  }

  // Seed Newsletter Subscribers
  const newsletterCount = db.prepare('SELECT COUNT(*) as count FROM newsletter').get().count;
  if (newsletterCount === 0) {
    const insertSubscriber = db.prepare(`
      INSERT INTO newsletter (email, active)
      VALUES (?, 1)
    `);

    insertSubscriber.run('researcher1@gmail.com');
    insertSubscriber.run('scholar_hub@yahoo.com');
    insertSubscriber.run('p.chatterjee@academy.org');
    insertSubscriber.run('mary.watson@mit.edu');
    insertSubscriber.run('j.smith@cambridge.edu');

    console.log('Seeded newsletter table.');
  }
};

// Auto run seeding on import
try {
  seedDatabase();
} catch (err) {
  console.error('Error seeding database:', err);
}

module.exports = db;
