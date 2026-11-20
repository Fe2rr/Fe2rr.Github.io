/*
 * NAPL — CLEAN LIGHT / DARK THEME TOGGLE
 */

const STORAGE_KEY = "napl_theme_v1";

const SUN_SVG = `<svg class="theme-toggle-icon" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;

const MOON_SVG = `<svg class="theme-toggle-icon" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;

let fallbackTransitionTimer = 0;

function prefersReducedMotion() {
    try {
        return Boolean(
            window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    } catch {
        return false;
    }
}

function triggerToggleFeedback(button) {
    if (!button || prefersReducedMotion()) return;
    button.classList.remove("is-switching");
    void button.offsetWidth;
    button.classList.add("is-switching");
}

function readSavedTheme() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "light" || saved === "dark") return saved;
    } catch {
        // Ignore storage access issues
    }
    return "dark";
}

function setTheme(theme, button, animate = false) {
    const mode = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", mode);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute("content", mode === "light" ? "#ffffff" : "#11221b");
    }

    if (button) {
        const isLight = mode === "light";
        button.innerHTML = `${isLight ? MOON_SVG : SUN_SVG}<span class="theme-toggle-label">${isLight ? "Dark" : "Light"}</span>`;
        button.setAttribute(
            "aria-label",
            isLight ? "Cambiar a modo oscuro" : "Cambiar a modo claro"
        );
        button.setAttribute(
            "title",
            isLight ? "Cambiar a modo oscuro" : "Cambiar a modo claro"
        );
        button.setAttribute("aria-pressed", String(isLight));

        if (animate) {
            triggerToggleFeedback(button);
        }
    }
}

function applyThemeWithTransition(next, button) {
    if (prefersReducedMotion()) {
        setTheme(next, button, false);
        return;
    }

    if (typeof document.startViewTransition === "function") {
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );
        const root = document.documentElement;

        try {
            root.classList.add("is-radial-theme-transition");
            const transition = document.startViewTransition(() => {
                setTheme(next, button, true);
            });

            transition.ready
                .then(() => {
                    root.animate(
                        {
                            clipPath: [
                                `circle(0px at ${x}px ${y}px)`,
                                `circle(${endRadius}px at ${x}px ${y}px)`,
                            ],
                        },
                        {
                            duration: 420,
                            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                            pseudoElement: "::view-transition-new(root)",
                        }
                    );
                })
                .catch(() => {
                    // Ignore aborted view transitions on rapid double-clicks
                });

            if (transition.finished && typeof transition.finished.finally === "function") {
                transition.finished
                    .finally(() => {
                        root.classList.remove("is-radial-theme-transition");
                    })
                    .catch(() => {
                        // Ignore aborted view transitions
                    });
            } else {
                window.setTimeout(() => {
                    root.classList.remove("is-radial-theme-transition");
                }, 460);
            }
            return;
        } catch {
            root.classList.remove("is-radial-theme-transition");
            // Fall through to CSS color transition fallback
        }
    }

    const root = document.documentElement;
    if (fallbackTransitionTimer) {
        clearTimeout(fallbackTransitionTimer);
    }
    root.classList.add("is-theme-transitioning");
    setTheme(next, button, true);
    fallbackTransitionTimer = window.setTimeout(() => {
        root.classList.remove("is-theme-transitioning");
        fallbackTransitionTimer = 0;
    }, 340);
}

export function initThemeToggle() {
    const button = document.getElementById("theme-toggle");
    setTheme(readSavedTheme(), button, false);

    if (!button) return;

    button.addEventListener("click", () => {
        const current =
            document.documentElement.getAttribute("data-theme") === "light"
                ? "light"
                : "dark";
        const next = current === "light" ? "dark" : "light";

        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Ignore storage access issues
        }

        applyThemeWithTransition(next, button);
    });
}
