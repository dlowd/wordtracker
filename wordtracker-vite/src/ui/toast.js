let toastTimer = null;

export function flashToast(toastEl, message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  clearTimeout(toastTimer);
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}
