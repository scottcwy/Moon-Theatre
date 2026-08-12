import fs from 'node:fs';
import path from 'node:path';

/**
 * 自定义导航页（navigationStyle:'custom'）的页面布局从屏幕顶部开始（内容延伸进状态栏区域），
 * boundingClientRect 的纵向坐标系随之上移，其底部边界的比较口径应为屏幕高而非可用窗口高。
 * 通过编译产物 dist/<pagePath>.json 的 navigationStyle 判定。
 */
export function isCustomNavigationPage(distDir, pagePath) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(distDir, `${pagePath}.json`), 'utf8'));
    return config.navigationStyle === 'custom';
  } catch {
    return false;
  }
}

export function mergeOffsetAndSize(offset = {}, size = {}) {
  const left = Number(offset.left ?? 0);
  const top = Number(offset.top ?? 0);
  const width = Number(offset.width ?? size.width ?? 0);
  const height = Number(offset.height ?? size.height ?? 0);

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function rectanglesOverlap(a, b) {
  return a.left < b.right
    && a.right > b.left
    && a.top < b.bottom
    && a.bottom > b.top;
}

export function isRectBelow(rect, boundary, clearance = 0) {
  return Number(rect.top) >= Number(boundary.bottom) + clearance;
}

export function isFullyOutsideViewport(rect, viewport) {
  return rect.right <= 0
    || rect.bottom <= 0
    || rect.left >= viewport.width
    || rect.top >= viewport.height;
}

export function buildElementFailures({
  label,
  selector,
  rect,
  viewport,
  mustFitViewportBottom = false,
}) {
  const failures = [];

  if (rect.width <= 0 || rect.height <= 0) {
    failures.push({
      label,
      selector,
      reason: 'element has zero width or height',
    });
  }

  if (isFullyOutsideViewport(rect, viewport)) {
    failures.push({
      label,
      selector,
      reason: 'element is fully outside the viewport',
    });
  }

  if (mustFitViewportBottom && rect.bottom > viewport.height) {
    failures.push({
      label,
      selector,
      reason: 'element bottom exceeds viewport bottom',
    });
  }

  return failures;
}
