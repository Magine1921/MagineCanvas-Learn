'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Bot,
  BoxSelect,
  Compass,
  EyeOff,
  FileText,
  Globe,
  Grip,
  Image as ImageIcon,
  Layers,
  Music,
  Pencil,
  Video,
  Sparkles,
} from 'lucide-react';
import { CanvasNodeData } from './CanvasStore';
import { cn } from '@/lib/utils';
import { isEditionNodeTypeDisabled } from '@/lib/edition';

interface NodeMenuItem {
  type: CanvasNodeData['type'];
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const nodeMenuItems: NodeMenuItem[] = [
  {
    type: 'prompt',
    label: '文本',
    icon: <FileText className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '输入文本内容',
  },
  {
    type: 'agent',
    label: 'Agent',
    icon: <Bot className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: 'AI 代理智能体',
  },
  {
    type: 'browser',
    label: '浏览器',
    icon: <Compass className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '登录网页并将下载的媒体拖入画布',
  },
  {
    type: 'image',
    label: '图像生成',
    icon: <ImageIcon className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '生成高质量图像',
  },
  {
    type: 'video',
    label: '视频生成',
    icon: <Video className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '生成动态视频',
  },
  {
    type: 'material',
    label: '素材',
    icon: <Layers className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '上传本地素材文件',
  },
  {
    type: 'storyboard',
    label: '手绘分镜',
    icon: <Pencil className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '白板手绘分镜，连线输出为参考图',
  },
  {
    type: 'panorama',
    label: '720°全景',
    icon: <Globe className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '等距柱状全景图，拖拽环视场景',
  },
  {
    type: 'topazEnhance',
    label: 'Topaz 画质',
    icon: <Sparkles className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: 'Topaz Image API 一键降噪、锐化与放大',
  },
  {
    type: 'faceCompliance',
    label: '人脸合规',
    icon: <EyeOff className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '检测人脸并在眼/嘴区域添加黑色遮罩横条',
  },
  {
    type: 'music',
    label: '音乐/语音',
    icon: <Music className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: 'AI 音乐生成 / 语音合成，输入描述生成音乐或文字转语音',
  },
  {
    type: 'region',
    label: '区域命名',
    icon: <BoxSelect className="w-4 h-4" />,
    color: 'text-zinc-100 hover:bg-white/[0.08] hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]',
    description: '拖拽框选画布区域并命名',
  },
];

interface NodeMenuProps {
  position: { x: number; y: number };
  onSelect: (type: CanvasNodeData['type']) => void;
  onClose: () => void;
  allowedTypes?: readonly CanvasNodeData['type'][];
}

export default function NodeMenu({ position, onSelect, onClose, allowedTypes }: NodeMenuProps) {
  const initialMenuPos = useMemo(() => ({ x: position.x, y: position.y }), [position.x, position.y]);
  const allowedTypeSet = useMemo(() => (allowedTypes ? new Set(allowedTypes) : null), [allowedTypes]);
  const [menuPos, setMenuPos] = useState(initialMenuPos);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.target === event.currentTarget || (event.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      setDragStart({
        x: event.clientX - menuPos.x,
        y: event.clientY - menuPos.y,
      });
    }
  };

  useEffect(() => {
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      setMenuPos({
        x: event.clientX - dragStart.x,
        y: event.clientY - dragStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragStart, isDragging]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 select-none" onClick={onClose} />

      <div
        data-tutorial-id="canvas-node-menu"
        className={cn(
          'mc-popover mc-node-menu-glass fixed z-50 min-w-[244px] overflow-hidden rounded-lg',
          'select-none',
          isDragging ? 'cursor-grabbing' : ''
        )}
        style={{
          left: menuPos.x,
          top: menuPos.y,
          '--mc-popover-base-transform': 'translate(-50%, 0)',
        } as CSSProperties & Record<'--mc-popover-base-transform', string>}
        onMouseDown={handleMouseDown}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          window.getSelection()?.removeAllRanges();
        }}
      >
        <div className="drag-handle flex cursor-grab items-center gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2.5 active:cursor-grabbing">
          <Grip className="h-3 w-3 text-slate-600" />
          <p className="text-xs font-medium text-slate-300">选择节点类型</p>
          <button
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-xs text-slate-500 transition-colors hover:border-white/28 hover:bg-white/[0.1] hover:text-zinc-100 hover:shadow-[0_0_12px_rgba(255,255,255,0.1)]"
          >
            ×
          </button>
        </div>

        <div className="space-y-0.5 p-1.5">
          {nodeMenuItems.filter(
            (item) => !isEditionNodeTypeDisabled(item.type) && (!allowedTypeSet || allowedTypeSet.has(item.type))
          ).map((item) => (
            <button
              key={item.type}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item.type);
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-all mc-dur-9f',
                item.color,
                'hover:border-white/22 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)]'
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] shadow-inner shadow-white/5">
                {item.icon}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-medium text-slate-100">{item.label}</span>
                <span className="truncate text-[10px] text-slate-500">{item.description}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="border-t border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[9px] text-slate-600">
            拖拽标题栏移动 · 点击外部关闭 · ESC 关闭 · 空白处左键拖拽可框选节点
          </p>
        </div>
      </div>
    </>
  );
}
