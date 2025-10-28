import { requireElement } from './dom.js';

function focusableElements(root) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
}

export function openOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.add('show');
  overlay.addEventListener('click', onBackdrop);
  overlay.addEventListener('keydown', onOverlayKey);
  const panel = requireElement(overlay.querySelector('[data-panel]'), 'overlay panel');
  const items = focusableElements(panel);
  if (items[0]) items[0].focus();
  overlay._trap = (event) => {
    if (event.key !== 'Tab') return;
    const focusables = focusableElements(panel);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  };
  panel.addEventListener('keydown', overlay._trap);
}

export function closeOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.removeEventListener('click', onBackdrop);
  overlay.removeEventListener('keydown', onOverlayKey);
  const panel = overlay.querySelector('[data-panel]');
  if (panel && overlay._trap) panel.removeEventListener('keydown', overlay._trap);
}

function onBackdrop(event) {
  if (event.currentTarget === event.target) {
    closeOverlay(event.currentTarget);
  }
}

function onOverlayKey(event) {
  if (event.key === 'Escape') {
    closeOverlay(event.currentTarget);
  }
}
