import {
  state,
  loadLocalState,
  saveLocalState,
  loadPreferences,
  savePreferences,
  resetProjectData,
  STORAGE_KEY,
  viewingDay,
  normalizeTheme,
  inRange,
  THEMES,
} from '../state/state.js';
import { elements } from '../ui/dom.js';
import { flashToast } from '../ui/toast.js';
import { createHistory } from '../state/history.js';
import { openOverlay, closeOverlay } from '../ui/overlay.js';
import { supabase } from '../supabase/client.js';
import {
  initTimeWarpState,
  syncTimeWarpControls,
  updateCurrentDateDisplay,
  setupTimeWarp,
  closeTimeWarpPopover,
} from '../features/timeWarp.js';
import { MODES, getStoredMode, setStoredMode } from '../data/mode.js';
import {
  ymdUTC,
  parseYMD,
  datesInRangeUTC,
  fmtMD,
} from '../utils/dates.js';
import { createChartRenderer } from '../ui/chart.js';

const history = createHistory();
let entryInputRefs = {};
let serverEntriesSnapshot = {};
const syncTimers = {};
let lastSyncedAt = null;
let syncStatusInterval = null;
let remoteSupportsBaseline = true;
let baselineWarningShown = false;
let activeMode = null;
let actionsMenuVisible = false;
let actionsMenuCleanup = null;
let loginPending = false;
let pendingEmail = '';

let projectId = null;
let realtimeSub = null;
let projectRealtimeSub = null;

const chartRenderer = createChartRenderer(elements.chart, elements.tooltip);

const isLocalMode = () => activeMode === MODES.LOCAL;
const isCloudMode = () => activeMode === MODES.CLOUD;

function setAppInteractivity(enabled) {
  const disabled = !enabled;
  const toggle = (el) => {
    if (!el) return;
    if ('disabled' in el) {
      el.disabled = disabled;
    } else if (disabled) {
      el.setAttribute('aria-disabled', 'true');
    } else {
      el.removeAttribute('aria-disabled');
    }
  };
  toggle(elements.addButton);
  toggle(elements.undoButton);
  toggle(elements.moreBtn);
  toggle(elements.openSettings);
  toggle(elements.editEntriesBtn);
  toggle(elements.editProjectBtn);
  toggle(elements.refreshBtn);
  if (elements.addWordsInput) {
    elements.addWordsInput.readOnly = disabled;
    elements.addWordsInput.classList.toggle('is-disabled', disabled);
  }
  if (elements.viewBadge) {
    elements.viewBadge.tabIndex = disabled ? -1 : 0;
    if (disabled) {
      elements.viewBadge.setAttribute('aria-disabled', 'true');
    } else {
      elements.viewBadge.removeAttribute('aria-disabled');
    }
  }
  if (disabled) {
    closeActionsMenu();
    closeTimeWarpPopover();
  }
  document.body.classList.toggle('app-locked', disabled);
}

function updateLoginPendingUI() {
  const messageTarget = elements.loginStatus;
  const emailInput = elements.emailInput;
  const sendBtn = elements.sendLinkBtn;
  const resendBtn = elements.resendLinkBtn;
  if (sendBtn) sendBtn.disabled = loginPending;
  if (emailInput) emailInput.readOnly = loginPending;
  if (loginPending && messageTarget) {
    const targetEmail = pendingEmail || emailInput?.value || 'your email';
    messageTarget.textContent = `Magic link sent to ${targetEmail}. Follow the link to finish signing in.`;
  } else if (messageTarget) {
    messageTarget.textContent = '';
  }
  if (resendBtn) {
    resendBtn.style.display = loginPending ? 'inline-flex' : 'none';
    resendBtn.disabled = !loginPending;
  }
}

function updateActionsMenuPosition() {
  const menu = elements.actionsMenu;
  const trigger = elements.moreBtn;
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const previousDisplay = menu.style.display;
  const previousVisibility = menu.style.visibility;
  if (!menu.classList.contains('show')) {
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
  }
  const menuWidth = menu.offsetWidth || 280;
  const top = rect.bottom + window.scrollY + 8;
  let left = rect.right + window.scrollX - menuWidth;
  left = Math.max(16, left);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  if (!menu.classList.contains('show')) {
    menu.style.display = previousDisplay;
    menu.style.visibility = previousVisibility;
  }
}

function setActionsMenuVisibility(visible) {
  const menu = elements.actionsMenu;
  const trigger = elements.moreBtn;
  if (!menu || !trigger) return;
  if (actionsMenuVisible === visible) return;
  actionsMenuVisible = visible;
  trigger.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (visible) {
    updateActionsMenuPosition();
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    const onPointerDown = (event) => {
      if (
        !menu.contains(event.target) &&
        event.target !== trigger &&
        !trigger.contains(event.target)
      ) {
        closeActionsMenu();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeActionsMenu();
        trigger.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', updateActionsMenuPosition);
    window.addEventListener('scroll', updateActionsMenuPosition, true);
    document.addEventListener('keydown', onKeyDown);
    actionsMenuCleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', updateActionsMenuPosition);
      window.removeEventListener('scroll', updateActionsMenuPosition, true);
      document.removeEventListener('keydown', onKeyDown);
      actionsMenuCleanup = null;
    };
  } else {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
    if (actionsMenuCleanup) actionsMenuCleanup();
  }
}

function closeActionsMenu() {
  setActionsMenuVisibility(false);
}

function toggleActionsMenu() {
  setActionsMenuVisibility(!actionsMenuVisible);
}

export function initApp() {
  loadPreferences();
  initTimeWarpState();
  populateThemeSelect();
  applyTheme();
  bindEvents();
  const storedMode = getStoredMode();
  const preferredMode = storedMode || (supabase ? MODES.CLOUD : MODES.LOCAL);
  activateMode(preferredMode, { initial: true });
  if (supabase) {
    initializeSupabase();
  } else {
    updateAuthUI();
  }
  updateLoginPendingUI();
  runSelfTests();
}

function projectFields(includeBaseline = true) {
  const payload = {
    name: state.project.name,
    goal_words: state.project.goalWords,
    start_date: ymdUTC(state.project.startDate),
    end_date: ymdUTC(state.project.endDate),
  };
  if (includeBaseline && remoteSupportsBaseline) {
    payload.baseline_words = state.project.baselineWords;
  }
  return payload;
}

function isBaselineColumnError(error) {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase();
  return haystack.includes('baseline_words');
}

function warnBaselineColumnMissing() {
  if (!remoteSupportsBaseline) return;
  remoteSupportsBaseline = false;
  console.warn(
    [
      'Supabase projects table is missing the baseline_words column required by the latest code.',
      'Run this SQL in Supabase to add it:',
      '  alter table public.projects add column baseline_words integer not null default 0;',
      'Then reload the app after the migration.',
    ].join('\n')
  );
  if (!baselineWarningShown) {
    flashToast(elements.toast, 'Cloud schema outdated; keeping baseline locally.');
    baselineWarningShown = true;
  }
}

function bindEvents() {
  const {
    addButton,
    addWordsInput,
    undoButton,
    editEntriesBtn,
    closeEntries,
    closeEntries2,
    openSettings,
    saveSettings,
    closeSettings,
  closeSettings2,
  resetAllBtn,
    exportBtn,
    importBtn,
    importInput,
    refreshBtn,
    authBtn,
    authBarBtn,
    closeLogin,
    sendLinkBtn,
    resendLinkBtn,
    signOutBtn,
    accountChip,
    moreBtn,
    editProjectBtn,
  } = elements;

  addButton?.addEventListener('click', onAddWords);
  addWordsInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onAddWords();
  });
  undoButton?.addEventListener('click', onUndo);
  document.addEventListener('keydown', onGlobalUndo);

  editEntriesBtn?.addEventListener('click', () => {
    closeActionsMenu();
    renderEntries();
    openOverlay(elements.drawer);
  });
  closeEntries?.addEventListener('click', () => closeOverlay(elements.drawer));
  closeEntries2?.addEventListener('click', () => closeOverlay(elements.drawer));

  const openSettingsPanel = () => {
    closeActionsMenu();
    if (elements.nameInput) elements.nameInput.value = state.project.name;
    if (elements.goalInput) elements.goalInput.value = state.project.goalWords;
    if (elements.startInput) elements.startInput.value = ymdUTC(state.project.startDate);
    if (elements.endInput) elements.endInput.value = ymdUTC(state.project.endDate);
    if (elements.startingWordsInput)
      elements.startingWordsInput.value = String(state.project.baselineWords ?? 0);
    if (elements.themeSelect) elements.themeSelect.value = state.theme;
    openOverlay(elements.settingsPanel);
  };

  openSettings?.addEventListener('click', openSettingsPanel);
  editProjectBtn?.addEventListener('click', openSettingsPanel);
  saveSettings?.addEventListener('click', onSaveSettings);
  closeSettings?.addEventListener('click', () => closeOverlay(elements.settingsPanel));
  closeSettings2?.addEventListener('click', () => closeOverlay(elements.settingsPanel));
  resetAllBtn?.addEventListener('click', onResetAllData);

  exportBtn?.addEventListener('click', () => {
    closeActionsMenu();
    onExportData();
  });
  importBtn?.addEventListener('click', () => {
    closeActionsMenu();
    importInput?.click();
  });
  importInput?.addEventListener('change', onImportData);

  refreshBtn?.addEventListener('click', () => {
    closeActionsMenu();
    refreshFromServer();
  });

  moreBtn?.addEventListener('click', () => {
    updateSyncStatus();
    toggleActionsMenu();
  });

  const secretModeTrigger = (event) => {
    if (!event.altKey) return;
    event.preventDefault();
    promptStorageModeSwap();
  };

  elements.syncStatus?.addEventListener('click', secretModeTrigger);
  elements.drawerSyncStatus?.addEventListener('click', secretModeTrigger);
  elements.syncStatus?.setAttribute('title', 'Alt/Option-click to toggle offline mode');
  elements.drawerSyncStatus?.setAttribute('title', 'Alt/Option-click to toggle offline mode');

  authBtn?.addEventListener('click', () => openOverlay(elements.loginPanel));
  accountChip?.addEventListener('click', () => openOverlay(elements.loginPanel));
  authBarBtn?.addEventListener('click', () => openOverlay(elements.loginPanel));
  closeLogin?.addEventListener('click', () => {
    if (elements.loginPanel?.dataset.locked === 'true') return;
    closeOverlay(elements.loginPanel);
  });
  sendLinkBtn?.addEventListener('click', onSendLink);
  resendLinkBtn?.addEventListener('click', () => {
    if (!pendingEmail) {
      const email = (elements.emailInput?.value || '').trim();
      if (email) pendingEmail = email;
    }
    if (pendingEmail) sendMagicLink(pendingEmail);
  });
  elements.emailInput?.addEventListener('input', () => {
    if (loginPending) {
      loginPending = false;
      pendingEmail = '';
      updateLoginPendingUI();
    }
  });
  signOutBtn?.addEventListener('click', onSignOut);


  setupTimeWarp(
    {
      warpToggle: elements.warpToggle,
      warpDate: elements.warpDate,
      viewBadge: elements.viewBadge,
      warpPopover: elements.warpPopover,
      currentDateInfo: elements.currentDateInfo,
    },
    update
  );
}

function populateThemeSelect() {
  if (!elements.themeSelect) return;
  elements.themeSelect.innerHTML = THEMES.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('');
  elements.themeSelect.value = state.theme;
}

function promptStorageModeSwap() {
  if (isCloudMode()) {
    const ok = confirm(
      'Switch to offline mode? This keeps data only in this browser and disables syncing until you return to cloud.'
    );
    if (!ok) return;
    activateMode(MODES.LOCAL);
    flashToast(elements.toast, 'Offline mode enabled');
  } else {
    if (!supabase) {
      flashToast(elements.toast, 'Cloud sync not configured');
      return;
    }
    const ok = confirm('Switch back to cloud sync? You will need to sign in to resume syncing.');
    if (!ok) return;
    activateMode(MODES.CLOUD);
    if (!user) {
      setAppInteractivity(false);
      openOverlay(elements.loginPanel);
      flashToast(elements.toast, 'Sign in to enable cloud sync');
    } else {
      flashToast(elements.toast, 'Cloud sync ready');
    }
  }
}

function activateMode(nextMode, { initial = false } = {}) {
  if (nextMode !== MODES.LOCAL && nextMode !== MODES.CLOUD) {
    console.warn('Unknown mode', nextMode);
    return;
  }
  if (nextMode === MODES.CLOUD && !supabase) {
    flashToast(elements.toast, 'Cloud sync not configured');
    activeMode = MODES.LOCAL;
    setStoredMode(MODES.LOCAL);
    resetProjectData();
    loadLocalState();
    lastSyncedAt = null;
    updateSyncStatus();
    updateAuthUI();
    update();
    return;
  }
  closeActionsMenu();
  loginPending = false;
  pendingEmail = '';
  updateLoginPendingUI();
  clearRealtime();
  activeMode = nextMode;
  setStoredMode(nextMode);
  if (isLocalMode()) {
    resetProjectData();
    loadLocalState();
    lastSyncedAt = null;
    projectId = null;
    serverEntriesSnapshot = { ...state.entries };
  } else {
    resetProjectData();
    projectId = null;
    lastSyncedAt = null;
    serverEntriesSnapshot = {};
  }
  updateSyncStatus();
  updateAuthUI();
  update();
  if (!initial) {
    if (isCloudMode()) {
      if (user) {
        bootAfterAuth().catch((err) => console.error(err));
      } else {
        openOverlay(elements.loginPanel);
      }
    } else {
      }
  } else if (isCloudMode() && user) {
    bootAfterAuth().catch((err) => console.error(err));
  } else if (isCloudMode() && !user) {
    setAppInteractivity(false);
    openOverlay(elements.loginPanel);
  }
}

function onResetAllData() {
  const confirmation = confirm(
    'This will erase the entire project: name, goals, date range, baseline, and every word entry on this device. If you are signed in, the synced copy will be cleared too.\n\nThis cannot be undone. Continue?'
  );
  if (!confirmation) return;

  history.clear?.();
  resetProjectData();
  state.entries = {};
  state.timeWarp = null;
  serverEntriesSnapshot = {};
  lastSyncedAt = null;
  if (elements.addWordsInput) elements.addWordsInput.value = '';
  savePreferences();
  localStorage.removeItem(STORAGE_KEY);
  if (isLocalMode()) {
    saveLocalState();
    if (elements.authBar) elements.authBar.style.display = 'flex';
  }
  if (isRemote()) {
    const resetTasks = [
      supabase.from('word_events').delete().eq('project_id', projectId),
      syncProjectSettings(),
    ];
    Promise.all(resetTasks)
      .then(() => {
        lastSyncedAt = new Date();
        updateSyncStatus();
        flashToast(elements.toast, 'Project reset. Cloud data cleared.');
      })
      .catch((err) => {
        console.error('Reset sync failed', err);
        flashToast(elements.toast, 'Cloud reset hit an error; reload recommended.');
      });
  } else {
    flashToast(elements.toast, 'Project reset.');
  }
  update();
  closeActionsMenu();
  closeOverlay(elements.settingsPanel);
}

function onAddWords() {
  if (!elements.addButton) return;
  if (elements.addButton.disabled) {
    flashToast(elements.toast, 'Date is outside project window');
    return;
  }
  const value = Number(elements.addWordsInput?.value || 0);
  if (Number.isNaN(value) || value <= 0) {
    elements.addWordsInput?.focus();
    return;
  }
  const ymd = viewingDay();
  if (isRemote()) {
    addEventRemote(ymd, value);
  } else {
    addLocal(ymd, value);
  }
  if (elements.addWordsInput) {
    elements.addWordsInput.value = '';
    elements.addWordsInput.focus();
  }
}

function onUndo() {
  const snapshot = history.pop();
  if (!snapshot) return;
  state.entries[snapshot.date] = Math.max(0, Number(state.entries[snapshot.date] || 0) - snapshot.delta);
  update();
  if (isRemote()) {
    addEventRemote(snapshot.date, -snapshot.delta, { skipLocal: true })
      .then(() => {
        lastSyncedAt = new Date();
        updateSyncStatus();
        if (serverEntriesSnapshot[snapshot.date] !== undefined) {
          serverEntriesSnapshot[snapshot.date] = Number(state.entries[snapshot.date] || 0);
        }
      })
      .catch(async (err) => {
        console.error('undo sync failed', err);
        flashToast(elements.toast, 'Cloud undo failed; refreshing…');
        await loadEvents();
        update();
      });
  }
}

function onGlobalUndo(event) {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    onUndo();
  }
}

function addLocal(ymd, delta) {
  state.entries[ymd] = Number(state.entries[ymd] || 0) + delta;
  history.push(ymd, delta);
  update();
}

function computeSeries() {
  const start = ymdUTC(state.project.startDate);
  const end = ymdUTC(state.project.endDate);
  const days = datesInRangeUTC(start, end);
  const baseline = Number(state.project.baselineWords || 0);
  const remainingTarget = Math.max(0, state.project.goalWords - baseline);
  const daily = days.map((d) => Number(state.entries[d] || 0));
  let sum = baseline;
  const cumulative = [baseline, ...daily.map((w) => (sum += w))];
  const idealPerDay = days.length > 0 ? Math.ceil(remainingTarget / Math.max(1, days.length)) : remainingTarget;
  const pace = [baseline, ...days.map((_, i) => Math.min(state.project.goalWords, baseline + idealPerDay * (i + 1)))];
  const daysForChart = ['baseline', ...days];
  return { days, daysForChart, daily, cumulative, pace, idealPerDay, baseline, remainingTarget };
}

function cutoffIndexForViewing(days) {
  if (!days || days.length === 0) return 0;
  const vDay = viewingDay();
  if (vDay < days[0]) return 0;
  if (vDay > days[days.length - 1]) return days.length;
  return Math.max(0, days.indexOf(vDay)) + 1;
}

function wordsOn(ymd, series) {
  const idx = series.days.indexOf(ymd);
  return idx >= 0 ? series.daily[idx] : 0;
}

function renderHeader() {
  const vDay = viewingDay();
  if (elements.projectTitle) {
    elements.projectTitle.textContent = state.project.name || 'NaNo Project';
    document.title = `${elements.projectTitle.textContent} — NaNo Word Tracker`;
  }
  if (elements.viewBadge) {
    const prefix = state.timeWarp ? '⏳ ' : '';
    elements.viewBadge.textContent = `Date: ${prefix}${fmtMD(vDay)}`;
  }
}

function renderStats(series) {
  const { days, cumulative, idealPerDay, baseline } = series;
  const cut = cutoffIndexForViewing(days);
  const total = cumulative[cut] ?? baseline;
  const pct = state.project.goalWords > 0
    ? Math.min(100, Math.round((total / Math.max(1, state.project.goalWords)) * 100))
    : 0;
  const remaining = Math.max(0, state.project.goalWords - total);
  const todayW = wordsOn(viewingDay(), series);

  let elapsed = 0;
  let daysLeft = days.length;
  if (days.length > 0) {
    const today = parseYMD(viewingDay());
    const start = parseYMD(days[0]);
    const end = parseYMD(days[days.length - 1]);
    if (today >= start) {
      const clamp = today > end ? end : today;
      elapsed = Math.min(days.length, Math.floor((clamp - start) / 86400000) + 1);
      daysLeft = Math.max(0, days.length - elapsed);
    }
  }

  const needed = remaining === 0 ? 0 : Math.max(0, Math.ceil(remaining / Math.max(1, daysLeft)));

  if (elements.totalEl) elements.totalEl.textContent = total.toLocaleString();
  if (elements.pctEl) elements.pctEl.textContent = `${pct}%`;
  if (elements.barEl) elements.barEl.style.width = `${pct}%`;
  if (elements.remainingEl) elements.remainingEl.textContent = remaining.toLocaleString();
  if (elements.todayWordsEl) elements.todayWordsEl.textContent = todayW.toLocaleString();
  if (elements.idealEl) elements.idealEl.textContent = idealPerDay.toLocaleString();
  if (elements.neededEl) {
    elements.neededEl.textContent = needed.toLocaleString();
    elements.neededEl.style.color = needed > idealPerDay ? 'var(--warn-ink)' : 'var(--ok-ink)';
  }
}

function updateMotivationBanner(series) {
  if (!elements.motivationBanner) return;
  const banner = elements.motivationBanner;
  const { days, cumulative, idealPerDay, baseline } = series;

  if (days.length === 0) {
    banner.textContent = 'Set a project start and end date to begin tracking.';
    return;
  }

  const viewingYMD = viewingDay();
  const viewingDate = parseYMD(viewingYMD);
  const start = parseYMD(days[0]);
  const end = parseYMD(days[days.length - 1]);
  const totalDays = days.length;
  const totalWritten = cumulative[cumulative.length - 1] ?? baseline;
  const msPerDay = 86400000;

  if (viewingDate < start) {
    const daysUntil = Math.ceil((start - viewingDate) / msPerDay);
    banner.textContent = `Sprint starts in ${daysUntil} day${daysUntil === 1 ? '' : 's'} • Goal ${state.project.goalWords.toLocaleString()} words`;
    return;
  }

  if (viewingDate > end) {
    banner.textContent = `Sprint finished • ${totalWritten.toLocaleString()} words written`;
    return;
  }

  const viewingUtcYMD = ymdUTC(viewingDate);
  const dayIndex = days.indexOf(viewingUtcYMD);
  const dayNumber = dayIndex === -1 ? Math.min(totalDays, Math.floor((viewingDate - start) / msPerDay) + 1) : dayIndex + 1;
  const clampedDay = Math.min(totalDays, Math.max(1, dayNumber));
  const actualTotal = dayIndex === -1 ? cumulative[Math.min(cumulative.length - 1, clampedDay)] : cumulative[dayIndex + 1];

  if (state.project.goalWords <= baseline) {
    banner.textContent = `Goal reached! • ${actualTotal.toLocaleString()} words`; 
    return;
  }

  const elapsedForPace = clampedDay;
  const expected = baseline + idealPerDay * elapsedForPace;
  const ideal = idealPerDay || 1;
  const aheadDays = (actualTotal - expected) / ideal;

  let statusText;
  if (idealPerDay === 0) {
    statusText = 'Goal reached!';
  } else if (aheadDays > 0.75) {
    statusText = `Ahead by ${aheadDays.toFixed(1)} day${aheadDays >= 1.75 ? 's' : ''}`;
  } else if (aheadDays < -0.75) {
    const behind = Math.abs(aheadDays);
    statusText = `Behind by ${behind.toFixed(1)} day${behind >= 1.75 ? 's' : ''}`;
  } else {
    statusText = 'On pace';
  }

  banner.textContent = `Day ${clampedDay} of ${totalDays} • ${statusText} • ${actualTotal.toLocaleString()} words`;
}

function renderEntries() {
  if (!elements.entriesContainer || !elements.jumpDate) return;
  const days = datesInRangeUTC(ymdUTC(state.project.startDate), ymdUTC(state.project.endDate));
  elements.jumpDate.innerHTML = days.map((d) => `<option value="${d}">${fmtMD(d)}</option>`).join('');
  elements.entriesContainer.innerHTML = '';
  const fragment = document.createDocumentFragment();
  entryInputRefs = {};
  serverEntriesSnapshot = { ...state.entries };

  days.forEach((day) => {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'rowlabel';
    labelDiv.textContent = fmtMD(day);

    const rowL = document.createElement('div');
    rowL.appendChild(labelDiv);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = Number(state.entries[day] ?? 0);
    entryInputRefs[day] = input;
    input.addEventListener('input', () => {
      const target = Number(input.value || 0);
      const expectedBase = Number(serverEntriesSnapshot[day] ?? 0);
      state.entries[day] = target;
      update();
      if (isRemote()) queueSyncDay(day, expectedBase, target);
    });

    const rowR = document.createElement('div');
    rowR.appendChild(input);

    fragment.appendChild(rowL);
    fragment.appendChild(rowR);
  });

  elements.entriesContainer.appendChild(fragment);
  elements.jumpDate.onchange = () => {
    const target = Array.from(elements.entriesContainer.querySelectorAll('.rowlabel')).find(
      (el) => el.textContent === fmtMD(elements.jumpDate.value)
    );
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

function applyTheme(nextTheme = state.theme) {
  const theme = normalizeTheme(nextTheme);
  const changed = state.theme !== theme;
  state.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = ['midnight', 'charcoal'].includes(theme) ? 'dark' : 'light';
  if (changed) savePreferences();
}

function setAddEnabled() {
  const ok = inRange(viewingDay());
  if (elements.addButton) {
    elements.addButton.disabled = !ok;
    elements.addButton.title = ok ? 'Add words to this date' : 'Date is outside project window';
  }
}

function update() {
  applyTheme();
  syncTimeWarpControls(elements.warpToggle, elements.warpDate, elements.viewBadge, elements.currentDateInfo);
  updateCurrentDateDisplay(elements.currentDateInfo);
  const series = computeSeries();
  renderHeader();
  renderStats(series);
  updateMotivationBanner(series);
  chartRenderer.renderChart(series, { viewingDay, project: state.project });
  setAddEnabled();
  if (isLocalMode()) saveLocalState();
  updateSyncStatus();
  if (actionsMenuVisible) updateActionsMenuPosition();
}

function refreshSyncLabel() {
  let label = 'Choose mode';
  if (isCloudMode()) {
    if (user) {
      label = lastSyncedAt ? `Synced ${formatRelative(lastSyncedAt)}` : 'Not synced yet';
    } else {
      label = 'Sign in to sync';
    }
  } else if (isLocalMode()) {
    label = 'Offline mode';
  }
  if (elements.syncStatus) elements.syncStatus.textContent = label;
  if (elements.drawerSyncStatus) elements.drawerSyncStatus.textContent = label;
}

function updateSyncStatus() {
  refreshSyncLabel();
  if (!isRemote() || !lastSyncedAt) {
    if (syncStatusInterval) {
      clearInterval(syncStatusInterval);
      syncStatusInterval = null;
    }
    return;
  }
  if (!syncStatusInterval) {
    syncStatusInterval = setInterval(refreshSyncLabel, 60000);
  }
}

function formatRelative(time) {
  const diff = Date.now() - time.getTime();
  if (diff < 45_000) return 'just now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function onSaveSettings() {
  if (elements.nameInput) state.project.name = elements.nameInput.value || state.project.name;
  if (elements.goalInput) {
    const value = Number(elements.goalInput.value || state.project.goalWords);
    if (!Number.isNaN(value) && value > 0) state.project.goalWords = value;
  }
  if (elements.startInput?.value) state.project.startDate = parseYMD(elements.startInput.value);
  if (elements.endInput?.value) state.project.endDate = parseYMD(elements.endInput.value);
  if (elements.startingWordsInput) {
    const baseline = Number(elements.startingWordsInput.value || 0);
    state.project.baselineWords = Number.isNaN(baseline) ? 0 : Math.max(0, baseline);
  }
  if (elements.themeSelect) state.theme = normalizeTheme(elements.themeSelect.value);
  closeOverlay(elements.settingsPanel);
  update();
  if (isRemote()) {
    syncProjectSettings()
      .then(() => {
        lastSyncedAt = new Date();
        updateSyncStatus();
        flashToast(elements.toast, 'Project settings synced to cloud');
      })
      .catch((err) => {
        console.error('Sync project settings failed', err);
        flashToast(elements.toast, 'Cloud save failed; keeping changes locally');
      });
  } else {
    flashToast(elements.toast, 'Project settings updated');
  }
}

function onExportData() {
  const payload = buildExportPayload();
  const data = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = payload.meta.mode === MODES.CLOUD ? 'cloud' : 'offline';
  a.download = `wordtracker-${suffix}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function onImportData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      await applyImportedData(parsed);
    } catch (err) {
      console.error('import failed', err);
      const message = err instanceof Error ? err.message : 'Import failed. Check the JSON file.';
      flashToast(elements.toast, message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function buildExportPayload() {
  return {
    project: {
      name: state.project.name,
      goalWords: state.project.goalWords,
      startDate: ymdUTC(state.project.startDate),
      endDate: ymdUTC(state.project.endDate),
      baselineWords: state.project.baselineWords,
    },
    entries: { ...state.entries },
    meta: {
      mode: activeMode,
      theme: state.theme,
      timeWarp: state.timeWarp,
      exportedAt: new Date().toISOString(),
    },
  };
}

async function applyImportedData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid JSON payload');
  if (isCloudMode() && !isRemote()) {
    throw new Error('Sign in before importing when cloud sync is enabled.');
  }
  const project = data.project || {};
  const entries = data.entries && typeof data.entries === 'object' ? data.entries : {};
  const meta = data.meta || {};
  resetProjectData();
  if (typeof project.name === 'string' && project.name.trim()) state.project.name = project.name.trim();
  if (typeof project.goalWords === 'number' && project.goalWords > 0) state.project.goalWords = Math.floor(project.goalWords);
  if (typeof project.baselineWords === 'number' && project.baselineWords >= 0) {
    state.project.baselineWords = Math.floor(project.baselineWords);
  }
  if (typeof project.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(project.startDate)) {
    state.project.startDate = parseYMD(project.startDate);
  }
  if (typeof project.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(project.endDate)) {
    state.project.endDate = parseYMD(project.endDate);
  }
  const importedEntries = {};
  Object.entries(entries).forEach(([key, value]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      const num = Number(value) || 0;
      importedEntries[key] = num;
    }
  });
  state.entries = importedEntries;
  if (meta.theme) state.theme = normalizeTheme(meta.theme);
  state.timeWarp = typeof meta.timeWarp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.timeWarp) ? meta.timeWarp : null;
  savePreferences();
  update();
  if (isLocalMode()) {
    saveLocalState();
    flashToast(elements.toast, 'Import complete (offline)');
    return;
  }
  if (!isRemote()) {
    flashToast(elements.toast, 'Sign in to import into the cloud');
    return;
  }
  try {
    await syncProjectSettings();
    const prior = { ...serverEntriesSnapshot };
    const allDays = new Set([...Object.keys(prior), ...Object.keys(state.entries)]);
    for (const day of allDays) {
      const target = Number(state.entries[day] || 0);
      await syncDayTotalNow(day, prior[day] ?? 0, target, { force: true });
    }
    serverEntriesSnapshot = { ...state.entries };
    update();
    lastSyncedAt = new Date();
    updateSyncStatus();
    flashToast(elements.toast, 'Imported data synced to cloud');
  } catch (err) {
    console.error('cloud import sync failed', err);
    flashToast(elements.toast, 'Cloud import failed; data kept locally');
  }
}

function initializeSupabase() {
  supabase.auth.getSession().then(({ data }) => {
    user = data?.session?.user || null;
    updateAuthUI();
    if (user) bootAfterAuth();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    updateAuthUI();
    if (user) {
      bootAfterAuth().catch((err) => console.error(err));
    }
  });
}

let user = null;

function isRemote() {
  return isCloudMode() && !!(supabase && user);
}

function onSendLink() {
  const email = (elements.emailInput?.value || '').trim();
  if (!email) {
    elements.emailInput?.focus();
    return;
  }
  pendingEmail = email;
  loginPending = true;
  updateLoginPendingUI();
  sendMagicLink(email);
}

async function sendMagicLink(email) {
  if (!supabase) {
    flashToast(elements.toast, 'Cloud sync not configured');
    loginPending = false;
    updateLoginPendingUI();
    return;
  }
  try {
    await supabase.auth.signInWithOtp({ email });
    if (!pendingEmail) pendingEmail = email;
    loginPending = true;
    updateLoginPendingUI();
    flashToast(elements.toast, 'Check your email for the magic link');
  } catch (err) {
    console.error('signInWithOtp', err);
    loginPending = false;
    updateLoginPendingUI();
    flashToast(elements.toast, 'Could not send magic link. Try again.');
  }
}

async function onSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  loginPending = false;
  updateLoginPendingUI();
  clearRealtime();
  projectId = null;
  state.timeWarp = null;
  savePreferences();
  localStorage.removeItem(STORAGE_KEY);
  activateMode(MODES.CLOUD);
  flashToast(elements.toast, 'Signed out. Sign in to continue syncing.');
}

function updateAuthUI() {
  const signedIn = !!user;
  const cloudActive = !!supabase && isCloudMode();
  const requiresAuth = cloudActive && !signedIn;

  if (!cloudActive) {
    setAppInteractivity(true);
    if (elements.authBtn) elements.authBtn.style.display = 'none';
    if (elements.authBar) elements.authBar.style.display = 'none';
    if (elements.accountChip) elements.accountChip.style.display = 'none';
    if (elements.accountEmail) elements.accountEmail.textContent = '';
    if (elements.loginTitle) elements.loginTitle.textContent = 'Offline mode';
    if (elements.signInPane) elements.signInPane.style.display = 'none';
    if (elements.signedInPane) elements.signedInPane.style.display = 'none';
    if (elements.refreshBtn) elements.refreshBtn.disabled = true;
    if (elements.drawerSyncStatus) elements.drawerSyncStatus.textContent = 'Offline mode';
    if (elements.acctEmail2) elements.acctEmail2.textContent = '';
    if (elements.loginPanel) elements.loginPanel.dataset.locked = 'false';
    if (elements.closeLogin) elements.closeLogin.style.display = 'inline-flex';
    closeOverlay(elements.loginPanel);
    loginPending = false;
    pendingEmail = '';
    updateLoginPendingUI();
    updateSyncStatus();
    return;
  }

  if (elements.loginTitle) elements.loginTitle.textContent = signedIn ? 'Account' : 'Sign in to sync';
  if (elements.signOutBtn) elements.signOutBtn.style.display = signedIn ? 'inline-flex' : 'none';
  if (elements.signInPane) elements.signInPane.style.display = signedIn ? 'none' : 'block';
  if (elements.signedInPane) elements.signedInPane.style.display = signedIn ? 'block' : 'none';
  if (elements.refreshBtn) elements.refreshBtn.disabled = !signedIn;
  if (elements.authBtn) {
    elements.authBtn.textContent = 'Sign in';
    elements.authBtn.style.display = signedIn ? 'none' : 'inline-flex';
    elements.authBtn.disabled = signedIn;
  }
  if (elements.authBar) elements.authBar.style.display = requiresAuth ? 'none' : (signedIn ? 'none' : 'flex');
  if (elements.accountChip) {
    if (signedIn) {
      elements.accountChip.style.display = 'inline-flex';
      if (elements.accountEmail) elements.accountEmail.textContent = user.email || 'signed-in';
    } else {
      elements.accountChip.style.display = 'none';
      if (elements.accountEmail) elements.accountEmail.textContent = '';
    }
  }
  if (elements.acctEmail2) elements.acctEmail2.textContent = signedIn ? (user?.email || '') : '';
  if (elements.loginPanel) elements.loginPanel.dataset.locked = requiresAuth ? 'true' : 'false';
  if (elements.closeLogin) elements.closeLogin.style.display = requiresAuth ? 'none' : 'inline-flex';
  setAppInteractivity(signedIn);
  if (requiresAuth) {
    updateLoginPendingUI();
    openOverlay(elements.loginPanel);
  } else {
    loginPending = false;
    pendingEmail = '';
    updateLoginPendingUI();
    closeOverlay(elements.loginPanel);
  }
  updateSyncStatus();
}

async function bootAfterAuth() {
  const project = await getOrCreateProject();
  projectId = project.id;
  state.project.name = project.name;
  state.project.goalWords = project.goal_words;
  state.project.startDate = new Date(project.start_date);
  state.project.endDate = new Date(project.end_date);
  const hasBaseline = Object.prototype.hasOwnProperty.call(project, 'baseline_words');
  if (hasBaseline) {
    remoteSupportsBaseline = true;
    state.project.baselineWords = project.baseline_words ?? 0;
  } else {
    warnBaselineColumnMissing();
  }
  await loadEvents();
  subscribeRealtime();
  update();
}

async function getOrCreateProject() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('owner', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (data?.[0]) {
    if (!Object.prototype.hasOwnProperty.call(data[0], 'baseline_words')) {
      warnBaselineColumnMissing();
    } else {
      remoteSupportsBaseline = true;
    }
    return data[0];
  }
  let includeBaseline = remoteSupportsBaseline;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = {
      owner: user.id,
      ...projectFields(includeBaseline),
    };
    const { data: created, error: insertError } = await supabase.from('projects').insert(payload).select().single();
    if (!insertError) return created;
    if (includeBaseline && isBaselineColumnError(insertError)) {
      warnBaselineColumnMissing();
      includeBaseline = false;
      continue;
    }
    throw insertError;
  }
  throw new Error('Unable to create project');
}

function foldEvents(rows) {
  const acc = {};
  for (const row of rows) {
    const key = typeof row.ymd === 'string' ? row.ymd : ymdUTC(new Date(row.ymd));
    acc[key] = (acc[key] || 0) + Number(row.delta || 0);
  }
  return acc;
}

async function loadEvents() {
  if (!supabase || !projectId) return;
  const { data, error } = await supabase
    .from('word_events')
    .select('ymd, delta')
    .eq('project_id', projectId)
    .order('ymd, created_at', { ascending: true });
  if (error) throw error;
  state.entries = foldEvents(data || []);
  lastSyncedAt = new Date();
  updateSyncStatus();
  if (entryInputRefs) {
    Object.entries(entryInputRefs).forEach(([ymd, input]) => {
      if (input) input.value = Number(state.entries[ymd] || 0);
    });
  }
  serverEntriesSnapshot = { ...state.entries };
}

async function addEventRemote(ymd, delta, { skipLocal = false } = {}) {
  if (!supabase || !projectId) return;
  if (!skipLocal) addLocal(ymd, delta);
  const { error } = await supabase.from('word_events').insert({
    project_id: projectId,
    user_id: user.id,
    ymd,
    delta,
  });
  if (error) {
    if (skipLocal) throw error;
    flashToast(elements.toast, 'Save failed; reloading…');
    await loadEvents();
    update();
    return;
  }
  lastSyncedAt = new Date();
  updateSyncStatus();
}

function subscribeRealtime() {
  if (!supabase || !projectId) return;
  clearRealtime();
  realtimeSub = supabase
    .channel('realtime:word_events')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'word_events', filter: `project_id=eq.${projectId}` },
      async () => {
        await loadEvents();
        update();
      }
    )
    .subscribe();
  projectRealtimeSub = supabase
    .channel('realtime:projects')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
      async () => {
        await fetchProjectState();
        update();
      }
    )
    .subscribe();
}

function clearRealtime() {
  if (realtimeSub) {
    if (supabase) supabase.removeChannel(realtimeSub);
    realtimeSub = null;
  }
  if (projectRealtimeSub) {
    if (supabase) supabase.removeChannel(projectRealtimeSub);
    projectRealtimeSub = null;
  }
}

async function syncProjectSettings() {
  if (!isRemote() || !projectId) return;
  let includeBaseline = remoteSupportsBaseline;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = projectFields(includeBaseline);
    const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
    if (!error) return;
    if (includeBaseline && isBaselineColumnError(error)) {
      warnBaselineColumnMissing();
      includeBaseline = false;
      continue;
    }
    throw error;
  }
}

async function fetchProjectState() {
  if (!isRemote() || !projectId) return;
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (error) throw error;
  state.project.name = data.name;
  state.project.goalWords = data.goal_words;
  state.project.startDate = new Date(data.start_date);
  state.project.endDate = new Date(data.end_date);
  const hasBaseline = Object.prototype.hasOwnProperty.call(data, 'baseline_words');
  if (hasBaseline) {
    remoteSupportsBaseline = true;
    state.project.baselineWords = data.baseline_words ?? 0;
  } else {
    warnBaselineColumnMissing();
  }
}

async function refreshFromServer() {
  if (!isRemote()) {
    flashToast(elements.toast, 'Sign in to sync');
    return;
  }
  if (elements.refreshBtn) {
    elements.refreshBtn.disabled = true;
    elements.refreshBtn.textContent = 'Syncing…';
  }
  try {
    await fetchProjectState();
    await loadEvents();
    update();
    flashToast(elements.toast, 'Latest cloud data loaded');
  } catch (err) {
    console.error('refreshFromServer', err);
    flashToast(elements.toast, 'Cloud refresh failed');
  } finally {
    if (elements.refreshBtn) {
      elements.refreshBtn.disabled = false;
      elements.refreshBtn.textContent = 'Sync now';
    }
  }
}

async function syncDayTotalNow(ymd, expectedBase, target, options = {}) {
  if (!isRemote() || !projectId) return;
  const { force = false } = options;
  try {
    const { data, error } = await supabase
      .from('word_events')
      .select('ymd, delta')
      .eq('project_id', projectId)
      .eq('ymd', ymd);
    if (error) throw error;
    const serverTotal = foldEvents(data || [])[ymd] || 0;
    if (!force && typeof expectedBase === 'number' && serverTotal !== expectedBase) {
      const proceed = confirm(
        `"${fmtMD(ymd)}" changed on another device (server has ${serverTotal.toLocaleString()} words). Overwrite with ${target.toLocaleString()}?`
      );
      if (!proceed) {
        state.entries[ymd] = serverTotal;
        if (entryInputRefs[ymd]) entryInputRefs[ymd].value = serverTotal;
        serverEntriesSnapshot[ymd] = serverTotal;
        update();
        flashToast(elements.toast, 'Reloaded server total');
        return;
      }
    }
    const delta = target - serverTotal;
    if (delta === 0) {
      serverEntriesSnapshot[ymd] = target;
      return;
    }
    await addEventRemote(ymd, delta, { skipLocal: true });
    serverEntriesSnapshot[ymd] = target;
    lastSyncedAt = new Date();
    updateSyncStatus();
  } catch (err) {
    console.error('syncDayTotalNow', err);
    flashToast(elements.toast, 'Sync failed; please try again');
  } finally {
    delete syncTimers[ymd];
  }
}

function queueSyncDay(ymd, expectedBase, target) {
  if (!isRemote()) return;
  if (syncTimers[ymd]) clearTimeout(syncTimers[ymd]);
  syncTimers[ymd] = setTimeout(() => syncDayTotalNow(ymd, expectedBase, target), 300);
}

function runSelfTests() {
  const results = [];
  const log = (name, ok) => {
    results.push({ name, ok });
    if (!ok) console.error('FAIL:', name);
  };
  const d = parseYMD('2025-11-02');
  log('ymdUTC roundtrip', ymdUTC(d) === '2025-11-02');
  const r = datesInRangeUTC('2025-11-01', '2025-11-03');
  log('datesInRange length', r.length === 3 && r[0] === '2025-11-01' && r[2] === '2025-11-03');
  const backup = { project: { ...state.project }, entries: { ...state.entries }, timeWarp: state.timeWarp };
  state.project = {
    name: 'T',
    goalWords: 300,
    startDate: parseYMD('2025-11-01'),
    endDate: parseYMD('2025-11-03'),
  };
  state.entries = { '2025-11-01': 100, '2025-11-02': 50 };
  const s = computeSeries();
  log('daily', s.daily.join(',') === '100,50,0');
  log('cumulative', s.cumulative.join(',') === '0,100,150,150');
  log('idealPerDay=100', s.idealPerDay === 100);
  log('pace length', s.pace.length === s.daysForChart.length);
  log('wordsOn 11/02', wordsOn('2025-11-02', s) === 50);
  log('fmtMD Nov 9', fmtMD('2025-11-09') === 'Nov 9');
  state.project = { ...backup.project };
  state.entries = { ...backup.entries };
  state.timeWarp = backup.timeWarp;
  console.log(`Self-tests: ${results.filter((x) => x.ok).length}/${results.length} passed`, results);
}
