// js/theme.js

/**
 * Handles Dark/Light mode theme switching and persistence.
 */
document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtns = document.querySelectorAll('#theme-toggle, #theme-toggle-sidebar');
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

    // Function to set the theme
    const setTheme = (theme) => {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            updateIcons('dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            updateIcons('light');
        }
    };

    // Update icons in toggle buttons
    const updateIcons = (theme) => {
        themeToggleBtns.forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) {
                if (theme === 'dark') {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                } else {
                    icon.classList.remove('fa-sun');
                    icon.classList.add('fa-moon');
                }
            }
        });
    };

    // Determine initial theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        setTheme(savedTheme);
    } else {
        // Fallback to system preference
        setTheme(prefersDarkScheme.matches ? 'dark' : 'light');
    }

    // Toggle listener
    themeToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            setTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    });
});
