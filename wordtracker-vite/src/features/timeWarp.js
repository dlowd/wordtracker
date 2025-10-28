import { state, viewingDay } from '../state/state.js';
import { fmtMD, ymdUTC } from '../utils/dates.js';
import { openOverlay, closeOverlay } from '../ui/overlay.js';

let lastPreviewDate = null;

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

export function syncTimeWarpControls(warpToggle, warpDate, viewBadge) {
  const active = !!state.timeWarp;
  if (warpToggle) warpToggle.checked = active;
  if (warpDate) {
    warpDate.disabled = !active;
    if (active) {
      if (state.timeWarp) {
        lastPreviewDate = state.timeWarp;
        if (warpDate.value !== state.timeWarp) warpDate.value = state.timeWarp;
      }
    } else if (!warpDate.value) {
      warpDate.value = lastPreviewDate || ymdUTC(new Date());
    }
  }
  if (viewBadge) {
    const label = active && state.timeWarp ? state.timeWarp : null;
    viewBadge.setAttribute('aria-pressed', active ? 'true' : 'false');
    const display = active && label ? `⏳ ${fmtMD(label)}` : fmtMD(viewingDay());
    viewBadge.textContent = `Date: ${display}`;
  }
}

export function setupTimeWarp({ warpToggle, warpDate, viewBadge, warpOverlay, closeWarp, currentDateInfo }, update) {
  if (viewBadge && warpOverlay) {
    viewBadge.setAttribute('role', 'button');
    viewBadge.tabIndex = 0;
    const open = () => {
      updateCurrentDateDisplay(currentDateInfo);
      syncTimeWarpControls(warpToggle, warpDate, viewBadge);
      openOverlay(warpOverlay);
    };
    viewBadge.addEventListener('click', open);
    viewBadge.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  }

  if (closeWarp && warpOverlay) {
    closeWarp.addEventListener('click', () => closeOverlay(warpOverlay));
  }

  if (warpToggle) {
    warpToggle.addEventListener('change', () => {
      if (warpToggle.checked) {
        const candidate = warpDate?.value || lastPreviewDate || viewingDay();
        state.timeWarp = candidate;
        lastPreviewDate = candidate;
      } else {
        lastPreviewDate = warpDate?.value || lastPreviewDate;
        state.timeWarp = null;
      }
      update();
    });
  }

  if (warpDate) {
    warpDate.addEventListener('change', () => {
      lastPreviewDate = warpDate.value || lastPreviewDate;
      if (warpToggle?.checked) {
        state.timeWarp = warpDate.value || null;
        update();
      }
    });
  }
}
