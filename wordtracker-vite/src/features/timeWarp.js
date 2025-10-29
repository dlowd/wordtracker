import { state, viewingDay, savePreferences } from '../state/state.js';
import { fmtMD } from '../utils/dates.js';

let lastPreviewDate = null;
let popoverOpen = false;
let anchorEl = null;
let popoverEl = null;
let cleanup = null;

export function initTimeWarpState() {
  if (state.timeWarp) lastPreviewDate = state.timeWarp;
}

export function updateCurrentDateDisplay(currentDateInfo) {
  if (!currentDateInfo) return;
  const now = new Date();
  const local = now.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
  const offsetMinutes = now.getTimezoneOffset();
  const sign = offsetMinutes > 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  currentDateInfo.textContent = `${local} (UTC: ${sign}${hh}${mm})`;
}

export function syncTimeWarpControls(warpToggle, warpDate, viewBadge, currentDateInfo) {
  const active = !!state.timeWarp;
  if (currentDateInfo) updateCurrentDateDisplay(currentDateInfo);
  if (warpToggle) warpToggle.checked = active;
  if (warpDate) {
    warpDate.disabled = !active;
    if (active) {
      if (state.timeWarp) {
        lastPreviewDate = state.timeWarp;
        if (warpDate.value !== state.timeWarp) warpDate.value = state.timeWarp;
      }
    } else if (!warpDate.value) {
      warpDate.value = lastPreviewDate || viewingDay();
    }
  }
  if (viewBadge) {
    const label = active && state.timeWarp ? state.timeWarp : null;
    viewBadge.setAttribute('aria-pressed', active ? 'true' : 'false');
    const display = active && label ? `⏳ ${fmtMD(label)}` : fmtMD(viewingDay());
    viewBadge.textContent = `Date: ${display}`;
    viewBadge.setAttribute('aria-expanded', popoverOpen ? 'true' : 'false');
  }
}

export function closeTimeWarpPopover() {
  if (!popoverOpen) return;
  setPopoverVisible(false);
}

function setPopoverVisible(visible) {
  if (!popoverEl || !anchorEl) {
    popoverOpen = visible;
    return;
  }
  if (popoverOpen === visible) {
    if (!visible) {
      anchorEl.setAttribute('aria-expanded', 'false');
      anchorEl = null;
      popoverEl = null;
    }
    return;
  }
  popoverOpen = visible;
  anchorEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (visible) {
    popoverEl.classList.add('show');
    popoverEl.setAttribute('aria-hidden', 'false');
    positionPopover();
    const onPointerDown = (event) => {
      if (!popoverEl.contains(event.target) && event.target !== anchorEl) {
        setPopoverVisible(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPopoverVisible(false);
        anchorEl.focus();
      }
    };
    const onReposition = () => positionPopover();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    cleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      cleanup = null;
    };
  } else {
    popoverEl.classList.remove('show');
    popoverEl.setAttribute('aria-hidden', 'true');
    if (cleanup) cleanup();
    anchorEl = null;
    popoverEl = null;
  }
}

function positionPopover() {
  if (!anchorEl || !popoverEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const previousDisplay = popoverEl.style.display;
  const previousVisibility = popoverEl.style.visibility;
  if (!popoverEl.classList.contains('show')) {
    popoverEl.style.display = 'block';
    popoverEl.style.visibility = 'hidden';
  }
  const width = popoverEl.offsetWidth || 280;
  const top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;
  if (left + width > window.scrollX + window.innerWidth - 16) {
    left = window.scrollX + window.innerWidth - width - 16;
  }
  left = Math.max(left, window.scrollX + 16);
  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
  if (!popoverEl.classList.contains('show')) {
    popoverEl.style.display = previousDisplay;
    popoverEl.style.visibility = previousVisibility;
  }
}

export function setupTimeWarp({ warpToggle, warpDate, viewBadge, warpPopover, currentDateInfo }, update) {
  if (viewBadge && warpPopover) {
    viewBadge.setAttribute('role', 'button');
    viewBadge.setAttribute('aria-haspopup', 'dialog');
    viewBadge.setAttribute('aria-expanded', 'false');
    viewBadge.tabIndex = 0;
    const toggle = () => {
      anchorEl = viewBadge;
      popoverEl = warpPopover;
      updateCurrentDateDisplay(currentDateInfo);
      syncTimeWarpControls(warpToggle, warpDate, viewBadge, currentDateInfo);
      setPopoverVisible(!popoverOpen);
    };
    viewBadge.addEventListener('click', (event) => {
      event.preventDefault();
      toggle();
    });
    viewBadge.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  }

  if (warpToggle) {
    warpToggle.addEventListener('change', () => {
      if (warpToggle.checked) {
        const candidate = warpDate?.value || lastPreviewDate || viewingDay();
        state.timeWarp = candidate;
        lastPreviewDate = candidate;
        savePreferences();
      } else {
        lastPreviewDate = warpDate?.value || lastPreviewDate;
        state.timeWarp = null;
        savePreferences();
      }
      update();
    });
  }

  if (warpDate) {
    warpDate.addEventListener('change', () => {
      lastPreviewDate = warpDate.value || lastPreviewDate;
      if (warpToggle?.checked) {
        state.timeWarp = warpDate.value || null;
        savePreferences();
        update();
      }
    });
  }
}
