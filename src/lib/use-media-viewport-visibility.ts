'use client';

import { useEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN_PX = 240;

type VisibilityListener = (visible: boolean) => void;

const listeners = new Map<HTMLElement, VisibilityListener>();
let intersectionObserver: IntersectionObserver | null = null;
let viewportObserver: MutationObserver | null = null;
let observedViewport: Element | null = null;
let animationFrame = 0;
let globalListenersAttached = false;

function isNearViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    document.visibilityState !== 'hidden' &&
    rect.bottom >= -VIEWPORT_MARGIN_PX &&
    rect.right >= -VIEWPORT_MARGIN_PX &&
    rect.top <= window.innerHeight + VIEWPORT_MARGIN_PX &&
    rect.left <= window.innerWidth + VIEWPORT_MARGIN_PX
  );
}

function updateAllVisibility(): void {
  animationFrame = 0;
  for (const [element, listener] of listeners) listener(isNearViewport(element));
}

function scheduleVisibilityUpdate(): void {
  if (animationFrame) return;
  animationFrame = window.requestAnimationFrame(updateAllVisibility);
}

function ensureObservers(element: HTMLElement): void {
  if (!intersectionObserver && typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(scheduleVisibilityUpdate, {
      root: null,
      rootMargin: `${VIEWPORT_MARGIN_PX}px`,
    });
  }
  const viewport = element.closest('.react-flow__viewport');
  if (viewport && viewport !== observedViewport && typeof MutationObserver !== 'undefined') {
    viewportObserver?.disconnect();
    observedViewport = viewport;
    viewportObserver = new MutationObserver(scheduleVisibilityUpdate);
    viewportObserver.observe(viewport, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  if (!globalListenersAttached) {
    globalListenersAttached = true;
    document.addEventListener('visibilitychange', scheduleVisibilityUpdate);
    window.addEventListener('resize', scheduleVisibilityUpdate);
    window.addEventListener('scroll', scheduleVisibilityUpdate, true);
  }
}

function removeGlobalObserversIfIdle(): void {
  if (listeners.size > 0) return;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  viewportObserver?.disconnect();
  viewportObserver = null;
  observedViewport = null;
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  if (globalListenersAttached) {
    globalListenersAttached = false;
    document.removeEventListener('visibilitychange', scheduleVisibilityUpdate);
    window.removeEventListener('resize', scheduleVisibilityUpdate);
    window.removeEventListener('scroll', scheduleVisibilityUpdate, true);
  }
}

function subscribeElement(element: HTMLElement, listener: VisibilityListener): () => void {
  listeners.set(element, listener);
  ensureObservers(element);
  intersectionObserver?.observe(element);
  listener(isNearViewport(element));
  return () => {
    listeners.delete(element);
    intersectionObserver?.unobserve(element);
    removeGlobalObserversIfIdle();
  };
}

export function useMediaViewportVisibility<T extends HTMLElement>() {
  const elementRef = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let previous = true;
    return subscribeElement(element, (visible) => {
      if (visible === previous) return;
      previous = visible;
      setIsVisible(visible);
    });
  }, []);

  return [elementRef, isVisible] as const;
}
