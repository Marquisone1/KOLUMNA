import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
  },
  // modules the 3D table loads on demand; pre-bundled so the dev server never re-optimizes
  // mid-session (that would load React twice, since HMR is off)
  optimizeDeps: {
    include: [
      'three',
      '@react-three/fiber',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/GTAOPass.js',
      'three/examples/jsm/postprocessing/SMAAPass.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
    ],
  },
});
