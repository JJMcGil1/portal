// Pure utility functions

export function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;

  if (/^[^\s]+\.[^\s]+$/.test(url) && !url.startsWith('http')) {
    url = 'https://' + url;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }

  return url;
}

export function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function getInitial(url) {
  const domain = getDomain(url);
  return domain.charAt(0).toUpperCase();
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
