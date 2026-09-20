'use client';

import dynamic from 'next/dynamic';

const HomeClient = dynamic(() => import('./HomeClient'), { ssr: false });

export default function HomePage() {
  return <HomeClient />;
}
