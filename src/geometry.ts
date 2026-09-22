import type { DockSide, Rectangle } from "./types";

export const MIN_DOCK_WIDTH = 320;
export const MIN_REMAINING_WIDTH = 480;
export const MIN_DOCK_PERCENT = 15;
export const MAX_DOCK_PERCENT = 60;

export function computeDockRect(area: Rectangle, widthPercent: number, side: DockSide): Rectangle {
  const requested = Math.round(area.width * Math.min(MAX_DOCK_PERCENT, Math.max(MIN_DOCK_PERCENT, widthPercent)) / 100);
  return computeDockRectFromWidth(area, requested, side);
}

export function clampDockWidth(areaWidth: number, requestedWidth: number): number {
  const maximumByPercent = Math.round(areaWidth * MAX_DOCK_PERCENT / 100);
  const maximumByRemainingSpace = Math.max(1, areaWidth - Math.min(MIN_REMAINING_WIDTH, Math.floor(areaWidth / 2)));
  const maximum = Math.min(maximumByPercent, maximumByRemainingSpace);
  const minimumByPercent = Math.round(areaWidth * MIN_DOCK_PERCENT / 100);
  const minimum = Math.min(maximum, Math.max(Math.min(MIN_DOCK_WIDTH, maximum), minimumByPercent));
  return Math.min(maximum, Math.max(minimum, Math.round(requestedWidth)));
}

export function computeDockRectFromWidth(area: Rectangle, requestedWidth: number, side: DockSide): Rectangle {
  const width = clampDockWidth(area.width, requestedWidth);
  return {
    x: side === "left" ? area.x : area.x + area.width - width,
    y: area.y,
    width,
    height: area.height
  };
}

export function computeAdjacentRect(workArea: Rectangle, dockBounds: Rectangle, side: DockSide): Rectangle {
  const workAreaRight = workArea.x + workArea.width;
  const dockBoundary = side === "left"
    ? dockBounds.x + dockBounds.width
    : dockBounds.x;
  const boundary = Math.min(workAreaRight, Math.max(workArea.x, dockBoundary));
  return side === "left"
    ? { x: boundary, y: workArea.y, width: Math.max(1, workAreaRight - boundary), height: workArea.height }
    : { x: workArea.x, y: workArea.y, width: Math.max(1, boundary - workArea.x), height: workArea.height };
}

export function dockWidthPercent(areaWidth: number, width: number): number {
  if (areaWidth <= 0) return MIN_DOCK_PERCENT;
  const percent = clampDockWidth(areaWidth, width) / areaWidth * 100;
  return Math.round(Math.min(MAX_DOCK_PERCENT, Math.max(MIN_DOCK_PERCENT, percent)) * 10) / 10;
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
