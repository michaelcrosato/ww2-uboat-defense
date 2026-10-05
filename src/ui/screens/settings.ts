// Player-facing settings: a curated subset of the dev settings plus fullscreen.

import type { Shell } from '../shell';
import { dev } from '../../core/devSettings';
import { h, type UiScreen } from '../dom';
import { bindRows, button, helpPanel, hintBar, renderSetting, tabs, type SettingRow } from '../widgets';

const SECTIONS: [string, string[]][] = [
  ['Display', ['display.pixelScale', 'display.targetHeight', 'display.renderer', 'display.hudScale', 'display.bearings', 'display.nightOutline', 'display.showFps', 'display.grade', 'camera.shake', 'camera.roll']],
  ['Audio', ['audio.master', 'audio.sfx', 'audio.ambience', 'audio.music', 'audio.chatter']],
  ['Controls', ['controls.scheme', 'controls.mouseSteer', 'controls.deadzone', 'controls.rumble', 'controls.glyphs', 'controls.touch', 'controls.autoAttack', 'controls.autoFullscreen', 'game.aimAssist']],
];

export function settingsScreen(shell: Shell): UiScreen {
  const scr = shell.app.screen;
  const all: SettingRow[] = [];
  const bySection = SECTIONS.map(([, keys]) => keys.map((k) => { const r = renderSetting(dev, dev.byKey.get(k)!); all.push(r); return r; }));
  const list = h('div', { class: 'list' });
  const fsBtn = button('', () => void scr.toggleFullscreen(), 'btn wide-btn', { 'data-help': 'Also F11 or Alt+Enter.' });
  const syncFs = () => { fsBtn.textContent = scr.isFullscreen ? 'Leave fullscreen' : 'Fullscreen'; };
  const extra: HTMLElement[][] = [[fsBtn], [], [button('Rebind controls…', () => shell.open('controls'), 'btn wide-btn')]];
  const tab = tabs(SECTIONS.map((s) => s[0]), (i) => { list.replaceChildren(...extra[i], ...bySection[i].map((r) => r.el)); shell.ui.focusFirstIn(list); });
  const hints = hintBar(shell.app.input, [['menuTabL', 'Tabs']]);
  const el = h('div', { class: 'screen center' },
    h('div', { class: 'panel settings' },
      h('h1', null, 'Settings'),
      tab.el, list, h('div', { class: 'help-slot' }),
      h('div', { class: 'btn-row' }, button('Back', () => shell.ui.back(), 'btn')),
      hints.el));
  el.querySelector('.help-slot')!.replaceWith(helpPanel(el, 'Saved automatically.'));
  let off: () => void = () => {};
  const onFs = () => syncFs();
  return {
    id: 'settings', el,
    onEnter() { off = bindRows(dev, all); document.addEventListener('fullscreenchange', onFs); syncFs(); tab.set(0); },
    onExit() { off(); document.removeEventListener('fullscreenchange', onFs); },
    onTab: (d) => tab.set(tab.index() + d),
    update: () => hints.update(),
  };
}
