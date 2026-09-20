'use client';

import { memo } from 'react';
import { type EdgeProps, getBezierPath } from 'reactflow';

/** 贝塞尔连线：无传输动效，悬停提亮由全局 `.react-flow__edge:hover` 样式控制 */
function BeamEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  style,
  interactionWidth = 18,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={{ stroke: 'rgba(225, 225, 225, 0.5)', ...style }}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        markerEnd={markerEnd}
        markerStart={markerStart}
      />

      {interactionWidth ? (
        <path
          d={edgePath}
          fill="none"
          strokeOpacity={0}
          strokeWidth={interactionWidth}
          className="react-flow__edge-interaction"
        />
      ) : null}
    </>
  );
}

export default memo(BeamEdge);
