const config = window.NEWS_CONFIG || {};

const state = {
  activeCategory: "general",
  searchQuery: "",
  page: 1,
  pageSize: Number(config.PAGE_SIZE) || 9,
  isLoading: false,
  hasMore: true,
  totalArticles: 0,
  articles: [],
  bookmarks: loadBookmarks(),
  lastRequestId: 0,
  abortController: null
};

const categoryLabels = {
  general: "Top headlines",
  technology: "Technology coverage",
  business: "Business briefings",
  sports: "Sports highlights",
  health: "Health updates",
  entertainment: "Entertainment stories",
  science: "Science stories"
};

const els = {
  newsGrid: document.getElementById("newsGrid"),
  skeletonGrid: document.getElementById("skeletonGrid"),
  loader: document.getElementById("loader"),
  emptyState: document.getElementById("emptyState"),
  feedbackMessage: document.getElementById("feedbackMessage"),
  searchInput: document.getElementById("searchInput"),
  searchForm: document.getElementById("searchForm"),
  categoryTabs: document.getElementById("categoryTabs"),
  themeToggle: document.getElementById("themeToggle"),
  feedLabel: document.getElementById("feedLabel"),
  feedSubtext: document.getElementById("feedSubtext"),
  bookmarkList: document.getElementById("bookmarkList"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  headlineCount: document.getElementById("headlineCount"),
  featuredTitle: document.getElementById("featuredTitle"),
  featuredDescription: document.getElementById("featuredDescription"),
  bookmarkToggle: document.getElementById("bookmarkToggle"),
  bookmarksPanel: document.getElementById("bookmarksPanel"),
  clearBookmarksBtn: document.getElementById("clearBookmarksBtn"),
  scrollSentinel: document.getElementById("scrollSentinel")
};

const searchNews = debounce((value) => {
  state.searchQuery = value.trim();
  state.page = 1;
  state.hasMore = true;
  fetchAndRenderNews({ replace: true });
}, 450);

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  applySavedTheme();
  renderSkeletons();
  renderBookmarks();
  updateStats();
  attachEventListeners();

  if (!hasValidApiKey()) {
    renderSetupMessage();
    return;
  }

  fetchAndRenderNews({ replace: true });
  setupInfiniteScroll();
}

function attachEventListeners() {
  els.searchInput.addEventListener("input", (event) => {
    searchNews(event.target.value);
  });

  els.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.searchQuery = els.searchInput.value.trim();
    state.page = 1;
    state.hasMore = true;
    fetchAndRenderNews({ replace: true });
  });

  els.categoryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");

    if (!button || state.isLoading) {
      return;
    }

    const nextCategory = button.dataset.category;

    state.activeCategory = nextCategory;
    state.searchQuery = "";
    state.page = 1;
    state.hasMore = true;
    els.searchInput.value = "";

    document.querySelectorAll(".category-chip").forEach((chip) => {
      chip.classList.toggle("active", chip === button);
    });

    updateFeedHeading();
    fetchAndRenderNews({ replace: true });
  });

  els.themeToggle.addEventListener("click", toggleTheme);

  els.newsGrid.addEventListener("click", (event) => {
    const bookmarkBtn = event.target.closest("[data-bookmark-url]");

    if (!bookmarkBtn) {
      return;
    }

    const articleUrl = bookmarkBtn.dataset.bookmarkUrl;
    const article = state.articles.find((item) => item.url === articleUrl);

    if (!article) {
      return;
    }

    toggleBookmark(article);
  });

  els.bookmarkList.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-bookmark]");

    if (!removeBtn) {
      return;
    }

    removeBookmark(removeBtn.dataset.removeBookmark);
  });

  els.bookmarkToggle.addEventListener("click", () => {
    els.bookmarksPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.clearBookmarksBtn.addEventListener("click", () => {
    state.bookmarks = [];
    persistBookmarks();
    renderBookmarks();
    renderArticles();
    updateStats();
    showFeedback("Bookmarks cleared.", "info");
  });
}

async function fetchAndRenderNews({ replace = false } = {}) {
  if (!replace && (state.isLoading || !state.hasMore)) {
    return;
  }

  if (replace && state.abortController) {
    state.abortController.abort();
  }

  const requestId = ++state.lastRequestId;
  const controller = new AbortController();

  state.abortController = controller;
  state.isLoading = true;
  setLoadingState(true, replace);
  clearFeedback();
  toggleEmptyState(false);

  try {
    const endpoint = buildEndpoint();
    const response = await fetch(endpoint, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (requestId !== state.lastRequestId) {
      return;
    }

    const articles = normalizeArticles(data.articles || []);

    state.totalArticles = Number(data.totalArticles) || 0;
    state.hasMore = articles.length === state.pageSize;
    state.articles = replace ? articles : [...state.articles, ...articles];

    if (replace) {
      els.newsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    updateFeaturedStory();
    updateStats();
    updateFeedHeading();
    renderArticles();
    toggleEmptyState(state.articles.length === 0);

    if (articles.length > 0) {
      state.page += 1;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    console.error(error);
    showFeedback(
      "We couldn't load live news right now. Check your API key, usage limits, or network connection and try again.",
      "error"
    );
  } finally {
    if (requestId !== state.lastRequestId) {
      return;
    }

    state.isLoading = false;
    state.abortController = null;
    setLoadingState(false, replace);
  }
}

function buildEndpoint() {
  const url = new URL(state.searchQuery ? `${config.BASE_URL}/search` : `${config.BASE_URL}/top-headlines`);

  url.searchParams.set("apikey", config.API_KEY);
  url.searchParams.set("lang", config.DEFAULT_LANGUAGE || "en");
  url.searchParams.set("max", String(state.pageSize));
  url.searchParams.set("page", String(state.page));

  if (state.searchQuery) {
    url.searchParams.set("q", state.searchQuery);
    return url.toString();
  }

  const category = state.activeCategory === "general" ? "general" : state.activeCategory;
  url.searchParams.set("category", category);
  url.searchParams.set("country", config.DEFAULT_COUNTRY || "us");

  return url.toString();
}

function normalizeArticles(articles) {
  return articles
    .filter((article) => article.title && article.url)
    .map((article) => ({
      title: article.title,
      description: article.description || "No description available for this story yet.",
      image: article.image || "",
      url: article.url,
      source: article.source?.name || "Unknown source",
      publishedAt: article.publishedAt,
      content: article.content || article.description || ""
    }));
}

function renderArticles() {
  els.newsGrid.innerHTML = state.articles
    .map((article) => {
      const bookmarked = isBookmarked(article.url);

      return `
        <article class="news-card">
          <div class="card-image-wrap">
            ${
              article.image
                ? `<img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy" />`
                : `<div class="card-image-fallback"></div>`
            }
            <span class="card-badge">${escapeHtml(article.source)}</span>
          </div>
          <div class="card-content">
            <div class="card-meta">
              <span>${formatDate(article.publishedAt)}</span>
              <span>${state.searchQuery ? "Search result" : categoryLabels[state.activeCategory] || "Headline"}</span>
            </div>
            <h2 class="card-title">${escapeHtml(article.title)}</h2>
            <p class="card-description">${escapeHtml(article.description)}</p>
            <div class="card-footer">
              <a class="card-action primary" href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer">
                Read More
              </a>
              <div class="card-actions">
                <button
                  class="card-action secondary"
                  type="button"
                  data-bookmark-url="${escapeAttribute(article.url)}"
                >
                  ${bookmarked ? "Saved" : "Bookmark"}
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderBookmarks() {
  if (state.bookmarks.length === 0) {
    els.bookmarkList.innerHTML = `
      <div class="bookmark-card">
        <h3>No bookmarks yet</h3>
        <p>Save stories to build a quick reading list you can come back to later.</p>
      </div>
    `;
    return;
  }

  els.bookmarkList.innerHTML = state.bookmarks
    .map(
      (article) => `
        <article class="bookmark-card">
          <h3>${escapeHtml(article.title)}</h3>
          <p>${escapeHtml(article.description)}</p>
          <div class="bookmark-card__meta">
            <span>${escapeHtml(article.source)}</span>
            <span>${formatDate(article.publishedAt)}</span>
          </div>
          <div class="bookmark-card__footer">
            <a href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer">
              Open article
            </a>
            <button
              class="bookmark-card__remove"
              type="button"
              data-remove-bookmark="${escapeAttribute(article.url)}"
            >
              Remove
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function updateFeaturedStory() {
  const [firstArticle] = state.articles;

  if (!firstArticle) {
    return;
  }

  els.featuredTitle.textContent = firstArticle.title;
  els.featuredDescription.textContent = firstArticle.description;
}

function updateFeedHeading() {
  if (state.searchQuery) {
    els.feedLabel.textContent = `Search results for "${state.searchQuery}"`;
    els.feedSubtext.textContent = "Live results update as you type, with infinite scrolling for deeper browsing.";
    return;
  }

  els.feedLabel.textContent = categoryLabels[state.activeCategory] || "Top headlines";
  els.feedSubtext.textContent = "Fresh coverage from trusted sources around the world.";
}

function renderSkeletons() {
  els.skeletonGrid.innerHTML = Array.from({ length: state.pageSize })
    .map(
      () => `
        <div class="skeleton-card">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-body">
            <div class="skeleton-line title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
      `
    )
    .join("");
}

function setLoadingState(isLoading, replace) {
  els.loader.classList.toggle("hidden", !isLoading || replace);
  els.skeletonGrid.classList.toggle("hidden", !isLoading || !replace);
}

function toggleEmptyState(shouldShow) {
  els.emptyState.classList.toggle("hidden", !shouldShow);
}

function showFeedback(message, type = "info") {
  els.feedbackMessage.textContent = message;
  els.feedbackMessage.className = `feedback-message ${type}`;
}

function clearFeedback() {
  els.feedbackMessage.textContent = "";
  els.feedbackMessage.className = "feedback-message hidden";
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains("dark-theme") ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("newspulse-theme", nextTheme);
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem("newspulse-theme") || "light";
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const isDark = theme === "dark";

  document.body.classList.toggle("dark-theme", isDark);
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
  els.themeToggle.querySelector(".theme-toggle__icon").textContent = isDark ? "Light" : "Moon";
}

function toggleBookmark(article) {
  if (isBookmarked(article.url)) {
    removeBookmark(article.url);
    showFeedback("Removed from bookmarks.", "info");
    return;
  }

  state.bookmarks = [article, ...state.bookmarks];
  persistBookmarks();
  renderBookmarks();
  renderArticles();
  updateStats();
  showFeedback("Added to bookmarks.", "info");
}

function removeBookmark(url) {
  state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.url !== url);
  persistBookmarks();
  renderBookmarks();
  renderArticles();
  updateStats();
}

function isBookmarked(url) {
  return state.bookmarks.some((bookmark) => bookmark.url === url);
}

function persistBookmarks() {
  localStorage.setItem("newspulse-bookmarks", JSON.stringify(state.bookmarks));
}

function loadBookmarks() {
  try {
    const saved = localStorage.getItem("newspulse-bookmarks");
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error("Unable to load bookmarks", error);
    return [];
  }
}

function updateStats() {
  els.bookmarkCount.textContent = String(state.bookmarks.length);
  els.headlineCount.textContent = String(state.articles.length);
}

function renderSetupMessage() {
  showFeedback(
    "Add your GNews API key to config.js to unlock live headlines. The rest of the app is ready to go.",
    "info"
  );
  updateFeedHeading();
  toggleEmptyState(true);
}

function hasValidApiKey() {
  return Boolean(config.API_KEY) && config.API_KEY !== "PASTE_YOUR_GNEWS_API_KEY_HERE";
}

function formatDate(dateString) {
  if (!dateString) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(dateString));
}

function setupInfiniteScroll() {
  const observer = new IntersectionObserver(
    (entries) => {
      const [entry] = entries;

      if (entry.isIntersecting && !state.isLoading && state.hasMore) {
        fetchAndRenderNews({ replace: false });
      }
    },
    {
      rootMargin: "240px"
    }
  );

  observer.observe(els.scrollSentinel);
}

function debounce(callback, delay) {
  let timeoutId;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
