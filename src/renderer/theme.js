// Theme management

export function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('portal-theme', isLight ? 'light' : 'dark');
}

export function loadTheme() {
  const saved = localStorage.getItem('portal-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
}
