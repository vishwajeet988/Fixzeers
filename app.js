const API_BASE = "http://localhost:4000/api";

/* =========================
   BASIC HELPERS
========================= */

function toast(message) {
  const t = document.querySelector(".toast");

  if (!t) {
    alert(message);
    return;
  }

  t.textContent = message;
  t.style.display = "block";

  setTimeout(() => {
    t.style.display = "none";
  }, 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

function getToken() {
  return localStorage.getItem("fixzeers_token");
}

function saveToken(token) {
  localStorage.setItem("fixzeers_token", token);
}

function logout() {
  localStorage.removeItem("fixzeers_token");
  localStorage.removeItem("fixzeers_user");
  window.location.href = "index.html";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getInitials(name) {
  return String(name || "Fixzeer")
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}


/* =========================
   CATEGORIES
========================= */

async function loadCategories() {
  const container = document.querySelector(".grid.grid-4");

  if (!container) return;

  try {
    const data = await api("/categories");

    if (!data.categories || !data.categories.length) {
      return;
    }

    const icons = {
      electrician: "⚡",
      plumber: "🔧",
      "ac-technician": "❄️",
      mechanic: "🔩",
      painter: "🎨",
      carpenter: "🪚",
      "home-helper": "🧹",
      "other-services": "🛠️"
    };

    const descriptions = {
      electrician: "Switches, wiring & repairs",
      plumber: "Leaks, taps & fittings",
      "ac-technician": "Service & installation",
      mechanic: "Cars, bikes & diagnostics",
      painter: "Homes & commercial spaces",
      carpenter: "Furniture & woodwork",
      "home-helper": "Everyday household help",
      "other-services": "More local professionals"
    };

    container.innerHTML = data.categories.map(category => `
      <a class="card category"
         href="search.html?q=${encodeURIComponent(category.slug)}">
        <span class="icon">${icons[category.slug] || "🛠️"}</span>
        <span>
          <strong>${escapeHtml(category.name)}</strong><br>
          <small class="muted">
            ${escapeHtml(
              descriptions[category.slug] ||
              "Local professional services"
            )}
          </small>
        </span>
      </a>
    `).join("");
  } catch (error) {
    console.error("Category loading failed:", error);
  }
}


/* =========================
   HOMEPAGE PROFESSIONALS
========================= */

async function loadProfessionals() {
  const cards = document.querySelectorAll(".worker");

  // Search page creates its cards dynamically.
  if (!cards.length || document.querySelector("#professionalsList")) {
    return;
  }

  try {
    const data = await api("/professionals");

    if (!data.professionals || !data.professionals.length) {
      return;
    }

    const professionals = data.professionals.slice(0, 3);

    cards.forEach((card, index) => {
      const professional = professionals[index];

      if (!professional) {
        card.style.display = "none";
        return;
      }

      const name = professional.name || "Fixzeer Professional";
      const initials = getInitials(name);
      const score = Number(professional.score || 0);
      const rating = Number(professional.average_rating || 0);
      const jobs = Number(professional.verified_jobs || 0);
      const experience = Number(professional.years_experience || 0);

      const avatar = card.querySelector(".avatar");
      const title = card.querySelector("h3");
      const muted = card.querySelector(".muted");
      const scoreEl = card.querySelector(".score");
      const meta = card.querySelector(".worker-meta");

      if (avatar) avatar.textContent = initials;
      if (title) title.textContent = name;

      if (muted) {
        muted.textContent =
          `${professional.category || "Service Professional"} • ${experience} years`;
      }

      if (scoreEl) scoreEl.textContent = score;

      if (meta) {
        meta.innerHTML = `
          <span>
            <span class="stars">★</span>
            ${rating ? rating.toFixed(1) : "New"} •
            ${jobs} verified jobs
          </span>
          <span>${escapeHtml(professional.service_area || "Bhopal")}</span>
        `;
      }

      const profileLink = card.querySelector("a");

      if (profileLink) {
        profileLink.href =
          `professional.html?id=${encodeURIComponent(professional.id)}`;
      }
    });
  } catch (error) {
    console.error("Professional loading failed:", error);
  }
}


/* =========================
   HOMEPAGE SEARCH
========================= */

function setupSearch() {
  const search = document.querySelector("#serviceSearch");

  if (!search) return;

  search.addEventListener("submit", event => {
    event.preventDefault();

    const input = document.querySelector("#searchInput");
    const q = input ? input.value.trim() : "";

    window.location.href =
      "search.html" + (q ? `?q=${encodeURIComponent(q)}` : "");
  });

  document.querySelectorAll("[data-fill]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.querySelector("#searchInput");

      if (!input) return;

      input.value = button.dataset.fill || "";
      input.focus();
    });
  });
}


/* =========================
   SEARCH PAGE
========================= */

async function setupSearchPage() {
  const resultsContainer =
    document.querySelector("#professionalsList");

  if (!resultsContainer) return;

  const params =
    new URLSearchParams(window.location.search);

  const initialQuery = params.get("q") || "";
  const searchInput =
    document.querySelector("#searchInput");

  if (searchInput && initialQuery) {
    searchInput.value = initialQuery;
  }

  await loadSearchCategories();
  setupSearchFilters();
  await performProfessionalSearch();
}


/* =========================
   SEARCH CATEGORIES
========================= */

async function loadSearchCategories() {
  const select =
    document.querySelector("#categoryFilter");

  if (!select) return;

  try {
    const data = await api("/categories");

    if (!data.categories || !data.categories.length) {
      return;
    }

    select.innerHTML = `
      <option value="">All categories</option>
      ${data.categories.map(category => `
        <option value="${escapeHtml(category.slug)}">
          ${escapeHtml(category.name)}
        </option>
      `).join("")}
    `;

    const params =
      new URLSearchParams(window.location.search);

    const category = params.get("category");

    if (category) {
      select.value = category;
    }
  } catch (error) {
    console.error("Search category loading failed:", error);
  }
}


/* =========================
   SEARCH FILTERS
========================= */

function setupSearchFilters() {
  const searchForm =
    document.querySelector("#searchForm");

  if (searchForm) {
    searchForm.addEventListener("submit", event => {
      event.preventDefault();
      performProfessionalSearch();
    });
  }

  const applyButton =
    document.querySelector("#applyFilters");

  if (applyButton) {
    applyButton.addEventListener("click", event => {
      event.preventDefault();
      performProfessionalSearch();
    });
  }

  const clearButton =
    document.querySelector("#clearFilters");

  if (clearButton) {
    clearButton.addEventListener("click", event => {
      event.preventDefault();

      const input =
        document.querySelector("#searchInput");
      const category =
        document.querySelector("#categoryFilter");
      const area =
        document.querySelector("#areaFilter");
      const score =
        document.querySelector("#scoreFilter");

      if (input) input.value = "";
      if (category) category.value = "";
      if (area) area.value = "";
      if (score) score.value = "0";

      window.history.replaceState({}, "", "search.html");

      updateSearchTitle("", 0);
      performProfessionalSearch();
    });
  }
}


/* =========================
   PERFORM SEARCH
========================= */

async function performProfessionalSearch() {
  const container =
    document.querySelector("#professionalsList");

  if (!container) return;

  const loading =
    document.querySelector("#loadingState");

  const empty =
    document.querySelector("#emptyState");

  const input =
    document.querySelector("#searchInput");

  const category =
    document.querySelector("#categoryFilter");

  const area =
    document.querySelector("#areaFilter");

  const scoreFilter =
    document.querySelector("#scoreFilter");

  const q = input ? input.value.trim() : "";
  const categoryValue = category ? category.value : "";
  const areaValue = area ? area.value : "";
  const minimumScore =
    scoreFilter ? Number(scoreFilter.value || 0) : 0;

  if (loading) {
    loading.style.display = "block";
  }

  if (empty) {
    empty.style.display = "none";
  }

  container.innerHTML = "";

  try {
    const queryParams = new URLSearchParams();

    if (q) queryParams.set("q", q);
    if (categoryValue) queryParams.set("category", categoryValue);
    if (areaValue) queryParams.set("area", areaValue);

    const data =
      await api(`/professionals?${queryParams.toString()}`);

    let professionals = data.professionals || [];

    professionals = professionals.filter(
      professional =>
        Number(professional.score || 0) >= minimumScore
    );

    updateSearchUrl(
      q,
      categoryValue,
      areaValue,
      minimumScore
    );

    updateSearchTitle(q, professionals.length);

    if (loading) {
      loading.style.display = "none";
    }

    if (!professionals.length) {
      if (empty) {
        empty.style.display = "block";
      }
      return;
    }

    container.innerHTML = professionals
      .map(createProfessionalCard)
      .join("");

  } catch (error) {
    console.error("Professional search failed:", error);

    if (loading) {
      loading.style.display = "none";
    }

    if (empty) {
      empty.style.display = "none";
    }

    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px">
        <h3>Unable to load professionals</h3>
        <p class="muted">
          Please make sure the Fixzeers backend is running.
        </p>
        <button
          class="btn btn-primary"
          onclick="location.reload()">
          Try again
        </button>
      </div>
    `;
  }
}


/* =========================
   PROFESSIONAL CARD
========================= */

function createProfessionalCard(professional) {
  const name =
    professional.name || "Fixzeer Professional";

  const initials = getInitials(name);

  const score =
    Number(professional.score || 0);

  const rating =
    Number(professional.average_rating || 0);

  const jobs =
    Number(professional.verified_jobs || 0);

  const experience =
    Number(professional.years_experience || 0);

  const completion =
    Number(professional.completion_rate || 0);

  const skills =
    Array.isArray(professional.skills)
      ? professional.skills
      : [];

  const verified =
    ["verified", "trusted", "top"].includes(
      professional.verification_status
    );

  return `
    <article class="card worker search-worker">

      <div class="worker-top">

        <div class="avatar">
          ${escapeHtml(initials)}
        </div>

        <div class="grow">

          <h3>
            ${escapeHtml(name)}
          </h3>

          <div class="muted">
            ${escapeHtml(
              professional.category ||
              "Service Professional"
            )}
            ${experience ? ` • ${experience} years experience` : ""}
          </div>

          <span class="tag">
            ${verified ? "✓ Verified profile" : "New profile"}
          </span>

        </div>

        <div class="score">
          ${score}
        </div>

      </div>

      <div class="worker-meta">

        <span>
          <span class="stars">★</span>
          ${rating ? rating.toFixed(1) : "New"}
          • ${jobs.toLocaleString()} verified jobs
        </span>

        <span>
          ${escapeHtml(
            professional.service_area || "Bhopal"
          )}
        </span>

      </div>

      ${
        professional.bio
          ? `
            <p>
              ${escapeHtml(professional.bio)}
            </p>
          `
          : ""
      }

      ${
        skills.length
          ? `
            <div class="skills">
              ${skills.slice(0, 5).map(skill => `
                <span class="skill">
                  ${escapeHtml(skill)}
                </span>
              `).join("")}
            </div>
          `
          : ""
      }

      <div class="worker-meta">
        <span>
          Completion: ${completion.toFixed(0)}%
        </span>

        <span>
          ${escapeHtml(
            professional.availability || ""
          )}
        </span>
      </div>

      <a
        class="btn btn-light"
        style="width:100%;margin-top:18px"
        href="professional.html?id=${encodeURIComponent(
          professional.id
        )}">
        View profile
      </a>

    </article>
  `;
}


/* =========================
   SEARCH URL
========================= */

function updateSearchUrl(q, category, area, score) {
  const params = new URLSearchParams();

  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (area) params.set("area", area);
  if (score) params.set("score", score);

  const query = params.toString();

  window.history.replaceState(
    {},
    "",
    query ? `search.html?${query}` : "search.html"
  );
}


/* =========================
   SEARCH TITLE
========================= */

function updateSearchTitle(q, resultCount) {
  const title =
    document.querySelector("#resultsTitle");

  if (title) {
    title.textContent = q
      ? `Professionals for "${q}"`
      : "Trusted local professionals";
  }

  const count =
    document.querySelector("#resultsCount");

  if (count) {
    count.textContent =
      `${resultCount} professional${resultCount === 1 ? "" : "s"} found`;
  }
}


/* =========================
   LOGIN USER
========================= */

async function checkLoggedInUser() {
  const token = getToken();

  if (!token) return null;

  try {
    const data =
      await api("/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

    if (data.user) {
      localStorage.setItem(
        "fixzeers_user",
        JSON.stringify(data.user)
      );
    }

    return data.user;
  } catch {
    localStorage.removeItem("fixzeers_token");
    localStorage.removeItem("fixzeers_user");
    return null;
  }
}


/* =========================
   TOAST BUTTONS
========================= */

function setupToastButtons() {
  document
    .querySelectorAll("[data-toast]")
    .forEach(element => {
      element.addEventListener("click", event => {
        event.preventDefault();
        toast(element.dataset.toast);
      });
    });
}


/* =========================
   INITIALIZE
========================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    setupSearch();
    setupToastButtons();

    await loadCategories();
    await loadProfessionals();
    await setupSearchPage();
    await checkLoggedInUser();
  }
);
