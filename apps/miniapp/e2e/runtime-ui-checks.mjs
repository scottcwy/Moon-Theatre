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
