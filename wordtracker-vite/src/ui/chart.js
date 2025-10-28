import { fmtMD } from '../utils/dates.js';

const AXIS_COLOR = '#334155';
const TICK_COLOR = '#94a3b8';

export function createChartRenderer(chartEl, tooltipEl) {
  let chartRect = null;
  const refreshBounds = () => {
    if (chartEl) chartRect = chartEl.getBoundingClientRect();
  };

  function dispose() {
    window.removeEventListener('resize', refreshBounds);
  }

  window.addEventListener('resize', refreshBounds);

  function renderChart(series, { viewingDay, project, cutoffIndexOverride }) {
    if (!chartEl) return;
    const { days, daysForChart, daily, cumulative, pace, baseline } = series;
    const W = 820;
    const H = 240;
    const X0 = 90;
    const Y0 = 320;
    const RP = 36;
    const W2 = W - RP;
    const maxY = Math.max(project.goalWords, ...cumulative, baseline, 1);
    const xCount = daysForChart.length;
    const toPts = (arr) =>
      arr
        .map((value, index) => {
          const x = X0 + (index / Math.max(1, xCount - 1)) * W2;
          const y = Y0 - (value / maxY) * H;
          return `${x},${y}`;
        })
        .join(' ');

    const vDay = viewingDay();
    const lastDay = days.length ? days[days.length - 1] : null;
    const firstDay = days.length ? days[0] : null;
    let cutoffIndex;
    if (!vDay || !firstDay || !lastDay) cutoffIndex = 0;
    else if (vDay < firstDay) cutoffIndex = 0;
    else if (vDay > lastDay) cutoffIndex = xCount - 1;
    else cutoffIndex = days.indexOf(vDay) + 1;
    if (typeof cutoffIndexOverride === 'number') {
      cutoffIndex = cutoffIndexOverride;
    }

    const xFor = (index) => X0 + (index / Math.max(1, xCount - 1)) * W2;
    const yFor = (value) => Y0 - (value / maxY) * H;
    const cumPts = Array.from({ length: cutoffIndex + 1 }, (_, index) => `${xFor(index)},${yFor(cumulative[index])}`).join(
      ' '
    );

    const yTicks = 5;
    let yLines = '';
    let yTickLabels = '';
    for (let i = 0; i <= yTicks; i++) {
      const val = Math.round((maxY / yTicks) * i);
      const y = Y0 - (val / maxY) * H;
      yLines += `<line x1="${X0}" y1="${y}" x2="${X0 + W2}" y2="${y}" stroke="#e2e8f0"/>`;
      yTickLabels += `<text x="${X0 - 10}" y="${y + 4}" text-anchor="end" class="axis-tick">${val.toLocaleString()}</text>`;
    }

    let xTicks = '';
    let xTickLabels = '';
    const tickEvery = Math.max(1, Math.floor((xCount - 1) / 6));
    for (let i = 1; i < xCount; i++) {
      if (i === xCount - 1 || i % tickEvery === 0) {
        const x = X0 + (i / Math.max(1, xCount - 1)) * W2;
        xTicks += `<line x1="${x}" y1="${Y0}" x2="${x}" y2="${Y0 + 6}" stroke="${TICK_COLOR}"/>`;
        const label = fmtMD(days[i - 1]);
        xTickLabels += `<text x="${x}" y="${Y0 + 22}" text-anchor="middle" class="axis-tick">${label}</text>`;
      }
    }

    const chartTitle = `${project.name || 'Project'} — Progress`;
    chartEl.innerHTML = `
    <rect x="0" y="0" width="900" height="400" fill="#fff" rx="14"/>
    <text x="${X0 + W2 / 2}" y="${Y0 - H - 30}" text-anchor="middle" class="chart-title">${chartTitle}</text>
    <g>
      ${yLines}
      <line x1="${X0}" y1="${Y0 - H}" x2="${X0}" y2="${Y0}" stroke="${AXIS_COLOR}" stroke-width="1.25"/>
      <line x1="${X0}" y1="${Y0}" x2="${X0 + W2}" y2="${Y0}" stroke="${AXIS_COLOR}" stroke-width="1.25"/>
      ${yTickLabels}
      ${xTicks}
      ${xTickLabels}
      <text x="${X0 + W2 / 2}" y="${Y0 + 40}" text-anchor="middle" class="axis-title">Days</text>
      <text x="${X0 - 56}" y="${Y0 - H / 2}" text-anchor="middle" class="axis-title" transform="rotate(-90 ${X0 - 56},${Y0 - H / 2})">Words</text>
    </g>
    <polyline points="${toPts(pace)}" fill="none" stroke="var(--pace)" stroke-width="2" stroke-dasharray="4 4"/>
    <polyline id="cumLine" points="${cumPts}" fill="none" stroke="var(--leaf)" stroke-width="3"/>
    <g id="hover">
      <line id="vline" x1="0" y1="${Y0 - H}" x2="0" y2="${Y0}" stroke="#64748b" stroke-dasharray="3 3" opacity="0"/>
      <circle id="dot" cx="0" cy="0" r="5" fill="var(--leaf)" stroke="#fff" stroke-width="2" opacity="0"/>
    </g>`;

    const vline = /** @type {SVGLineElement|null} */ (chartEl.querySelector('#vline'));
    const dot = /** @type {SVGCircleElement|null} */ (chartEl.querySelector('#dot'));
    refreshBounds();

    const atX = (clientX) => {
      if (!chartRect || !vline || !dot || !tooltipEl) return;
      const { left } = chartRect;
      const x = clientX - left;
      const t = Math.max(0, Math.min(1, (x - X0) / W2));
      const i = Math.round(t * (xCount - 1));
      if (i > cutoffIndex) {
        hide();
        return;
      }
      const xi = X0 + (i / Math.max(1, xCount - 1)) * W2;
      const yi = Y0 - ((i >= 0 ? cumulative[i] : 0) / maxY) * H;
      vline.setAttribute('x1', xi);
      vline.setAttribute('x2', xi);
      vline.setAttribute('opacity', '1');
      dot.setAttribute('cx', xi);
      dot.setAttribute('cy', yi);
      dot.setAttribute('opacity', '1');
      tooltipEl.style.left = `${xi}px`;
      tooltipEl.style.top = `${yi}px`;
      tooltipEl.style.opacity = '1';
      tooltipEl.setAttribute('aria-hidden', 'false');
      const isBaseline = i === 0;
      const label = isBaseline ? 'Starting words' : fmtMD(days[i - 1]);
      const added = isBaseline ? null : daily[i - 1] || 0;
      tooltipEl.innerHTML = stackedTooltipHTML(label, added, cumulative[i], pace[i]);
    };

    const hide = () => {
      if (!vline || !dot || !tooltipEl) return;
      vline.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      tooltipEl.style.opacity = '0';
      tooltipEl.setAttribute('aria-hidden', 'true');
    };

    chartEl.onmousemove = (event) => atX(event.clientX);
    chartEl.onmouseleave = hide;
    chartEl.ontouchstart = (event) => {
      if (event.touches[0]) atX(event.touches[0].clientX);
    };
    chartEl.ontouchmove = (event) => {
      if (event.touches[0]) atX(event.touches[0].clientX);
    };
    chartEl.ontouchend = hide;
  }

  return { renderChart, refreshBounds, dispose };
}

function stackedTooltipHTML(label, added, total, paceValue) {
  return `
  <div class="tt-title">${label}</div>
  <div class="tt-row"><span>Added</span><strong>${added === null ? '—' : (added || 0).toLocaleString()}</strong></div>
  <div class="tt-row"><span>Total</span><strong>${(total || 0).toLocaleString()}</strong></div>
  <div class="tt-row"><span>Pace</span><strong>${(paceValue || 0).toLocaleString()}</strong></div>`;
}
