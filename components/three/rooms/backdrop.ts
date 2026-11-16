import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** A room sets the colour behind everything and its haze (or none) while it is shown */
export function useBackdrop(color: string, fog: [near: number, far: number] | null) {
  const { scene, invalidate } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(color);
    scene.fog = fog ? new THREE.Fog(color, fog[0], fog[1]) : null;
    invalidate();
  }, [scene, invalidate, color, fog?.[0], fog?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
}
