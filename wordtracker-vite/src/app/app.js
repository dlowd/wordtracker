import {
  state,
  loadState,
  saveState,
  viewingDay,
  normalizeTheme,
  STORAGE_KEY,
  inRange,
  THEMES,
} from '../state/state.js';
import { elements, requireElement } from '../ui/dom.js';
import { flashToast } from '../ui/toast.js';
import { createHistory } from '../state/history.js';
import { openOverlay, closeOverlay } from '../ui/overlay.js';
import { supabase } from '../supabase/client.js';
import {
  initTimeWarpState,
  syncTimeWarpControls,
  updateCurrentDateDisplay,
  setupTimeWarp,
} from '../features/timeWarp.js';
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

let projectId = null;
let realtimeSub = null;

const chartRenderer = createChartRenderer(elements.chart, elements.tooltip);

export function initApp() {
  loadState();
  initTimeWarpState();
  populateThemeSelect();
  applyTheme();
  bindEvents();
  update();
  if (supabase) {
    initializeSupabase();
  } else {
    updateAuthUI();
  }
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
    exportBtn,
    importBtn,
    importInput,
    refreshBtn,
    authBtn,
    authBarBtn,
    dismissAuthBar,
    closeLogin,
    sendLinkBtn,
    signOutBtn,
    accountChip,
    moreBtn,
    closeActions,
    editProjectBtn,
  } = elements;

  addButton?.addEventListener('click', onAddWords);
  addWordsInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onAddWords();
  });
  undoButton?.addEventListener('click', onUndo);
  document.addEventListener('keydown', onGlobalUndo);

  editEntriesBtn?.addEventListener('click', () => {
    closeOverlay(elements.actionsOverlay);
    renderEntries();
    openOverlay(elements.drawer);
  });
  closeEntries?.addEventListener('click', () => closeOverlay(elements.drawer));
  closeEntries2?.addEventListener('click', () => closeOverlay(elements.drawer));

  const openSettingsPanel = () => {
    closeOverlay(elements.actionsOverlay);
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

  exportBtn?.addEventListener('click', onExportData);
  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', onImportData);

  refreshBtn?.addEventListener('click', refreshFromServer);

  moreBtn?.addEventListener('click', () => {
    updateSyncStatus();
    openOverlay(elements.actionsOverlay);
  });
  closeActions?.addEventListener('click', () => closeOverlay(elements.actionsOverlay));

  authBtn?.addEventListener('click', () => openOverlay(elements.loginPanel));
  accountChip?.addEventListener('click', () => openOverlay(elements.loginPanel));
  authBarBtn?.addEventListener('click', () => openOverlay(elements.loginPanel));
  dismissAuthBar?.addEventListener('click', () => {
    if (elements.authBar) elements.authBar.style.display = 'none';
    localStorage.setItem('authbar_dismissed', '1');
  });
  closeLogin?.addEventListener('click', () => closeOverlay(elements.loginPanel));
  sendLinkBtn?.addEventListener('click', onSendLink);
  signOutBtn?.addEventListener('click', onSignOut);

  setupTimeWarp(
    {
      warpToggle: elements.warpToggle,
      warpDate: elements.warpDate,
      viewBadge: elements.viewBadge,
      warpOverlay: elements.warpOverlay,
      closeWarp: elements.closeWarp,
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

  const today = new Date();
  const start = parseYMD(days[0]);
  const end = parseYMD(days[days.length - 1]);
  const totalDays = days.length;
  const totalWritten = cumulative[cumulative.length - 1] ?? baseline;

  if (today < start) {
    const daysUntil = Math.ceil((start - today) / 86400000);
    banner.textContent = `Sprint starts in ${daysUntil} day${daysUntil === 1 ? '' : 's'} • Goal ${state.project.goalWords.toLocaleString()} words`;
    return;
  }

  if (today > end) {
    banner.textContent = `Sprint finished • ${totalWritten.toLocaleString()} words written`;
    return;
  }

  const todayYMD = ymdUTC(today);
  const dayIndex = days.indexOf(todayYMD);
  const dayNumber = dayIndex === -1 ? Math.min(totalDays, Math.floor((today - start) / 86400000) + 1) : dayIndex + 1;
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
  state.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = ['midnight', 'charcoal'].includes(theme) ? 'dark' : 'light';
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
  syncTimeWarpControls(elements.warpToggle, elements.warpDate, elements.viewBadge);
  updateCurrentDateDisplay(elements.currentDateInfo);
  const series = computeSeries();
  renderHeader();
  renderStats(series);
  updateMotivationBanner(series);
  chartRenderer.renderChart(series, { viewingDay, project: state.project });
  setAddEnabled();
  saveState();
  updateSyncStatus();
}

function refreshSyncLabel() {
  const label = isRemote()
    ? lastSyncedAt ? `Synced ${formatRelative(lastSyncedAt)}` : 'Not synced yet'
    : 'Local mode';
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
  const data = new Blob([localStorage.getItem(STORAGE_KEY) || '{}'], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nanotracker.json';
  a.click();
  URL.revokeObjectURL(url);
}

function onImportData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      loadState();
      update();
      if (isRemote()) {
        flashToast(elements.toast, 'Imported locally; edit a day to sync delta');
      } else {
        flashToast(elements.toast, 'Import complete');
      }
    } catch {
      alert('Invalid JSON.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
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
  return !!(supabase && user);
}

function onSendLink() {
  const email = (elements.emailInput?.value || '').trim();
  if (!email) {
    elements.emailInput?.focus();
    return;
  }
  signIn(email);
}

async function signIn(email) {
  if (!supabase) {
    flashToast(elements.toast, 'Cloud sync not configured');
    return;
  }
  await supabase.auth.signInWithOtp({ email });
  flashToast(elements.toast, 'Check your email for the magic link');
}

async function onSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  closeOverlay(elements.loginPanel);
  flashToast(elements.toast, 'Signed out');
}

function updateAuthUI() {
  const signedIn = !!user;
  if (elements.authBtn) {
    elements.authBtn.textContent = 'Sign in';
    elements.authBtn.style.display = signedIn ? 'none' : 'inline-flex';
  }
  if (elements.loginTitle) elements.loginTitle.textContent = signedIn ? 'Account' : 'Sign in to sync (optional)';
  if (elements.signOutBtn) elements.signOutBtn.style.display = signedIn ? 'inline-flex' : 'none';
  if (elements.signInPane) elements.signInPane.style.display = signedIn ? 'none' : 'block';
  if (elements.signedInPane) elements.signedInPane.style.display = signedIn ? 'block' : 'none';
  if (elements.refreshBtn) elements.refreshBtn.disabled = !signedIn;
  if (signedIn) {
    if (elements.authBar) elements.authBar.style.display = 'none';
    if (elements.accountChip) {
      elements.accountChip.style.display = 'inline-flex';
      if (elements.accountEmail) elements.accountEmail.textContent = user.email || 'signed-in';
    }
  } else {
    if (elements.authBar) {
      elements.authBar.style.display = localStorage.getItem('authbar_dismissed') ? 'none' : 'flex';
    }
    if (elements.accountChip) {
      elements.accountChip.style.display = 'none';
      if (elements.accountEmail) elements.accountEmail.textContent = '';
    }
  }
  if (elements.acctEmail2) elements.acctEmail2.textContent = signedIn ? (user?.email || '') : '';
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
  if (realtimeSub) {
    supabase.removeChannel(realtimeSub);
    realtimeSub = null;
  }
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

async function syncDayTotalNow(ymd, expectedBase, target) {
  if (!isRemote() || !projectId) return;
  try {
    const { data, error } = await supabase
      .from('word_events')
      .select('ymd, delta')
      .eq('project_id', projectId)
      .eq('ymd', ymd);
    if (error) throw error;
    const serverTotal = foldEvents(data || [])[ymd] || 0;
    if (typeof expectedBase === 'number' && serverTotal !== expectedBase) {
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
