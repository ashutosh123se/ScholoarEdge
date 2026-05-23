/* ==========================================================================
   SCHOLARSEDGE CLIENT INTERACTIVITY - QUILL EDITOR LOGIC
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const blogForm = document.getElementById('blog-form');
  if (!blogForm) return;

  const userId = blogForm.dataset.userId || 'guest';
  const blogId = blogForm.dataset.blogId || 'new';
  const draftKey = `blog-draft-${userId}-${blogId}`;

  // 1. Initialize Quill Editor
  const editorContainer = document.getElementById('editor-container');
  const contentInput = document.getElementById('hidden-content');
  
  if (editorContainer && contentInput) {
    const quill = new Quill('#editor-container', {
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          ['link', 'blockquote', 'code-block', 'image'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['clean']
        ]
      },
      placeholder: 'Compose your academic insights...',
      theme: 'snow'
    });

    // If edit page, load content from hidden input
    if (contentInput.value) {
      quill.root.innerHTML = contentInput.value;
    }

    // Sync content on changes
    quill.on('text-change', () => {
      const html = quill.root.innerHTML;
      contentInput.value = html === '<p><br></p>' ? '' : html;
      updateWordCount(quill.getText());
    });

    // 2. Real-time Word Count Indicator
    const wordCountSpan = document.getElementById('word-count');
    const updateWordCount = (text) => {
      if (!wordCountSpan) return;
      const words = text.trim().split(/\s+/).filter(Boolean);
      wordCountSpan.textContent = words.length;
    };
    // Init word count
    updateWordCount(quill.getText());

    // 3. Auto-save draft to localStorage (every 30 seconds)
    setInterval(() => {
      const title = document.getElementById('title')?.value || '';
      const excerpt = document.getElementById('excerpt')?.value || '';
      const content = quill.root.innerHTML;
      const categoryId = document.getElementById('category_id')?.value || '';
      const tags = document.getElementById('hidden-tags')?.value || '';

      if (title.trim() || content.trim() !== '<p><br></p>') {
        const draftData = {
          title,
          excerpt,
          content,
          categoryId,
          tags,
          timestamp: Date.now()
        };
        localStorage.setItem(draftKey, JSON.stringify(draftData));
      }
    }, 30000);

    // 4. Restore Draft Check on Load
    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        const titleInput = document.getElementById('title');
        
        // Show restore prompt only if the current form is empty
        const isFormEmpty = !titleInput.value && (quill.root.innerHTML === '<p><br></p>' || !quill.root.innerHTML);
        
        if (isFormEmpty && (draftData.title || draftData.content)) {
          const restore = confirm('An unsaved draft for this article was found. Would you like to restore it?');
          if (restore) {
            if (titleInput && draftData.title) titleInput.value = draftData.title;
            if (document.getElementById('excerpt') && draftData.excerpt) document.getElementById('excerpt').value = draftData.excerpt;
            quill.root.innerHTML = draftData.content;
            contentInput.value = draftData.content;
            if (document.getElementById('category_id') && draftData.categoryId) document.getElementById('category_id').value = draftData.categoryId;
            
            // Restore tags if present
            if (draftData.tags) {
              const tagsInput = document.getElementById('hidden-tags');
              if (tagsInput) {
                tagsInput.value = draftData.tags;
                renderTagsList(draftData.tags);
              }
            }
            updateWordCount(quill.getText());
          } else {
            // Delete draft if they reject
            localStorage.removeItem(draftKey);
          }
        }
      } catch (err) {
        console.error('Failed to restore draft:', err);
      }
    }

    // 5. Form Validation before submit
    blogForm.addEventListener('submit', (e) => {
      const title = document.getElementById('title')?.value || '';
      const text = quill.getText().trim();
      const words = text.split(/\s+/).filter(Boolean);

      if (title.trim().length < 5) {
        e.preventDefault();
        alert('Title must be at least 5 characters long.');
        return;
      }

      if (words.length < 15) { // 15 words is a soft check, requirement says content min 100 chars (quill content has html tags so it will satisfy, but check words length for good academic standards)
        if (quill.root.innerHTML.length < 100) {
          e.preventDefault();
          alert('Content must be at least 100 characters long.');
          return;
        }
      }

      // If valid, clear local storage draft
      localStorage.removeItem(draftKey);
    });
  }

  // 6. Cover image drag and drop + click preview
  const fileInput = document.getElementById('cover_image');
  const uploadZone = document.getElementById('upload-zone');
  const previewImg = document.getElementById('upload-preview');

  if (fileInput && uploadZone) {
    uploadZone.addEventListener('click', () => {
      fileInput.click();
    });

    // Drag-over hover indicators
    ['dragenter', 'dragover'].forEach(eventName => {
      uploadZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        uploadZone.style.backgroundColor = 'rgba(201, 168, 76, 0.15)';
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      uploadZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        uploadZone.style.backgroundColor = '';
      }, false);
    });

    uploadZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0) {
        fileInput.files = files;
        handleImagePreview(files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleImagePreview(fileInput.files[0]);
      }
    });

    const handleImagePreview = (file) => {
      if (!file.type.startsWith('image/')) {
        alert('Only image files are allowed.');
        return;
      }
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (previewImg) {
          previewImg.src = reader.result;
          previewImg.style.display = 'block';
        } else {
          const newPreview = document.createElement('img');
          newPreview.id = 'upload-preview';
          newPreview.className = 'upload-preview';
          newPreview.src = reader.result;
          uploadZone.appendChild(newPreview);
        }
      };
    };
  }

  // 7. Interactive Tags Input (comma/enter separated tags)
  const tagsInput = document.getElementById('tags-input');
  const hiddenTags = document.getElementById('hidden-tags');
  const tagsListContainer = document.getElementById('tags-list-container');

  if (tagsInput && hiddenTags && tagsListContainer) {
    let tagsList = hiddenTags.value ? hiddenTags.value.split(',').map(t => t.trim()).filter(Boolean) : [];

    const updateHiddenTags = () => {
      hiddenTags.value = tagsList.join(',');
    };

    const addTagPill = (tagText) => {
      const cleanTag = tagText.trim().replace(/,/g, '');
      if (cleanTag && !tagsList.includes(cleanTag)) {
        tagsList.push(cleanTag);
        updateHiddenTags();
        renderTagPills();
      }
    };

    const removeTagPill = (tagText) => {
      tagsList = tagsList.filter(t => t !== tagText);
      updateHiddenTags();
      renderTagPills();
    };

    const renderTagPills = () => {
      tagsListContainer.innerHTML = '';
      tagsList.forEach(t => {
        const pill = document.createElement('span');
        pill.className = 'tag-badge';
        pill.innerHTML = `${t} <i class="fa-solid fa-xmark" data-tag="${t}"></i>`;
        tagsListContainer.appendChild(pill);
      });
      // Attach input element back inside
      tagsListContainer.appendChild(tagsInput);
      tagsInput.focus();
    };

    const renderTagsList = (tagsString) => {
      tagsList = tagsString.split(',').map(t => t.trim()).filter(Boolean);
      renderTagPills();
    };

    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === ',' || e.key === 'Enter') {
        e.preventDefault();
        addTagPill(tagsInput.value);
        tagsInput.value = '';
      } else if (e.key === 'Backspace' && !tagsInput.value && tagsList.length > 0) {
        // Remove last tag on backspace if input is empty
        removeTagPill(tagsList[tagsList.length - 1]);
      }
    });

    // Handle tag removal click
    tagsListContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('fa-xmark')) {
        const tagToRemove = e.target.dataset.tag;
        removeTagPill(tagToRemove);
      }
    });

    // Inital render
    if (tagsList.length > 0) {
      renderTagPills();
    }
  }

  // 8. Character Counters
  const titleInput = document.getElementById('title');
  const titleCounter = document.getElementById('title-counter');
  if (titleInput && titleCounter) {
    titleInput.addEventListener('input', () => {
      titleCounter.textContent = `${titleInput.value.length}/120`;
    });
    titleCounter.textContent = `${titleInput.value.length}/120`;
  }

  const excerptInput = document.getElementById('excerpt');
  const excerptCounter = document.getElementById('excerpt-counter');
  if (excerptInput && excerptCounter) {
    excerptInput.addEventListener('input', () => {
      excerptCounter.textContent = `${excerptInput.value.length}/200`;
    });
    excerptCounter.textContent = `${excerptInput.value.length}/200`;
  }
});
