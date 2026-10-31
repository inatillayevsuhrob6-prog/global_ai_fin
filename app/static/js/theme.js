(() => {
    const storageKey = "global-ai-fin-theme-v2";
    const root = document.documentElement;

    function applyTheme(theme) {
        const isDark = theme === "dark";
        root.dataset.theme = isDark ? "dark" : "light";
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute("content", isDark ? "#071226" : "#f5f7fc");
        document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
            const icon = button.querySelector("[data-theme-icon]");
            const label = button.querySelector("[data-theme-label]");
            button.setAttribute(
                "aria-label",
                isDark ? "Yorug' mavzuga o'tish" : "Qorong'i mavzuga o'tish"
            );
            button.setAttribute("aria-pressed", String(isDark));
            if (label) label.textContent = isDark ? "Yorug'" : "Qorong'i";
            if (icon) icon.setAttribute("data-lucide", isDark ? "sun" : "moon");
        });
        if (window.lucide) window.lucide.createIcons();
    }

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const next = root.dataset.theme === "dark" ? "light" : "dark";
            localStorage.setItem(storageKey, next);
            applyTheme(next);
        });
    });

    applyTheme(root.dataset.theme);
})();
