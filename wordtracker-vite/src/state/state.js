import { parseYMD, ymdUTC, ymdLocal } from '../utils/dates.js';
import { THEMES, DEFAULT_THEME, themeIds } from '../theme/themes.js';

export { THEMES };
export const STORAGE_KEY = 'nano-forest-v5';
export const PREFS_KEY = 'nano-forest-prefs';

function createDefaultProject() {
  const year = new Date().getUTCFullYear();
  return {
    name: 'NaNo 2025',
    goalWords: 50000,
    startDate: new Date(Date.UTC(year, 10, 1)),
    endDate: new Date(Date.UTC(year, 10, 30)),
    baselineWords: 0,
  };
}

export const state = {
  project: createDefaultProject(),
  entries: {},
  timeWarp: null,
  theme: DEFAULT_THEME,
};

export const normalizeTheme = (value) => (themeIds.includes(value) ? value : DEFAULT_THEME);

export function saveLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      project: state.project,
      entries: state.entries,
      timeWarp: state.timeWarp,
      theme: state.theme,
    })
  );
  savePreferences();
}

export function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project) {
      state.project.name = parsed.project.name ?? state.project.name;
      state.project.goalWords = parsed.project.goalWords ?? state.project.goalWords;
      state.project.startDate = parsed.project.startDate ? new Date(parsed.project.startDate) : state.project.startDate;
      state.project.endDate = parsed.project.endDate ? new Date(parsed.project.endDate) : state.project.endDate;
      state.project.baselineWords = Number(parsed.project.baselineWords ?? state.project.baselineWords) || 0;
    }
    if (parsed.entries) state.entries = parsed.entries;
    if (parsed.timeWarp) state.timeWarp = parsed.timeWarp;
    if (parsed.theme) state.theme = normalizeTheme(parsed.theme);
  } catch (err) {
    console.warn('Failed to load state from storage', err);
  }
  state.theme = normalizeTheme(state.theme);
}

export function savePreferences() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      timeWarp: state.timeWarp,
      theme: state.theme,
    })
  );
}

export function loadPreferences() {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.timeWarp) state.timeWarp = parsed.timeWarp;
    if (parsed.theme) state.theme = normalizeTheme(parsed.theme);
  } catch (err) {
    console.warn('Failed to load preferences', err);
  }
  state.theme = normalizeTheme(state.theme);
}

export const viewingDay = () => (state.timeWarp ? state.timeWarp : ymdLocal(new Date()));

export const inRange = (ymd) => {
  const date = parseYMD(ymd);
  return date >= state.project.startDate && date <= state.project.endDate;
};

export function resetProjectData() {
  Object.assign(state.project, createDefaultProject());
  state.entries = {};
}
