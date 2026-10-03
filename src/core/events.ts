// Minimal typed event bus. Systems publish gameplay facts ("ship sunk", "torpedo fired") so the
// HUD, audio, scoring and loot can react without importing each other.

type Handler<T> = (payload: T) => void;

export class Bus<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Handler<never>[]>();
  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const arr = (this.map.get(type) ?? []) as Handler<Events[K]>[];
    arr.push(fn);
    this.map.set(type, arr as Handler<never>[]);
    return () => this.off(type, fn);
  }
  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>) {
    const arr = (this.map.get(type) ?? []) as Handler<Events[K]>[];
    this.map.set(type, arr.filter((f) => f !== fn) as Handler<never>[]);
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    const arr = this.map.get(type) as Handler<Events[K]>[] | undefined;
    if (!arr) return;
    for (const f of arr.slice()) {
      try { f(payload); } catch (e) { console.error('event handler failed', String(type), e); }
    }
  }
  clear() { this.map.clear(); }
}
