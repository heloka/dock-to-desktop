import type { DockSide, Rectangle } from "./types";

export const MIN_DOCK_WIDTH = 320;
export const MIN_REMAINING_WIDTH = 480;

export function computeDockRect(area: Rectangle, widthPercent: number, side: DockSide): Rectangle {
  const requested = Math.round(area.width * Math.min(60, Math.max(15, widthPercent)) / 100);
  const maximum = Math.max(1, area.width - Math.min(MIN_REMAINING_WIDTH, Math.floor(area.width / 2)));
  const width = Math.min(maximum, Math.max(Math.min(MIN_DOCK_WIDTH, maximum), requested));
  return {
    x: side === "left" ? area.x : area.x + area.width - width,
    y: area.y,
    width,
    height: area.height
  };
}

export function rectFromEdges(rect: { left: number; top: number; right: number; bottom: number }): Rectangle {
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

export function edgesFromRect(rect: Rectangle): { left: number; top: number; right: number; bottom: number } {
  return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
}

export function physicalToDipFallback(physical: Rectangle, displayDip: Rectangle, displayPhysical: Rectangle, scaleFactor: number): Rectangle {
  const scale = scaleFactor || 1;
  return {
    x: Math.round(displayDip.x + (physical.x - displayPhysical.x) / scale),
    y: Math.round(displayDip.y + (physical.y - displayPhysical.y) / scale),
    width: Math.round(physical.width / scale),
    height: Math.round(physical.height / scale)
  };
}

export function screenRectToDip(
  physical: Rectangle,
  displayDip: Rectangle,
  displayPhysical: Rectangle,
  scaleFactor: number,
  nativeConverter?: (rect: Rectangle) => Rectangle
): Rectangle {
  if (nativeConverter) {
    try {
      return nativeConverter(physical);
    } catch {
      // Obsidian's @electron/remote bridge can reject BrowserWindow proxies here.
    }
  }
  return physicalToDipFallback(physical, displayDip, displayPhysical, scaleFactor);
}
