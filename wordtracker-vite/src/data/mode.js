export const MODES = {
  LOCAL: 'local',
  CLOUD: 'cloud',
};

const MODE_KEY = 'wordtracker-mode';

export function getStoredMode() {
  const value = localStorage.getItem(MODE_KEY);
  return value === MODES.LOCAL || value === MODES.CLOUD ? value : null;
}

export function setStoredMode(mode) {
  if (mode === MODES.LOCAL || mode === MODES.CLOUD) {
    localStorage.setItem(MODE_KEY, mode);
  } else {
    throw new Error(`Invalid mode: ${mode}`);
  }
}

export function clearStoredMode() {
  localStorage.removeItem(MODE_KEY);
}
