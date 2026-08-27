// Level names come from a text field and go into markup, so they get escaped.
// Shared by the panel and the library rather than written twice.
export function esc(s) {
  return String(s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
