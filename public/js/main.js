/* ==========================================================================
   SCHOLARSEDGE CLIENT INTERACTIVITY - MAIN WEBSITE SCRIPT
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobile Menu Toggle
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');

  if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
      navMenu.classList.toggle('show');
      // Update hamburger icon
      const icon = hamburger.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-bars');
        icon.classList.toggle('fa-xmark');
      }
    });
  }

  // 2. Sticky Header Shadow on Scroll
  const header = document.querySelector('.header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  // 3. Intersection Observer: Count-up animation on metrics
  const statNumbers = document.querySelectorAll('.stat-number');
  if (statNumbers.length > 0) {
    const runCountUp = (element) => {
      const target = parseFloat(element.getAttribute('data-target'));
      const suffix = element.getAttribute('data-suffix') || '';
      let current = 0;
      const duration = 1500; // 1.5s duration
      const stepTime = 15;
      const steps = duration / stepTime;
      const increment = target / steps;

      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          element.textContent = target.toLocaleString() + suffix;
          clearInterval(timer);
        } else {
          // If decimal target, round to 1 decimal, else whole number
          const text = Number.isInteger(target) 
            ? Math.floor(current).toLocaleString() 
            : current.toFixed(1);
          element.textContent = text + suffix;
        }
      }, stepTime);
    };

    const observerOptions = {
      root: null,
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          runCountUp(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    statNumbers.forEach(num => observer.observe(num));
  }

  // 4. Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        window.scrollTo({
          top: target.offsetTop - 68, // Account for sticky nav height
          behavior: 'smooth'
        });
        // Collapse mobile menu if open
        if (navMenu && navMenu.classList.contains('show')) {
          navMenu.classList.remove('show');
          const icon = hamburger.querySelector('i');
          if (icon) {
            icon.classList.add('fa-bars');
            icon.classList.remove('fa-xmark');
          }
        }
      }
    });
  });

  // 5. Toast System Helper
  const showToast = (message, type = 'success') => {
    let container = document.querySelector('.flash-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'flash-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    
    toast.innerHTML = `
      <div class="toast-content">
        <i class="fa-solid ${iconClass}"></i>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    // Auto dismiss
    const dismissTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, type === 'success' ? 4000 : 7000); // errors stay longer

    // Close button listener
    toast.querySelector('.toast-close').addEventListener('click', () => {
      clearTimeout(dismissTimer);
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });
  };

  // 6. Newsletter Form Submission (AJAX fetch)
  const newsletterForm = document.getElementById('newsletter-form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = newsletterForm.querySelector('input[type="email"]');
      const email = emailInput.value.trim();

      if (!email) return;

      try {
        const response = await fetch('/newsletter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (data.success) {
          showToast(data.message, 'success');
          emailInput.value = '';
        } else {
          showToast(data.error || 'Failed to subscribe.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Connection error. Please try again.', 'error');
      }
    });
  }

  // 7. Flash message automatic dismissals (for server-rendered toasts)
  const existingToasts = document.querySelectorAll('.toast');
  existingToasts.forEach(toast => {
    const isError = toast.classList.contains('toast-error');
    const timer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, isError ? 7000 : 4000);

    toast.querySelector('.toast-close').addEventListener('click', () => {
      clearTimeout(timer);
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });
  });

  // 8. Image Lazy Loading via Intersection Observer
  const lazyImages = document.querySelectorAll('img[loading="lazy"]');
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const image = entry.target;
          // If we had a data-src attribute we would swap it, otherwise default loading="lazy" is supported by modern browsers
          imageObserver.unobserve(image);
        }
      });
    });
    lazyImages.forEach(img => imageObserver.observe(img));
  }

  // 9. Scroll to Top Button
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.className = 'scroll-to-top';
  scrollTopBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
  document.body.appendChild(scrollTopBtn);

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      scrollTopBtn.classList.add('show');
    } else {
      scrollTopBtn.classList.remove('show');
    }
  });

  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
});
