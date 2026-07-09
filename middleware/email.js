/* ==========================================================================
   SCHOLARSEDGE EMAIL HELPER — Resend API Integration
   Sends transactional emails (contact notifications, newsletter confirmations)
   Requires: RESEND_API_KEY in .env  |  ADMIN_NOTIFY_EMAIL in .env
   Falls back gracefully if RESEND_API_KEY is not configured.
   ========================================================================== */

const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'admin@scholarsedge.in';
const SITE_NAME = process.env.SITE_NAME || 'ScholarsEdge';
const BASE_URL = process.env.BASE_URL || 'https://scholoar-edge.vercel.app';

// Only initialise Resend if API key is present
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Send an email via Resend.
 * @param {Object} opts - { to, subject, html, from }
 * @returns {Promise<boolean>} - true on success, false on failure
 */
const sendEmail = async ({ to, subject, html, from }) => {
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY not set — email skipped:', subject);
    return false;
  }

  try {
    const result = await resend.emails.send({
      from: from || `${SITE_NAME} <onboarding@resend.dev>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    });
    console.log('[Email] Sent successfully:', result.id || subject);
    return true;
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    return false;
  }
};

/**
 * Notify admin when a new contact form submission arrives.
 */
const notifyAdminNewContact = async (contact) => {
  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #f9f8f5; padding: 2rem; border-radius: 8px;">
      <div style="background: #0d1b2a; color: #c9a84c; padding: 1.5rem; border-radius: 6px 6px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 1.4rem; letter-spacing: 1px;">📬 New Enquiry — ${SITE_NAME}</h1>
      </div>
      <div style="background: white; padding: 2rem; border: 1px solid #e5e0d5; border-top: none; border-radius: 0 0 6px 6px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; font-weight: bold; color: #0d1b2a; width: 35%;">Name</td><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; color: #3a4a5c;">${contact.name}</td></tr>
          <tr><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; font-weight: bold; color: #0d1b2a;">Email</td><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; color: #3a4a5c;"><a href="mailto:${contact.email}" style="color: #c9a84c;">${contact.email}</a></td></tr>
          <tr><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; font-weight: bold; color: #0d1b2a;">Phone</td><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; color: #3a4a5c;">${contact.phone || 'Not provided'}</td></tr>
          <tr><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; font-weight: bold; color: #0d1b2a;">Service</td><td style="padding: 0.75rem 0; border-bottom: 1px solid #f0ede8; color: #3a4a5c;">${contact.service || 'General Enquiry'}</td></tr>
          <tr><td style="padding: 1rem 0; vertical-align: top; font-weight: bold; color: #0d1b2a;">Message</td><td style="padding: 1rem 0; color: #3a4a5c; line-height: 1.6;">${contact.message}</td></tr>
        </table>
        <div style="margin-top: 1.5rem; text-align: center;">
          <a href="${BASE_URL}/admin/contacts" style="display: inline-block; background: #c9a84c; color: #0d1b2a; padding: 0.75rem 2rem; border-radius: 4px; text-decoration: none; font-weight: bold; font-family: sans-serif;">View in Admin Panel</a>
        </div>
      </div>
      <p style="text-align: center; color: #999; font-size: 0.75rem; margin-top: 1rem; font-family: sans-serif;">This is an automated notification from ${SITE_NAME}.</p>
    </div>
  `;

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `[${SITE_NAME}] New Enquiry from ${contact.name} — ${contact.service || 'General'}`,
    html
  });
};

/**
 * Send newsletter subscription confirmation to subscriber.
 */
const sendNewsletterConfirmation = async (email) => {
  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #f9f8f5; padding: 2rem; border-radius: 8px;">
      <div style="background: #0d1b2a; color: #c9a84c; padding: 2rem; border-radius: 6px 6px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 1.4rem;">Welcome to ${SITE_NAME} Digest 🎓</h1>
      </div>
      <div style="background: white; padding: 2rem; border: 1px solid #e5e0d5; border-top: none; border-radius: 0 0 6px 6px;">
        <p style="font-size: 1rem; color: #3a4a5c; line-height: 1.7;">Thank you for subscribing to our <strong>Academic Research Digest</strong>. You'll receive curated insights on journal publishing, research methodology, and academic career guidance.</p>
        <ul style="color: #3a4a5c; line-height: 2;">
          <li>📚 Research publication strategies</li>
          <li>🔬 Scopus, SCI & UGC Care journal tips</li>
          <li>✍️ Academic writing & thesis support</li>
          <li>📊 Data analysis & methodology insights</li>
        </ul>
        <div style="margin-top: 1.5rem; text-align: center;">
          <a href="${BASE_URL}/blog" style="display: inline-block; background: #0d1b2a; color: #c9a84c; padding: 0.75rem 2rem; border-radius: 4px; text-decoration: none; font-weight: bold; font-family: sans-serif;">Explore Our Blog</a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `Welcome to ${SITE_NAME} Academic Research Digest`,
    html
  });
};

module.exports = { sendEmail, notifyAdminNewContact, sendNewsletterConfirmation };
