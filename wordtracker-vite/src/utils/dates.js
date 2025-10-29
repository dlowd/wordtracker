export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export const pad = (n) => String(n).padStart(2, "0");

export const ymdUTC = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const ymdLocal = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function parseYMD(value) {
  const [Y, M, D] = String(value || "").split("-").map(Number);
  return new Date(Date.UTC(Y || 0, (M || 1) - 1, D || 1));
}

export function datesInRangeUTC(startYMD, endYMD) {
  const days = [];
  let cursor = parseYMD(startYMD);
  const end = parseYMD(endYMD);
  while (cursor <= end) {
    days.push(ymdUTC(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }
  return days;
}

export const fmtMD = (ymd) => {
  const [_, month, day] = ymd.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
};

export const fmtRange = (start, end) => {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const sameYear = y1 === y2;
  if (sameYear && m1 === m2) {
    return `${MONTHS[m1 - 1]} ${d1} – ${d2}`;
  }
  if (sameYear) {
    return `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
  }
  return `${MONTHS[m1 - 1]} ${d1}, ${y1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
};
