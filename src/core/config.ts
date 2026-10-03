// Schema-driven configuration store. The dev settings menu and the arena customizer are both
// generated from these schemas, so adding a knob is one entry: it shows up in the UI, persists,
// and notifies listeners live.

export type ConfigValue = number | boolean | string;

interface DefBase {
  key: string;
  label: string;
  group: string;
  help?: string;
  /** hidden from the generated UI (internal values) */
  hidden?: boolean;
  /** only show when another bool setting is on */
  showIf?: string;
}
export interface BoolDef extends DefBase { type: 'bool'; def: boolean }
export interface RangeDef extends DefBase { type: 'range'; def: number; min: number; max: number; step: number; unit?: string; fmt?: (v: number) => string }
export interface SelectDef extends DefBase { type: 'select'; def: string; options: { value: string; label: string }[] }
export interface ColorDef extends DefBase { type: 'color'; def: string }
export type SettingDef = BoolDef | RangeDef | SelectDef | ColorDef;

export type Preset = { id: string; label: string; help?: string; values: Record<string, ConfigValue> };

type Listener = (key: string, value: ConfigValue) => void;

export class ConfigStore {
  readonly defs: SettingDef[];
  readonly byKey = new Map<string, SettingDef>();
  readonly values: Record<string, ConfigValue> = {};
  private listeners: Listener[] = [];
  private keyListeners = new Map<string, Listener[]>();
  readonly presets: Preset[];

  constructor(readonly storageKey: string | null, defs: SettingDef[], presets: Preset[] = []) {
    this.defs = defs;
    this.presets = presets;
    for (const d of defs) {
      if (this.byKey.has(d.key)) console.warn('duplicate setting key', d.key);
      this.byKey.set(d.key, d);
      this.values[d.key] = d.def;
    }
    this.load();
  }

  groups(): string[] {
    const out: string[] = [];
    for (const d of this.defs) if (!d.hidden && !out.includes(d.group)) out.push(d.group);
    return out;
  }

  num(key: string): number {
    const v = this.values[key];
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = parseFloat(String(v));
    return isFinite(n) ? n : 0;
  }
  bool(key: string): boolean { return !!this.values[key]; }
  str(key: string): string { return String(this.values[key]); }
  get(key: string): ConfigValue { return this.values[key]; }

  set(key: string, value: ConfigValue, persist = true) {
    const d = this.byKey.get(key);
    if (!d) { console.warn('unknown setting', key); return; }
    let v: ConfigValue = value;
    if (d.type === 'range') v = Math.min(d.max, Math.max(d.min, Number(value)));
    else if (d.type === 'bool') v = !!value;
    else v = String(value);
    if (this.values[key] === v) return;
    this.values[key] = v;
    if (persist) this.save();
    for (const f of this.keyListeners.get(key) ?? []) f(key, v);
    for (const f of this.listeners) f(key, v);
  }
  setMany(vals: Record<string, ConfigValue>) {
    for (const k in vals) if (this.byKey.has(k)) this.set(k, vals[k], false);
    this.save();
  }
  reset(group?: string) {
    for (const d of this.defs) if (!group || d.group === group) this.set(d.key, d.def, false);
    this.save();
  }
  applyPreset(id: string) {
    const p = this.presets.find((x) => x.id === id);
    if (p) this.setMany(p.values);
  }
  onChange(f: Listener): () => void {
    this.listeners.push(f);
    return () => { this.listeners = this.listeners.filter((x) => x !== f); };
  }
  on(key: string, f: Listener): () => void {
    const arr = this.keyListeners.get(key) ?? [];
    arr.push(f);
    this.keyListeners.set(key, arr);
    return () => this.keyListeners.set(key, (this.keyListeners.get(key) ?? []).filter((x) => x !== f));
  }
  snapshot(): Record<string, ConfigValue> { return { ...this.values }; }
  diffFromDefaults(): Record<string, ConfigValue> {
    const out: Record<string, ConfigValue> = {};
    for (const d of this.defs) if (this.values[d.key] !== d.def) out[d.key] = this.values[d.key];
    return out;
  }
  save() {
    if (!this.storageKey) return;
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.diffFromDefaults())); } catch { /* private mode */ }
  }
  load() {
    if (!this.storageKey) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, ConfigValue>;
      for (const k in data) {
        const d = this.byKey.get(k);
        if (!d) continue;
        if (d.type === 'select' && !d.options.some((o) => o.value === data[k])) continue;
        this.values[k] = d.type === 'range' ? Math.min(d.max, Math.max(d.min, Number(data[k]))) : data[k];
      }
    } catch { /* ignore corrupt */ }
  }
}

export const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
