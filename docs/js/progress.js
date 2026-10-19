export const SAVE_KEY = 'coinRunnerProgress';
export class Progress {
  constructor(storage, count) {
    this.storage = storage; this.count = count; this.unlocked = 1; this.best = 0;
    try {
      const save = JSON.parse(storage.getItem(SAVE_KEY));
      if (save?.version === 1 && Number.isInteger(save.unlocked))
        this.unlocked = Math.max(1, Math.min(count, save.unlocked));
      const legacy = Number(storage.getItem('coinRunnerHighScore'));
      this.best = Math.max(0, Number.isFinite(save?.best) ? save.best : 0,
        Number.isFinite(legacy) ? legacy : 0);
    } catch { /* Storage denied or malformed: the game remains playable. */ }
  }
  save() {
    try { this.storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, unlocked: this.unlocked, best: this.best })); }
    catch { /* Private/blocked storage: keep progress in memory. */ }
  }
  complete(index, score) {
    this.unlocked = Math.max(this.unlocked, Math.min(this.count, index + 2));
    this.record(score);
  }
  record(score) { this.best = Math.max(this.best, score); this.save(); }
  reset() {
    this.unlocked = 1; this.best = 0;
    try { this.storage.removeItem('coinRunnerHighScore'); } catch { /* optional */ }
    this.save();
  }
}
