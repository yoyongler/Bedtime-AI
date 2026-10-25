import { Suspense, lazy } from 'react';

const AudioLab = lazy(() => import('./AudioLab'));

/**
 * Dev-only audition harness. Kept behind a lazy import so it never lands in the
 * production bundle. Reachable at /?audiotest=1.
 */
export const AudioLabRoute: React.FC = () => (
  <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
    <AudioLab />
  </Suspense>
);

export default AudioLabRoute;
