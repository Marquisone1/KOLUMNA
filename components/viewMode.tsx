import { Component, type ReactNode } from 'react';

export type ViewMode = '2d' | '3d';

let webgl: boolean | null = null;
/** True when this browser can create a WebGL context at all */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

export function initialViewMode(): ViewMode {
  let saved: string | null = null;
  try { saved = localStorage.getItem('kolumna:view'); } catch { /* ignore */ }
  if (new URLSearchParams(location.search).get('view') === '2d') return '2d';
  if (saved === '2d') return '2d';
  return hasWebGL() ? '3d' : '2d';
}

export function saveViewMode(m: ViewMode) {
  try { localStorage.setItem('kolumna:view', m); } catch { /* ignore */ }
}

/** If the 3D table fails to start (lost context, driver trouble), fall back to 2D */
export class ViewBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
