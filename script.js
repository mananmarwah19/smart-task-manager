/**
 * Todo List Application - Backend Logic
 * ======================================
 * Handles all task management, persistence, filtering,
 * dark mode, counters, and UI rendering.
 *
 * INTEGRATION NOTES:
 * - Uses <template id="task-card-template"> for card rendering (clone-based)
 * - Animation classes: .slide-in (unused, CSS auto-animates .task-card),
 *   .deleting (triggers slideOut), .completing (triggers taskComplete)
 * - Completed cards get class .completed (matching CSS selectors)
 * - Priority badge uses data-priority attribute for CSS color coding
 * - Empty states are handled via CSS: .task-list:not(:empty) + .empty-state
 * - Tabs switch .active on .tab buttons and .task-section elements
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Constants ───────────────────────────────────────────────────
  const STORAGE_KEY = 'todo-app-tasks';
  const THEME_KEY = 'todo-app-theme';
  const DEBOUNCE_DELAY = 250; // ms for search debounce
  const DELETE_ANIMATION_DURATION = 350; // ms — matches CSS .deleting animation

  // ─── DOM References ──────────────────────────────────────────────
  const addTaskForm = document.getElementById('add-task-form');
  const taskInput = document.getElementById('task-input');
  const prioritySelect = document.getElementById('priority-select');
  const dueDateInput = document.getElementById('due-date');
  const searchInput = document.getElementById('search-input');
  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const pendingTasksList = document.getElementById('pending-tasks-list');
  const completedTasksList = document.getElementById('completed-tasks-list');
  const pendingCount = document.getElementById('pending-count');
  const completedCount = document.getElementById('completed-count');
  const totalCount = document.getElementById('total-count');
  const clearCompletedBtn = document.getElementById('clear-completed-btn');
  const taskCardTemplate = document.getElementById('task-card-template');

  // Tab elements
  const tabButtons = document.querySelectorAll('.tab[data-tab]');
  const taskSections = document.querySelectorAll('.task-section[data-section]');

  // ─── State ───────────────────────────────────────────────────────
  let tasks = [];

  // ═══════════════════════════════════════════════════════════════════
  //  1. UNIQUE ID GENERATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate a unique ID using timestamp + random suffix.
   * @returns {string} Unique identifier
   */
  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // ═══════════════════════════════════════════════════════════════════
  //  2. LOCAL STORAGE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Save the current tasks array to localStorage.
   */
  const saveTasks = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error('Failed to save tasks to localStorage:', err);
    }
  };

  /**
   * Load tasks from localStorage. Returns an empty array on failure.
   * @returns {Array} Parsed tasks array
   */
  const loadTasks = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('Failed to load tasks from localStorage:', err);
      return [];
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  3. TASK COUNTERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Recompute and update the pending / completed / total counters.
   * Also manages the Clear Completed button visibility and the
   * counter-badge pop animation.
   */
  const updateCounters = () => {
    const pending = tasks.filter((t) => !t.completed).length;
    const completed = tasks.filter((t) => t.completed).length;

    pendingCount.textContent = pending;
    completedCount.textContent = completed;
    totalCount.textContent = tasks.length;

    // Animate the total counter badge
    totalCount.classList.remove('pop');
    // Trigger reflow so re-adding the class actually replays the animation
    void totalCount.offsetWidth;
    totalCount.classList.add('pop');

    // Show/hide clear-completed button
    clearCompletedBtn.style.display = completed > 0 ? '' : 'none';
  };

  // ═══════════════════════════════════════════════════════════════════
  //  4. DUE DATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Format an ISO date string into a human-friendly label.
   * @param {string} isoDate  e.g. "2026-06-25"
   * @returns {string} Formatted date or empty string
   */
  const formatDueDate = (isoDate) => {
    if (!isoDate) return '';
    const date = new Date(isoDate + 'T00:00:00'); // treat as local
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString(undefined, options);
  };

  /**
   * Determine whether a task is overdue (due date in the past & not completed).
   * @param {Object} task
   * @returns {boolean}
   */
  const isOverdue = (task) => {
    if (!task.dueDate || task.completed) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate + 'T00:00:00');
    return due < today;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  5. RENDER A SINGLE TASK CARD (Template-based)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Build the DOM element for one task by cloning the HTML <template>.
   * @param {Object}  task  The task object
   * @returns {HTMLElement}  The <li class="task-card"> element
   */
  const renderTask = (task) => {
    const { id, text, priority, dueDate, completed } = task;

    // Clone the template
    const fragment = taskCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.task-card');

    // Set the task ID for lookup
    card.dataset.id = id;

    // Mark completed
    if (completed) {
      card.classList.add('completed');
    }

    // ── Task text ──
    const textEl = card.querySelector('.task-text');
    textEl.textContent = text;

    // ── Priority badge ──
    const priorityEl = card.querySelector('.task-priority');
    priorityEl.setAttribute('data-priority', priority);
    priorityEl.textContent = priority.charAt(0).toUpperCase() + priority.slice(1);

    // ── Due date ──
    const dueDateEl = card.querySelector('.task-due-date');
    if (dueDate) {
      dueDateEl.textContent = `Due: ${formatDueDate(dueDate)}`;
      if (isOverdue(task)) {
        dueDateEl.classList.add('overdue');
      }
    } else {
      dueDateEl.style.display = 'none';
    }

    // ── Complete / Undo button ──
    const completeBtn = card.querySelector('.complete-btn');
    completeBtn.setAttribute(
      'aria-label',
      completed ? 'Mark as pending' : 'Mark as completed'
    );
    completeBtn.title = completed ? 'Undo' : 'Complete';
    completeBtn.addEventListener('click', () => toggleComplete(id));

    // ── Delete button ──
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => deleteTask(id));

    return card;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  6. RENDER ALL TASKS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Clear both lists and re-render every task from the tasks array.
   */
  const renderAllTasks = () => {
    pendingTasksList.innerHTML = '';
    completedTasksList.innerHTML = '';

    const pendingTasks = tasks.filter((t) => !t.completed);
    const completedTasks = tasks.filter((t) => t.completed);

    pendingTasks.forEach((task) => {
      pendingTasksList.appendChild(renderTask(task));
    });

    completedTasks.forEach((task) => {
      completedTasksList.appendChild(renderTask(task));
    });

    updateCounters();

    // Re-apply any active search filter
    const query = searchInput.value.trim();
    if (query) filterTasks(query);
  };

  // ═══════════════════════════════════════════════════════════════════
  //  7. ADD TASK
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new task and persist it.
   * @param {string} text
   * @param {string} priority  'low' | 'medium' | 'high'
   * @param {string} dueDate   ISO date string or ''
   */
  const addTask = (text, priority, dueDate) => {
    // Input validation
    const trimmed = text.trim();
    if (!trimmed) {
      taskInput.focus();
      taskInput.classList.add('shake');
      setTimeout(() => taskInput.classList.remove('shake'), 800);
      return;
    }

    const task = {
      id: generateId(),
      text: trimmed,
      priority: priority || 'medium',
      dueDate: dueDate || '',
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    tasks.unshift(task); // newest first
    saveTasks();

    // Render the new card at the top
    const cardEl = renderTask(task);
    pendingTasksList.prepend(cardEl);

    updateCounters();

    // Switch to pending tab so user can see the new task
    switchTab('pending');

    // Reset form
    taskInput.value = '';
    prioritySelect.value = 'medium';
    dueDateInput.value = '';
    taskInput.focus();
  };

  // ═══════════════════════════════════════════════════════════════════
  //  8. DELETE TASK
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Remove a task with a slide-out animation, then update state.
   * @param {string} id  Task ID to remove
   */
  const deleteTask = (id) => {
    const cardEl = document.querySelector(`.task-card[data-id="${id}"]`);
    if (!cardEl) return;

    // Trigger the CSS .deleting animation (slideOut 0.35s)
    cardEl.classList.add('deleting');

    // After animation completes, remove from DOM & state
    const onEnd = () => {
      cardEl.removeEventListener('animationend', onEnd);
      cardEl.remove();

      tasks = tasks.filter((t) => t.id !== id);
      saveTasks();
      updateCounters();
    };

    cardEl.addEventListener('animationend', onEnd);

    // Fallback in case animationend never fires
    setTimeout(() => {
      if (document.contains(cardEl)) {
        onEnd();
      }
    }, DELETE_ANIMATION_DURATION + 50);
  };

  // ═══════════════════════════════════════════════════════════════════
  //  9. TOGGLE COMPLETE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Toggle a task between pending ↔ completed.
   * Plays a brief .completing animation, then moves the card.
   * @param {string} id  Task ID
   */
  const toggleComplete = (id) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    const cardEl = document.querySelector(`.task-card[data-id="${id}"]`);

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    saveTasks();

    if (cardEl) {
      // Play the completing animation
      cardEl.classList.add('completing');

      const onAnimEnd = () => {
        cardEl.removeEventListener('animationend', onAnimEnd);
        renderAllTasks();
      };
      cardEl.addEventListener('animationend', onAnimEnd);

      // Fallback
      setTimeout(() => {
        if (document.contains(cardEl)) {
          renderAllTasks();
        }
      }, 500);
    } else {
      renderAllTasks();
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  10. CLEAR COMPLETED
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Remove all completed tasks at once with animation.
   */
  const clearCompleted = () => {
    const completedCards = completedTasksList.querySelectorAll('.task-card');
    if (completedCards.length === 0) return;

    // Animate all completed cards out simultaneously using .deleting class
    completedCards.forEach((card) => card.classList.add('deleting'));

    // After animations settle, purge from state
    setTimeout(() => {
      tasks = tasks.filter((t) => !t.completed);
      saveTasks();
      renderAllTasks();
    }, DELETE_ANIMATION_DURATION + 50);
  };

  // ═══════════════════════════════════════════════════════════════════
  //  11. SEARCH / FILTER
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Filter visible task cards by a search query (case-insensitive).
   * @param {string} query
   */
  const filterTasks = (query) => {
    const lowerQuery = query.toLowerCase().trim();
    const allCards = document.querySelectorAll('.task-card');

    allCards.forEach((card) => {
      const textEl = card.querySelector('.task-text');
      if (!textEl) return;

      const matches = textEl.textContent.toLowerCase().includes(lowerQuery);
      card.classList.toggle('hidden', !matches && lowerQuery !== '');
    });
  };

  /**
   * Simple debounce helper.
   * @param {Function} fn
   * @param {number}   delay  ms
   * @returns {Function}
   */
  const debounce = (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  //  12. TAB SWITCHING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Switch the active tab and display the corresponding task section.
   * @param {string} tabName  'pending' | 'completed'
   */
  const switchTab = (tabName) => {
    // Update tab button states
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update section visibility
    taskSections.forEach((section) => {
      const isActive = section.dataset.section === tabName;
      section.classList.toggle('active', isActive);
    });
  };

  // ═══════════════════════════════════════════════════════════════════
  //  13. DARK MODE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Toggle between dark and light modes, persisting preference.
   */
  const toggleDarkMode = () => {
    const isDark = document.body.classList.contains('dark-mode');

    document.body.classList.toggle('dark-mode', !isDark);
    document.body.classList.toggle('light-mode', isDark);

    try {
      localStorage.setItem(THEME_KEY, isDark ? 'light' : 'dark');
    } catch (err) {
      console.error('Failed to save theme preference:', err);
    }
  };

  /**
   * Apply saved theme preference on load.
   */
  const loadThemePreference = () => {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      if (theme === 'light') {
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
      } else {
        // Default to dark mode (matches the HTML default class)
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
      }
    } catch (err) {
      console.error('Failed to load theme preference:', err);
      // Keep dark-mode as default (matches HTML)
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  14. OVERDUE CHECK (periodic refresh)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Re-evaluate overdue status on all visible pending cards.
   * Called once per minute so tasks become overdue at midnight.
   */
  const refreshOverdueStatus = () => {
    tasks
      .filter((t) => !t.completed)
      .forEach((task) => {
        const card = document.querySelector(`.task-card[data-id="${task.id}"]`);
        if (card) {
          const dueDateEl = card.querySelector('.task-due-date');
          if (dueDateEl) {
            dueDateEl.classList.toggle('overdue', isOverdue(task));
          }
        }
      });
  };

  // ═══════════════════════════════════════════════════════════════════
  //  15. EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════

  // Add task — form submit (handles both button click and Enter key)
  addTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addTask(taskInput.value, prioritySelect.value, dueDateInput.value);
  });

  // Search — debounced input
  searchInput.addEventListener(
    'input',
    debounce((e) => filterTasks(e.target.value), DEBOUNCE_DELAY)
  );

  // Dark mode toggle
  darkModeToggle.addEventListener('click', toggleDarkMode);

  // Clear completed
  clearCompletedBtn.addEventListener('click', clearCompleted);

  // Tab switching
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  16. INITIALISATION
  // ═══════════════════════════════════════════════════════════════════

  // Load theme
  loadThemePreference();

  // Load tasks from localStorage & render
  tasks = loadTasks();
  renderAllTasks();

  // Periodic overdue refresh — every 60 seconds
  setInterval(refreshOverdueStatus, 60_000);
});
