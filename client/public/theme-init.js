// Apply the saved theme before first paint so there is no flash of the wrong one.
// A separate file (not an inline script) so the Content-Security-Policy can stay `script-src 'self'`.
try {
  var t = JSON.parse(localStorage.getItem('agentverse.theme') || '"dark"');
  document.documentElement.classList.toggle('dark', t !== 'light');
} catch (e) {}
