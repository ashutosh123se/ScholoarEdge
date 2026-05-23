const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Apply admin locks on all routes
router.use(requireAuth);
router.use(requireAdmin);

// Helper to log administrative actions with IP address
const logAdminAction = (req, action, targetType, targetId, details) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const fullDetails = `${details} | IP: ${ip}`;
  db.prepare(`
    INSERT INTO activity_log (user_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, action, targetType, targetId, fullDetails);
};

// GET /admin - Dashboard Overview
router.get('/', (req, res) => {
  try {
    // 1. Fetch count stats
    const total_users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const total_blogs = db.prepare('SELECT COUNT(*) as count FROM blogs').get().count;
    const published_blogs = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'published'").get().count;
    const pending_blogs = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'pending'").get().count;
    const total_views = db.prepare('SELECT SUM(views) as count FROM blogs').get().count || 0;
    const total_contacts = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
    const unread_contacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'unread'").get().count;

    // 2. Fetch chart data: blogs published per month (last 12 months)
    // We will generate the last 12 months array on the server to fill missing entries
    const blogsPerMonth = db.prepare(`
      SELECT strftime('%Y-%m', published_at) as month, COUNT(*) as count 
      FROM blogs 
      WHERE status = 'published' AND published_at >= date('now', '-12 months')
      GROUP BY month 
      ORDER BY month ASC
    `).all();

    // 3. Fetch chart data: registrations per month (last 6 months)
    const registrationsPerMonth = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count 
      FROM users 
      WHERE created_at >= date('now', '-6 months')
      GROUP BY month 
      ORDER BY month ASC
    `).all();

    // Formulate clean JSON data for frontend Chart.js charts
    const chartBlogs = { labels: [], data: [] };
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mStr = d.toISOString().slice(0, 7); // "YYYY-MM"
      const found = blogsPerMonth.find(x => x.month === mStr);
      
      // Formatting label for view (e.g. "Jun 2024")
      const formattedLabel = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      chartBlogs.labels.push(formattedLabel);
      chartBlogs.data.push(found ? found.count : 0);
    }

    const chartUsers = { labels: [], data: [] };
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mStr = d.toISOString().slice(0, 7);
      const found = registrationsPerMonth.find(x => x.month === mStr);
      
      const formattedLabel = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      chartUsers.labels.push(formattedLabel);
      chartUsers.data.push(found ? found.count : 0);
    }

    // 4. Fetch list stats
    const recent_contacts = db.prepare(`
      SELECT * FROM contacts 
      ORDER BY CASE WHEN status = 'unread' THEN 0 ELSE 1 END, created_at DESC 
      LIMIT 5
    `).all();

    const recent_blogs = db.prepare(`
      SELECT b.*, u.name as author_name 
      FROM blogs b 
      JOIN users u ON b.user_id = u.id 
      WHERE b.status = 'pending' 
      ORDER BY b.updated_at DESC 
      LIMIT 5
    `).all();

    const recent_users = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5').all();

    const activity_log = db.prepare(`
      SELECT a.*, u.name as user_name 
      FROM activity_log a 
      LEFT JOIN users u ON a.user_id = u.id 
      ORDER BY a.created_at DESC 
      LIMIT 10
    `).all();

    res.render('admin/dashboard', {
      title: 'Admin Panel',
      counts: {
        total_users,
        total_blogs,
        published_blogs,
        pending_blogs,
        total_views,
        total_contacts,
        unread_contacts
      },
      charts: {
        blogs: chartBlogs,
        users: chartUsers
      },
      recent_contacts,
      recent_blogs,
      recent_users,
      activity_log,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error. Unable to load Admin Dashboard.');
  }
});

// GET /admin/users - Users Management
router.get('/users', (req, res) => {
  try {
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
    let dataQuery = `
      SELECT u.*, (SELECT COUNT(*) FROM blogs b WHERE b.user_id = u.id) as blog_count
      FROM users u 
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      countQuery += ' AND (name LIKE ? OR email LIKE ?)';
      dataQuery += ' AND (u.name LIKE ? OR u.email LIKE ?)';
      const likeParam = `%${search}%`;
      params.push(likeParam, likeParam);
    }

    if (role) {
      countQuery += ' AND role = ?';
      dataQuery += ' AND u.role = ?';
      params.push(role);
    }

    if (status) {
      countQuery += ' AND status = ?';
      dataQuery += ' AND u.status = ?';
      params.push(status);
    }

    const totalUsers = db.prepare(countQuery).get(params).count;
    const totalPages = Math.ceil(totalUsers / limit) || 1;

    dataQuery += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    const queryParams = [...params, limit, offset];
    const users = db.prepare(dataQuery).all(queryParams);

    res.render('admin/users', {
      title: 'Manage Users',
      users,
      filters: { search, role, status, page, totalPages },
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to query users database.');
  }
});

// GET /admin/users/:id - User Detail
router.get('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      res.cookie('flash_error', 'User not found.', { maxAge: 5000 });
      return res.redirect('/admin/users');
    }

    const blogs = db.prepare(`
      SELECT b.*, c.name as category_name 
      FROM blogs b 
      LEFT JOIN categories c ON b.category_id = c.id 
      WHERE b.user_id = ? 
      ORDER BY b.created_at DESC
    `).all(userId);

    const comments = db.prepare(`
      SELECT c.*, b.title as blog_title, b.slug as blog_slug 
      FROM comments c 
      JOIN blogs b ON c.blog_id = b.id 
      WHERE c.user_id = ? 
      ORDER BY c.created_at DESC
    `).all(userId);

    const timeline = db.prepare(`
      SELECT * FROM activity_log 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 15
    `).all(userId);

    res.render('admin/user-detail', {
      title: `User Detail - ${user.name}`,
      profileUser: user,
      blogs,
      comments,
      timeline,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read user details.');
  }
});

// POST /admin/users/:id/toggle-status - Block/Unblock
router.post('/users/:id/toggle-status', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const selfId = req.user.id;

    if (targetId === selfId) {
      res.cookie('flash_error', 'You cannot ban or suspend yourself!', { maxAge: 5000 });
      return res.redirect('back');
    }

    const user = db.prepare('SELECT status, name FROM users WHERE id = ?').get(targetId);
    if (!user) {
      res.cookie('flash_error', 'User not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const newStatus = user.status === 'active' ? 'banned' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, targetId);

    // Log administrative action
    logAdminAction(req, 'Toggle User Status', 'user', targetId, `Toggled status of user "${user.name}" to "${newStatus}"`);

    res.cookie('flash_success', `User status successfully changed to ${newStatus}.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to toggle status.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/users/:id/change-role - Swap role User <-> Admin
router.post('/users/:id/change-role', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const selfId = req.user.id;

    if (targetId === selfId) {
      res.cookie('flash_error', 'You cannot change your own role!', { maxAge: 5000 });
      return res.redirect('back');
    }

    const user = db.prepare('SELECT role, name FROM users WHERE id = ?').get(targetId);
    if (!user) {
      res.cookie('flash_error', 'User not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const newRole = user.role === 'admin' ? 'user' : 'admin';
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetId);

    logAdminAction(req, 'Change User Role', 'user', targetId, `Changed role of user "${user.name}" to "${newRole}"`);

    res.cookie('flash_success', `User role updated to ${newRole}.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to alter user role.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/users/:id/delete - Delete User Cascade
router.post('/users/:id/delete', (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const selfId = req.user.id;

    if (targetId === selfId) {
      res.cookie('flash_error', 'You cannot delete yourself!', { maxAge: 5000 });
      return res.redirect('back');
    }

    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
    if (!user) {
      res.cookie('flash_error', 'User not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    logAdminAction(req, 'Delete User', 'user', targetId, `Deleted user account "${user.name}"`);

    res.cookie('flash_success', `User ${user.name} has been deleted successfully.`, { maxAge: 5000 });
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete user account.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /admin/blogs - Blogs Review Queue
router.get('/blogs', (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const category = req.query.category || '';
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    let countQuery = `
      SELECT COUNT(*) as count 
      FROM blogs b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE 1=1
    `;
    let dataQuery = `
      SELECT b.*, u.name as author_name, c.name as category_name
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (status !== 'all') {
      countQuery += ' AND b.status = ?';
      dataQuery += ' AND b.status = ?';
      params.push(status);
    }

    if (category) {
      countQuery += ' AND c.slug = ?';
      dataQuery += ' AND c.slug = ?';
      params.push(category);
    }

    if (search) {
      countQuery += ' AND (b.title LIKE ? OR u.name LIKE ?)';
      dataQuery += ' AND (b.title LIKE ? OR u.name LIKE ?)';
      const likeParam = `%${search}%`;
      params.push(likeParam, likeParam);
    }

    const totalBlogs = db.prepare(countQuery).get(params).count;
    const totalPages = Math.ceil(totalBlogs / limit) || 1;

    dataQuery += ' ORDER BY b.updated_at DESC LIMIT ? OFFSET ?';
    const queryParams = [...params, limit, offset];
    const blogs = db.prepare(dataQuery).all(queryParams);

    const categories = db.prepare('SELECT id, name, slug FROM categories').all();

    // Get count of pending blogs for the badge count
    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'pending'").get().count;

    // Get count of pending comments for comments tab badge
    const pendingCommentsCount = db.prepare("SELECT COUNT(*) as count FROM comments WHERE status = 'pending'").get().count;

    res.render('admin/blogs', {
      title: 'Manage Blogs',
      blogs,
      categories,
      pendingCount,
      pendingCommentsCount,
      filters: { status, category, search, page, totalPages },
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to query blogs review queue.');
  }
});

// GET /admin/blogs/:id - Preview blog and review details
router.get('/blogs/:id', (req, res) => {
  try {
    const blogId = req.params.id;
    const blog = db.prepare(`
      SELECT b.*, u.name as author_name, u.avatar as author_avatar, u.designation as author_designation, c.name as category_name
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.id = ?
    `).get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('/admin/blogs');
    }

    const comments = db.prepare(`
      SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.blog_id = ?
      ORDER BY c.created_at ASC
    `).all(blogId);

    res.render('admin/blog-detail', {
      title: `Review - ${blog.title}`,
      blog,
      comments,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read article details.');
  }
});

// POST /admin/blogs/:id/approve - Approve Pending Blog
router.post('/blogs/:id/approve', (req, res) => {
  try {
    const blogId = req.params.id;
    const blog = db.prepare('SELECT title FROM blogs WHERE id = ?').get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('/admin/blogs');
    }

    db.prepare("UPDATE blogs SET status = 'published', published_at = datetime('now') WHERE id = ?").run(blogId);

    logAdminAction(req, 'Approve Blog', 'blog', blogId, `Approved blog post "${blog.title}"`);

    res.cookie('flash_success', 'Blog successfully accepted and published online!', { maxAge: 5000 });
    res.redirect('/admin/blogs?status=published');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to approve blog.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/blogs/:id/reject - Reject Pending Blog
router.post('/blogs/:id/reject', (req, res) => {
  try {
    const blogId = req.params.id;
    const { rejection_reason } = req.body;

    if (!rejection_reason || rejection_reason.trim().length < 10) {
      res.cookie('flash_error', 'Rejection reason must be at least 10 characters long.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const blog = db.prepare('SELECT title FROM blogs WHERE id = ?').get(blogId);
    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('/admin/blogs');
    }

    db.prepare("UPDATE blogs SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(rejection_reason.trim(), blogId);

    logAdminAction(req, 'Reject Blog', 'blog', blogId, `Rejected blog post "${blog.title}" for reason: "${rejection_reason}"`);

    res.cookie('flash_success', 'Blog draft has been rejected and returned to the author.', { maxAge: 5000 });
    res.redirect('/admin/blogs?status=rejected');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to process rejection.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/blogs/:id/feature - Toggle Featured Flag
router.post('/admin/blogs/:id/feature', (req, res) => {
  try {
    const blogId = req.params.id;
    const blog = db.prepare('SELECT featured, title FROM blogs WHERE id = ?').get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    const newFeatured = blog.featured === 1 ? 0 : 1;
    db.prepare('UPDATE blogs SET featured = ? WHERE id = ?').run(newFeatured, blogId);

    logAdminAction(req, 'Feature Blog Toggle', 'blog', blogId, `Toggled featured index of blog "${blog.title}" to ${newFeatured}`);

    res.cookie('flash_success', `Article featured index successfully toggled to ${newFeatured}.`, { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to toggle featured status.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/blogs/:id/delete - Delete Blog from admin
router.post('/admin/blogs/:id/delete', (req, res) => {
  try {
    const blogId = req.params.id;
    const blog = db.prepare('SELECT title FROM blogs WHERE id = ?').get(blogId);

    if (!blog) {
      res.cookie('flash_error', 'Article not found.', { maxAge: 5000 });
      return res.redirect('/admin/blogs');
    }

    db.prepare('DELETE FROM blogs WHERE id = ?').run(blogId);

    logAdminAction(req, 'Delete Blog', 'blog', blogId, `Deleted blog "${blog.title}"`);

    res.cookie('flash_success', 'Article deleted successfully.', { maxAge: 5000 });
    res.redirect('/admin/blogs');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete article.', { maxAge: 5000 });
    res.redirect('/admin/blogs');
  }
});

// GET /admin/comments - Pending Comments Moderation Queue
router.get('/comments', (req, res) => {
  try {
    const comments = db.prepare(`
      SELECT c.*, u.name as commenter_name, u.avatar as commenter_avatar, b.title as blog_title, b.slug as blog_slug
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN blogs b ON c.blog_id = b.id
      WHERE c.status = 'pending'
      ORDER BY c.created_at DESC
    `).all();

    // Re-use views/admin/blogs.ejs with comments tab active
    // Load standard data required for filters
    const categories = db.prepare('SELECT id, name FROM categories').all();
    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM blogs WHERE status = 'pending'").get().count;

    res.render('admin/blogs', {
      title: 'Moderate Comments',
      blogs: [], // Empty since we are rendering the comments tab
      categories,
      pendingCount,
      pendingCommentsCount: comments.length,
      commentsList: comments,
      filters: { status: 'comments', category: '', search: '', page: 1, totalPages: 1 },
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read comments queue.');
  }
});

// POST /admin/comments/:id/approve - Approve Comment
router.post('/comments/:id/approve', (req, res) => {
  try {
    const commentId = req.params.id;
    const comment = db.prepare('SELECT blog_id, content FROM comments WHERE id = ?').get(commentId);

    if (!comment) {
      res.cookie('flash_error', 'Comment not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(commentId);

    logAdminAction(req, 'Approve Comment', 'comment', commentId, `Approved comment: "${comment.content.substring(0, 40)}..."`);

    res.cookie('flash_success', 'Comment approved successfully.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to approve comment.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/comments/:id/reject - Reject Comment
router.post('/comments/:id/reject', (req, res) => {
  try {
    const commentId = req.params.id;
    const comment = db.prepare('SELECT content FROM comments WHERE id = ?').get(commentId);

    if (!comment) {
      res.cookie('flash_error', 'Comment not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    db.prepare("UPDATE comments SET status = 'rejected' WHERE id = ?").run(commentId);

    logAdminAction(req, 'Reject Comment', 'comment', commentId, `Rejected comment: "${comment.content.substring(0, 40)}..."`);

    res.cookie('flash_success', 'Comment marked as rejected.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to reject comment.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/comments/:id/delete - Delete Comment
router.post('/comments/:id/delete', (req, res) => {
  try {
    const commentId = req.params.id;
    const comment = db.prepare('SELECT content FROM comments WHERE id = ?').get(commentId);

    if (!comment) {
      res.cookie('flash_error', 'Comment not found.', { maxAge: 5000 });
      return res.redirect('back');
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);

    logAdminAction(req, 'Delete Comment', 'comment', commentId, `Deleted comment: "${comment.content.substring(0, 40)}..."`);

    res.cookie('flash_success', 'Comment deleted successfully.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete comment.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /admin/services - Services Management List
router.get('/services', (req, res) => {
  try {
    const services = db.prepare('SELECT * FROM services ORDER BY display_order ASC').all();
    res.render('admin/services', {
      title: 'Manage Services',
      services,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read services directory.');
  }
});

// POST /admin/services - Add New Service
router.post('/services', (req, res) => {
  try {
    const { title, description, icon, tag, display_order } = req.body;

    if (!title || !description || !icon) {
      res.cookie('flash_error', 'Please fill out all mandatory service fields.', { maxAge: 5000 });
      return res.redirect('/admin/services');
    }

    const info = db.prepare(`
      INSERT INTO services (title, description, icon, tag, display_order, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(
      title.trim(),
      description.trim(),
      icon.trim(),
      tag ? tag.trim() : null,
      parseInt(display_order) || 0
    );

    logAdminAction(req, 'Create Service', 'service', info.lastInsertRowid, `Created service "${title}"`);

    res.cookie('flash_success', 'New service added successfully!', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to add service.', { maxAge: 5000 });
    res.redirect('/admin/services');
  }
});

// POST /admin/services/:id - Update Service Details
router.post('/services/:id', (req, res) => {
  try {
    const serviceId = req.params.id;
    const { title, description, icon, tag, display_order } = req.body;

    if (!title || !description || !icon) {
      res.cookie('flash_error', 'Required fields cannot be empty.', { maxAge: 5000 });
      return res.redirect('/admin/services');
    }

    db.prepare(`
      UPDATE services
      SET title = ?, description = ?, icon = ?, tag = ?, display_order = ?
      WHERE id = ?
    `).run(
      title.trim(),
      description.trim(),
      icon.trim(),
      tag ? tag.trim() : null,
      parseInt(display_order) || 0,
      serviceId
    );

    logAdminAction(req, 'Update Service', 'service', serviceId, `Updated details of service "${title}"`);

    res.cookie('flash_success', 'Service updated successfully.', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to update service.', { maxAge: 5000 });
    res.redirect('/admin/services');
  }
});

// POST /admin/services/:id/toggle - Toggle Service active status
router.post('/services/:id/toggle', (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = db.prepare('SELECT active, title FROM services WHERE id = ?').get(serviceId);

    if (!service) {
      res.cookie('flash_error', 'Service not found.', { maxAge: 5000 });
      return res.redirect('/admin/services');
    }

    const newActiveStatus = service.active === 1 ? 0 : 1;
    db.prepare('UPDATE services SET active = ? WHERE id = ?').run(newActiveStatus, serviceId);

    logAdminAction(req, 'Toggle Service Active', 'service', serviceId, `Toggled active index of service "${service.title}" to ${newActiveStatus}`);

    res.cookie('flash_success', `Service active status successfully changed.`, { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to toggle service status.', { maxAge: 5000 });
    res.redirect('/admin/services');
  }
});

// POST /admin/services/:id/delete - Delete Service
router.post('/services/:id/delete', (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = db.prepare('SELECT title FROM services WHERE id = ?').get(serviceId);

    if (!service) {
      res.cookie('flash_error', 'Service not found.', { maxAge: 5000 });
      return res.redirect('/admin/services');
    }

    db.prepare('DELETE FROM services WHERE id = ?').run(serviceId);

    logAdminAction(req, 'Delete Service', 'service', serviceId, `Deleted service: "${service.title}"`);

    res.cookie('flash_success', 'Service deleted successfully.', { maxAge: 5000 });
    res.redirect('/admin/services');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete service.', { maxAge: 5000 });
    res.redirect('/admin/services');
  }
});

// GET /admin/contacts - Contact Submissions
router.get('/contacts', (req, res) => {
  try {
    const status = req.query.status || 'unread';
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM contacts WHERE 1=1';
    let dataQuery = 'SELECT * FROM contacts WHERE 1=1';
    const params = [];

    if (status !== 'all') {
      countQuery += ' AND status = ?';
      dataQuery += ' AND status = ?';
      params.push(status);
    }

    const totalContacts = db.prepare(countQuery).get(params).count;
    const totalPages = Math.ceil(totalContacts / limit) || 1;

    dataQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const queryParams = [...params, limit, offset];
    const contacts = db.prepare(dataQuery).all(queryParams);

    // Get count of unread contacts for layout badge
    const unreadCount = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'unread'").get().count;

    res.render('admin/contacts', {
      title: 'Contact Submissions',
      contacts,
      unreadCount,
      filters: { status, page, totalPages },
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to query contact submissions.');
  }
});

// POST /admin/contacts/:id/read - Mark Contact Read via AJAX/form
router.post('/contacts/:id/read', (req, res) => {
  try {
    const contactId = req.params.id;
    db.prepare("UPDATE contacts SET status = 'read' WHERE id = ?").run(contactId);
    
    // Check if it was an AJAX fetch request
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.json({ success: true });
    }

    res.cookie('flash_success', 'Enquiry marked as read.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(500).json({ success: false });
    }
    res.cookie('flash_error', 'Failed to update contact status.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/contacts/:id/replied - Log Admin Reply Note
router.post('/contacts/:id/replied', (req, res) => {
  try {
    const contactId = req.params.id;
    const { admin_note } = req.body;

    db.prepare("UPDATE contacts SET status = 'replied', admin_note = ? WHERE id = ?").run(admin_note || '', contactId);

    logAdminAction(req, 'Reply Contact', 'contact', contactId, `Marked contact ID ${contactId} as replied.`);

    res.cookie('flash_success', 'Response recorded successfully.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to update response details.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// POST /admin/contacts/:id/delete - Delete Contact Submission
router.post('/contacts/:id/delete', (req, res) => {
  try {
    const contactId = req.params.id;
    db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
    res.cookie('flash_success', 'Submission deleted.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to delete submission.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /admin/newsletter - Newsletter Subscribers list
router.get('/newsletter', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const totalSubscribers = db.prepare('SELECT COUNT(*) as count FROM newsletter').get().count;
    const activeSubscribers = db.prepare('SELECT COUNT(*) as count FROM newsletter WHERE active = 1').get().count;
    const unsubscribedSubscribers = db.prepare('SELECT COUNT(*) as count FROM newsletter WHERE active = 0').get().count;
    const totalPages = Math.ceil(totalSubscribers / limit) || 1;

    const subscribers = db.prepare('SELECT * FROM newsletter ORDER BY subscribed_at DESC LIMIT ? OFFSET ?').all(limit, offset);

    res.render('admin/newsletter', {
      title: 'Newsletter Subscribers',
      subscribers,
      totalCount: totalSubscribers,
      activeCount: activeSubscribers,
      unsubscribedCount: unsubscribedSubscribers,
      currentPage: page,
      totalPages,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to retrieve subscribers.');
  }
});

// POST /admin/newsletter/:id/delete - Delete Subscriber
router.post('/newsletter/:id/delete', (req, res) => {
  try {
    const subId = req.params.id;
    db.prepare('DELETE FROM newsletter WHERE id = ?').run(subId);
    res.cookie('flash_success', 'Subscriber removed successfully.', { maxAge: 5000 });
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to remove subscriber.', { maxAge: 5000 });
    res.redirect('back');
  }
});

// GET /admin/settings - Site-wide Settings Config Page
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings').all();
    res.render('admin/settings', {
      title: 'Site Settings',
      settingsList: settings,
      cssFile: 'admin.css'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read site configurations.');
  }
});

// POST /admin/settings - Update Settings loop
router.post('/settings', (req, res) => {
  try {
    const updates = req.body;
    const updateStmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');

    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (key !== 'csrf_token') {
          updateStmt.run(value.trim(), key);
        }
      }
    })();

    logAdminAction(req, 'Update Settings', 'settings', 0, 'Updated global site settings.');

    res.cookie('flash_success', 'Global site settings updated successfully.', { maxAge: 5000 });
    res.redirect('/admin/settings');
  } catch (err) {
    console.error(err);
    res.cookie('flash_error', 'Failed to save configuration updates.', { maxAge: 5000 });
    res.redirect('/admin/settings');
  }
});

module.exports = router;
