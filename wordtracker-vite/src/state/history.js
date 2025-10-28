export function createHistory() {
  let last = null;
  return {
    push(date, delta) {
      last = { date, delta };
    },
    pop() {
      const snapshot = last;
      last = null;
      return snapshot;
    },
    peek() {
      return last;
    },
    clear() {
      last = null;
    },
  };
}
