import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { RoomId } from '../../../game/types';
import type { RoomProps } from './types';

export type { RoomId };

// The places the table can stand in. Each room is its own module and loads when it is first shown.
// To add one: build it like Bar.tsx (a component that draws everything around the table)
// and list it here. The game picks the room by id.

export const ROOMS: Record<RoomId, { name: string; component: LazyExoticComponent<ComponentType<RoomProps>> }> = {
  bar: { name: 'Bar', component: lazy(() => import('./Bar')) },
  space: { name: 'Space', component: lazy(() => import('./Space')) },
};

export const DEFAULT_ROOM: RoomId = 'bar';
