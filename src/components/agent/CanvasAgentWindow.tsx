'use client';

import { WelcomeAgent } from './WelcomeAgent';

export interface CanvasAgentWindowProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  projectId?: string;
}

export function CanvasAgentWindow({ isOpen, onClose, initialPrompt, onInitialPromptConsumed, projectId }: CanvasAgentWindowProps) {
  return (
    <WelcomeAgent
      isOpen={isOpen}
      onClose={onClose}
      tutorialScope="canvas"
      initialPrompt={initialPrompt}
      onInitialPromptConsumed={onInitialPromptConsumed}
      projectId={projectId}
      onCreateProject={(title, description) => {
        // 画布编辑模式下可通过 agent 创建新项目
        try {
          const id = `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const projects = JSON.parse(localStorage.getItem('magine-canvas-projects') || '[]');
          const now = Date.now();
          const project = { id, title, description: description || '', coverImage: null, createdAt: now, updatedAt: now, workflow: { nodes: [], edges: [] } };
          projects.unshift(project);
          localStorage.setItem('magine-canvas-projects', JSON.stringify(projects.slice(0, 50)));
          return { success: true as const, projectId: id, message: `项目「${title}」已创建` };
        } catch (e) {
          return { success: false as const, message: e instanceof Error ? e.message : '创建失败' };
        }
      }}
      onNavigateToCanvas={() => {
        // 已在画布页面，无需跳转
      }}
    />
  );
}
