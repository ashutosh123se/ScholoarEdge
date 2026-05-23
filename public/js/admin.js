/* ==========================================================================
   SCHOLARSEDGE CLIENT INTERACTIVITY - ADMIN PANEL SCRIPT
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Chart.js Initialization
  const blogsChartEl = document.getElementById('blogs-chart');
  if (blogsChartEl && typeof Chart !== 'undefined') {
    const labels = JSON.parse(blogsChartEl.dataset.labels || '[]');
    const counts = JSON.parse(blogsChartEl.dataset.counts || '[]');

    new Chart(blogsChartEl, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Blogs Published',
          data: counts,
          borderColor: '#c9a84c',
          backgroundColor: 'rgba(201, 168, 76, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(13, 27, 42, 0.05)' },
            ticks: { color: '#3a4a5c' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#3a4a5c' }
          }
        }
      }
    });
  }

  const usersChartEl = document.getElementById('users-chart');
  if (usersChartEl && typeof Chart !== 'undefined') {
    const labels = JSON.parse(usersChartEl.dataset.labels || '[]');
    const counts = JSON.parse(usersChartEl.dataset.counts || '[]');

    new Chart(usersChartEl, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Registrations',
          data: counts,
          backgroundColor: '#0d1b2a',
          borderColor: '#0d1b2a',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(13, 27, 42, 0.05)' },
            ticks: { color: '#3a4a5c' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#3a4a5c' }
          }
        }
      }
    });
  }

  // 2. Custom Delete Confirmation Modals
  const deleteForms = document.querySelectorAll('.confirm-delete-form');
  const modalOverlay = document.getElementById('delete-modal-overlay');
  const modalConfirmBtn = document.getElementById('modal-confirm-delete-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalItemName = document.getElementById('modal-item-name');
  let activeDeleteForm = null;

  if (deleteForms.length > 0 && modalOverlay) {
    deleteForms.forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        activeDeleteForm = form;
        
        // Show item details if provided in dataset
        const name = form.dataset.itemName || 'this resource';
        if (modalItemName) {
          modalItemName.textContent = name;
        }

        modalOverlay.classList.add('show');
      });
    });

    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('show');
        activeDeleteForm = null;
      });
    }

    if (modalConfirmBtn) {
      modalConfirmBtn.addEventListener('click', () => {
        if (activeDeleteForm) {
          activeDeleteForm.submit();
        }
      });
    }

    // Close on click outside modal
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.classList.remove('show');
        activeDeleteForm = null;
      }
    });
  }

  // 3. Inline Reject Form Toggler
  const rejectToggleButtons = document.querySelectorAll('.btn-reject-toggle');
  rejectToggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const blogId = btn.dataset.blogId;
      const rejectBox = document.getElementById(`reject-box-${blogId}`);
      if (rejectBox) {
        rejectBox.classList.toggle('show');
        const textarea = rejectBox.querySelector('textarea');
        if (textarea && rejectBox.classList.contains('show')) {
          textarea.focus();
        }
      }
    });
  });

  // 4. Mark Contact submission read (AJAX Fetch)
  const contactCards = document.querySelectorAll('.contact-submission-card');
  contactCards.forEach(card => {
    const readBtn = card.querySelector('.btn-mark-read');
    if (readBtn) {
      readBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const contactId = readBtn.dataset.id;
        const csrfToken = document.querySelector('input[name="csrf_token"]')?.value;

        try {
          const response = await fetch(`/admin/contacts/${contactId}/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken
            }
          });

          const data = await response.json();
          if (data.success) {
            // Update badge class and text
            const badge = card.querySelector('.status-badge');
            if (badge) {
              badge.className = 'status-badge status-draft';
              badge.textContent = 'read';
            }
            // Remove button
            readBtn.remove();
          } else {
            alert('Failed to mark read.');
          }
        } catch (err) {
          console.error(err);
          alert('Network connection error.');
        }
      });
    }
  });

  // 5. Settings form: warn before page leave if changed
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    let formEdited = false;
    settingsForm.addEventListener('change', () => formEdited = true);
    settingsForm.addEventListener('input', () => formEdited = true);

    window.addEventListener('beforeunload', (e) => {
      if (formEdited) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    });

    settingsForm.addEventListener('submit', () => {
      formEdited = false;
    });
  }

  // 6. Highlight active sidebar links
  const currentPath = window.location.pathname;
  const sidebarLinks = document.querySelectorAll('.admin-sidebar-menu li a');
  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href');
    const li = link.parentElement;
    if (currentPath === href) {
      li.classList.add('active');
    } else if (href !== '/admin' && currentPath.startsWith(href)) {
      li.classList.add('active');
    } else {
      li.classList.remove('active');
    }
  });

  // 7. Dynamic Digital Clock Header
  const clockEl = document.getElementById('admin-clock');
  if (clockEl) {
    const updateClock = () => {
      const d = new Date();
      clockEl.textContent = d.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };
    setInterval(updateClock, 1000);
    updateClock();
  }
});
