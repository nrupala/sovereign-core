/* Sovereign Core Documentation — interactive layer */

(function () {
  "use strict";

  const root = document.documentElement;
  const themeToggle = document.getElementById("theme-toggle");
  const menuToggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  const sidebarClose = document.getElementById("sidebar-close");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const navFilter = document.getElementById("nav-filter");
  const tocNav = document.getElementById("toc-nav");
  const breadcrumbs = document.getElementById("breadcrumbs");

  function setTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("sc-docs-theme", theme);
    } catch (e) {
      // localStorage may be unavailable
    }
  }

  function toggleTheme() {
    const current = root.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  }

  function initTheme() {
    let theme = "light";
    try {
      theme = localStorage.getItem("sc-docs-theme") || "";
    } catch (e) {
      theme = "";
    }
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    setTheme(theme);
  }

  function initMenu() {
    function openMenu() {
      sidebar.classList.add("open");
      sidebarOverlay.style.display = "block";
    }

    function closeMenu() {
      sidebar.classList.remove("open");
      sidebarOverlay.style.display = "none";
    }

    menuToggle.addEventListener("click", openMenu);
    sidebarClose.addEventListener("click", closeMenu);
    sidebarOverlay.addEventListener("click", closeMenu);
    window.addEventListener("resize", function () {
      if (window.innerWidth > 800) {
        closeMenu();
      }
    });
  }

  function initNavFilter() {
    navFilter.addEventListener("input", function () {
      const query = navFilter.value.trim().toLowerCase();
      const links = document.querySelectorAll(".nav-link");
      links.forEach(function (link) {
        const text = link.textContent.toLowerCase();
        link.style.display = text.includes(query) ? "" : "none";
      });
    });
  }

  function initTOC() {
    const headings = document.querySelectorAll(".article-body h2, .article-body h3, .article-body h4");
    if (!headings.length) {
      document.querySelector(".toc").style.display = "none";
      return;
    }

    const toc = document.createElement("nav");
    toc.className = "toc-nav";
    headings.forEach(function (heading) {
      if (!heading.id) {
        heading.id = heading.textContent
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");
      }
      const anchor = document.createElement("a");
      anchor.href = "#" + heading.id;
      anchor.textContent = heading.textContent;
      anchor.style.paddingLeft = (heading.tagName === "H3" ? "20px" : heading.tagName === "H4" ? "30px" : "10px");
      toc.appendChild(anchor);
    });

    const tocNav = document.getElementById("toc-nav");
    if (tocNav) {
      tocNav.innerHTML = "";
      tocNav.appendChild(toc);
    }
  }

  function initBreadcrumbs() {
    const title = document.querySelector(".page-title");
    if (!title || !breadcrumbs) {
      return;
    }
    breadcrumbs.innerHTML = "";
    const home = document.createElement("a");
    home.href = "index.html";
    home.textContent = "Documentation";
    breadcrumbs.appendChild(home);

    const separator = document.createElement("span");
    separator.textContent = " / ";
    breadcrumbs.appendChild(separator);

    const current = document.createElement("span");
    current.textContent = title.textContent;
    breadcrumbs.appendChild(current);
  }

  function initCopyButtons() {
    document.querySelectorAll("pre code").forEach(function (code) {
      const pre = code.parentElement;
      const button = document.createElement("button");
      button.className = "copy-btn";
      button.textContent = "Copy";
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(code.textContent).then(function () {
          button.textContent = "Copied";
          setTimeout(function () {
            button.textContent = "Copy";
          }, 1500);
        }).catch(function () {
          button.textContent = "Copy failed";
        });
      });
      pre.appendChild(button);
    });
  }

  function initCodeLangLabels() {
    document.querySelectorAll("pre code").forEach(function (code) {
      const pre = code.parentElement;
      const lang = code.className.replace("language-", "");
      pre.setAttribute("data-lang", lang || "code");
    });
  }

  function init() {
    initTheme();
    themeToggle.addEventListener("click", toggleTheme);
    initMenu();
    initNavFilter();
    initTOC();
    initBreadcrumbs();
    initCopyButtons();
    initCodeLangLabels();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
