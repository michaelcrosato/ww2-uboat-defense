// Silhouette icons for the touch buttons: filled 24×24 shapes (currentColor) that stay crisp at any size.

const PATHS: Record<string, string> = {
  torpedo: '<path d="M2 12c0-1.1.9-2 2-2h11l6 2-6 2H4c-1.1 0-2-.9-2-2z"/><path d="M2.5 7.5l3.5 3H4.2zM2.5 16.5l3.5-3H4.2z"/>',
  depth: '<path d="M3 16h13l3.5 2-3.5 2H5l-2-2z"/><path d="M8.5 13h4l1 3h-6z"/><path d="M18 2l3.5 4h-2.3v4h-2.4V6h-2.3zM6 11l-3.5-4h2.3V3h2.4v4h2.3z"/>',
  periscope: '<path d="M10.5 2h6v3.6h-3.6V18h-2.4z"/><path d="M16.5 2l3 1.8-3 1.8z"/><path d="M2 19h20v2.4H2z"/>',
  star: '<path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.9l-6.1 3.5 1.5-6.8L2.2 9l6.9-.7z"/>',
  charge: '<path d="M6.5 4h11v16h-11z"/><path d="M5 7h14v1.8H5zM5 15.2h14V17H5z" opacity=".55"/>',
  ping: '<circle cx="5" cy="12" r="2.6"/><path d="M9.2 6.6a7.6 7.6 0 0 1 0 10.8l-1.7-1.7a5.2 5.2 0 0 0 0-7.4zM13 2.9a12.8 12.8 0 0 1 0 18.2l-1.7-1.7a10.4 10.4 0 0 0 0-14.8z"/>',
  gun: '<path d="M3 15.5h13.5l2-4.5H6.5z"/><path d="M14 10.6h8v1.8h-8z"/><path d="M2 17h16v2.4H2z"/>',
  pause: '<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/>',
  time: '<path d="M2.5 6l8.5 6-8.5 6zM12 6l8.5 6-8.5 6z"/>',
  dive: '<path d="M10.8 3h2.4v8.5h3.3L12 17.5 7.5 11.5h3.3z"/><path d="M2 19.5h20V22H2z"/>',
  surface: '<path d="M12 3l4.5 6h-3.3v7h-2.4V9H7.5z"/><path d="M2 18.5h20V21H2z"/>',
  hedgehog: '<circle cx="12" cy="5" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="18" cy="16" r="2"/><circle cx="12" cy="19.5" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="12" r="2"/>',
  light: '<path d="M2.5 9.5h5v5h-5z"/><path d="M8 9.8L21.5 4v16L8 14.2z" opacity=".55"/>',
  target: '<path d="M11 2h2v5h-2zM11 17h2v5h-2zM2 11h5v2H2zM17 11h5v2h-5z"/><circle cx="12" cy="12" r="2.4"/>',
};

/** an icon as inline SVG markup */
export function iconSvg(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PATHS[name] ?? PATHS.target}</svg>`;
}
