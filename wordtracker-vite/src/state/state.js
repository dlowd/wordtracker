import { parseYMD, ymdUTC } from '../utils/dates.js';

export const STORAGE_KEY = 'nano-forest-v5';
export const THEMES = ['spruce', 'midnight', 'sunset'];

export const state = {
  project: {
    name: 'NaNo 2025',
    goalWords: 50000,
    startDate: new Date(Date.UTC(new Date().getUTCFullYear(), 10, 1)),
    endDate: new Date(Date.UTC(new Date().getUTCFullYear(), 10, 30)),
  },
  entries: {},
  timeWarp: null,
  theme: 'spruce',
};

export const normalizeTheme = (value) => (THEMES.includes(value) ? value : 'spruce');

export function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      project: state.project,
      entries: state.entries,
      timeWarp: state.timeWarp,
      theme: state.theme,
    })
  );
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project) {
      state.project.name = parsed.project.name ?? state.project.name;
      state.project.goalWords = parsed.project.goalWords ?? state.project.goalWords;
      state.project.startDate = parsed.project.startDate ? new Date(parsed.project.startDate) : state.project.startDate;
      state.project.endDate = parsed.project.endDate ? new Date(parsed.project.endDate) : state.project.endDate;
    }
    if (parsed.entries) state.entries = parsed.entries;
    if (parsed.timeWarp) state.timeWarp = parsed.timeWarp;
    if (parsed.theme) state.theme = normalizeTheme(parsed.theme);
  } catch (err) {
    console.warn('Failed to load state from storage', err);
  }
  state.theme = normalizeTheme(state.theme);
}

export const viewingDay = () => (state.timeWarp ? state.timeWarp : ymdUTC(new Date()));

export const inRange = (ymd) => {
  const date = parseYMD(ymd);
  return date >= state.project.startDate && date <= state.project.endDate;
};
