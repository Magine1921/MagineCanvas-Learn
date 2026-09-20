'use client';

import dynamic from 'next/dynamic';

const PixiCanvasDemoClient = dynamic(
  () => import('./PixiCanvasDemoClient'),
  { ssr: false },
);

export default function PixiCanvasDemoPage() {
  return <PixiCanvasDemoClient />;
}
