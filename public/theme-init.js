// Applies the saved (or system) colour theme before first paint, so there is no light/dark flash.
// Kept as a separate file because the Content-Security-Policy forbids inline scripts.
try {
  var t = localStorage.getItem('th:theme');
  if (t === '"dark"' || t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) { /* storage blocked: stay with the default theme */ }
