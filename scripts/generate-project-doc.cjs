const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat,
} = require('docx');

const doc = new Document({
  styles: {
    default: {
      heading1: { run: { size: '32', bold: true, color: '1a1a2e' } },
      heading2: { run: { size: '26', bold: true, color: '16213e' } },
      heading3: { run: { size: '22', bold: true, color: '0f3460' } },
    },
  },
  numbering: {
    config: [
      {
        reference: 'bullet-list',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }],
      },
    ],
  },
  sections: [
    {
      properties: {},
      children: [
        // ── 标题 ──
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: 'MagineCanvas 项目整体介绍', size: '44', bold: true, color: '1a1a2e' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [new TextRun({ text: '本地画布 AI 创意工作流客户端', size: '24', color: '666666' })],
        }),

        // ═══════ 一 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('一、项目概览')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: 'MagineCanvas', bold: true }),
            new TextRun(' 是一个基于 '),
            new TextRun({ text: 'Next.js 16 + React 19', bold: true }),
            new TextRun(' 的无限画布 AI 创意工作流客户端。使用 '),
            new TextRun({ text: 'React Flow', bold: true }),
            new TextRun(' 构建节点化画布系统，'),
            new TextRun({ text: 'Zustand', bold: true }),
            new TextRun(' 管理全局状态（localStorage 持久化 + IndexedDB 离线大文件），通过 '),
            new TextRun({ text: 'Electron 33', bold: true }),
            new TextRun(' 打包为 Windows 原生桌面应用。'),
          ],
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: '技术栈: Next.js 16 (Turbopack) + React 19 + TypeScript + Tailwind CSS v4 + Zustand + React Flow v11 + Electron 33', font: 'Consolas', size: '18', color: '555555' })],
        }),

        // ═══════ 二 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('二、整体架构')] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.1 页面结构（单页应用）')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: 'App (layout.tsx)\n', font: 'Consolas' }),
            new TextRun({ text: '└── page.tsx 切换两个屏幕:\n', font: 'Consolas' }),
            new TextRun({ text: '    ├── Welcome (首页)', font: 'Consolas' }),
            new TextRun(' — 项目列表、新建画布、音乐卡片、API配置、Agent对话\n'),
            new TextRun({ text: '    └── Canvas (画布编辑器)', font: 'Consolas' }),
            new TextRun(' — 无限画布+侧边栏+Agent窗口+语音助手波形'),
          ],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.2 核心数据流')] }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: 'API配置(SeedanceStore) → 节点生成 → 画布渲染(CanvasStore) → 导出/持久化\n', font: 'Consolas' }),
            new TextRun({ text: '                         ↓\n', font: 'Consolas' }),
            new TextRun({ text: '                  语音助手(VoiceAssistantContext)\n', font: 'Consolas' }),
            new TextRun({ text: '                  Agent系统(agent-tools)', font: 'Consolas' }),
          ],
        }),

        // ═══════ 三 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('三、画布节点系统（12 种节点）')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun('所有节点通过右键菜单或侧边栏拖拽添加到 React Flow 画布，节点间通过拖拽连线传递数据。')],
        }),

        ...createNodeTable(),

        // ═══════ 四 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('四、画布核心功能')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.1 画布编辑器 (CanvasStore ~1310行)')] }),
        ...bulletList([
          ['无限画布', 'React Flow 驱动，支持缩放/平移/小地图/吸附对齐'],
          ['节点操作', '拖拽添加、移动、连线(贝塞尔曲线+光束动画)、删除、复制'],
          ['撤销/重做', '15 步深度的 undo/redo 栈'],
          ['右键菜单', '节点右键 → 删除/复制/导出；画布空白右键 → 添加节点'],
          ['@ 提及系统', '在 PromptNode 中输入 @素材名 引用 MaterialNode 的内容'],
          ['GPU Lite 模式', '侧边栏开关，降低画布渲染负载'],
          ['持久化', '3 分钟间隔自动保存到 .magine-cache/ 磁盘缓存，大数据 URL 自动 offload 到 IndexedDB'],
        ]),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.2 项目管理')] }),
        ...bulletList([
          ['首页', '项目列表（搜索/排序）、新建画布（标题+描述+封面图）'],
          ['操作', '创建、复制、重命名、删除、JSON 导入/导出'],
          ['存储', 'localStorage + Electron 桌面文件持久化（magine-canvas-projects.json）'],
        ]),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.3 工作流模板')] }),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun('4 个内置模板：基础图片生成、图片+增强、故事板到图片、基础视频生成')],
        }),

        // ═══════ 五 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('五、API 配置系统')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.1 配置架构 (SeedanceStore ~1440行)')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun('采用 V2 Provider 架构，每个类别独立管理，支持内置提供商和用户自定义提供商。')],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.2 六大配置类别')] }),
        ...createConfigTable(),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('5.3 音频配置（语音助手核心）')] }),
        ...bulletList([
          ['全模态', 'ElevenLabs ConvAI（已弃用但代码保留）'],
          ['TTS', 'MiniMax Audio（speech-2.8-hd/turbo 等），可选择音色/克隆声音'],
          ['STT', 'ElevenLabs Scribe 或 Qwen3-ASR Flash Realtime'],
        ]),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun('语音助手运行控制开关：音色开关、全模态开关、STT 开关、TTS 开关、自启动开关')],
        }),

        // ═══════ 六 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('六、语音助手系统')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.1 整体管线')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: '用户点击麦克风/自启动\n', font: 'Consolas' }),
            new TextRun({ text: '  → resolveSttProvider() 选择 STT 引擎 (ElevenLabs/Qwen3-ASR/WebSpeech)\n', font: 'Consolas' }),
            new TextRun({ text: '  → 麦克风捕获 PCM 音频\n', font: 'Consolas' }),
            new TextRun({ text: '  → 静音检测(1.2秒)后发送到 STT API\n', font: 'Consolas' }),
            new TextRun({ text: '  → 获取转录文本\n', font: 'Consolas' }),
            new TextRun({ text: '  → 如有 Agent Sink，直接喂给 Agent；否则走语音 LLM\n', font: 'Consolas' }),
            new TextRun({ text: '  → runAssistant() → 流式 LLM 生成回复(最多 64 tokens)\n', font: 'Consolas' }),
            new TextRun({ text: '  → speak() → TTS 播放 (ElevenLabs/MiniMax/Browser)\n', font: 'Consolas' }),
            new TextRun({ text: '  → 播放期间启动打断监控 (startBargeInMonitor)\n', font: 'Consolas' }),
            new TextRun({ text: '  → TTS 播完后自动重启 STT 收音 (连续对话模式)', font: 'Consolas' }),
          ],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.2 打断机制（Barge-In）')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun('TTS 播放期间独立麦克风持续监听 → 连续 4 帧(约 400ms)音量超过阈值 → 立即停止 TTS → 按配置的 STT 提供方自动切换回收音。'),
          ],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.3 主动交互（15 种场景）')] }),
        new Paragraph({ children: [new TextRun('每 15 秒检测一次用户活动状态，全局 120 秒冷却：')] }),
        ...createProactiveTable(),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('6.4 空闲管理（5 阶段渐进式）')] }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: 'grace(10s) → thinking(60s) → nudge(轻推提示) → waiting(90s) → farewell(告别并关闭)', font: 'Consolas' }),
          ],
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun('动态倍速：标签页隐藏 ×0.35、深夜 ×1.6、高活跃 ×1.4、频繁重置 ×1.5')],
        }),

        // ═══════ 七 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('七、Agent 系统')] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('7.1 Agent 能力（57 个工具）')] }),
        ...createAgentToolsTable(),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('7.2 Slash 命令')] }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: '/help /clear /undo /redo /permission /model /save /load /sessions /status /voice /name /memories /forget', font: 'Consolas' })],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('7.3 权限模式')] }),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: 'read-only (只读) / canvas-write (画布可写) / full-access (完全访问)', font: 'Consolas' })],
        }),

        // ═══════ 八 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('八、视频编辑站（Edit Station）')] }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun('视频编辑站已从商业分发版本中移除，避免第三方编辑器授权不清带来的合规风险。当前项目保留画布节点、素材生成、API 配置与导出辅助能力。'),
          ],
        }),

        // ═══════ 九 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('九、其他功能')] }),
        ...bulletList([
          ['网易云音乐', '搜索/播放/歌单，扫码登录，端口 3370（Electron 内嵌 NeteaseCloudMusicApi）'],
          ['人脸合规', 'face-api.js 检测人脸/眼睛/嘴巴，自动模糊处理'],
          ['流媒体链接', '抖音/B站/快手/微信/YouTube/小红书等平台链接'],
          ['欢迎页音乐卡片', '嵌入式音乐播放器，与画布音乐节点联动'],
          ['灵感便签', '首页浮动励志语录组件，可拖拽布局'],
        ]),

        // ═══════ 十 ═══════
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('十、桌面打包')] }),
        ...bulletList([
          ['Electron 33 主进程', '开发模式连接 localhost:3000，生产模式内嵌 Next.js standalone + 网易云音乐 API'],
          ['安装包', 'NSIS 安装程序，支持自定义安装路径'],
          ['ASAR 打包', 'sharp/img/NeteaseCloudMusicApi 模块解包运行'],
          ['麦克风权限', '自动授权（语音助手需要）'],
        ]),
        new Paragraph({
          spacing: { after: 300 },
          children: [new TextRun({ text: '打包命令：npm run dist:win → 输出 dist-installer-2/MagineCanvas-Setup-0.2.0.exe', font: 'Consolas', size: '18' })],
        }),

        // ── 文件路径信息 ──
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('核心文件路径参考')] }),
        ...bulletList([
          ['语音助手核心', 'src/components/voice/voiceAssistantContext.tsx (~1911行)'],
          ['画布状态管理', 'src/components/canvas/CanvasStore.ts (~1310行)'],
          ['API 配置状态', 'src/components/seedance/SeedanceStore.ts (~1440行)'],
          ['API 配置界面', 'src/components/seedance/SeedanceConfig.tsx'],
          ['Agent 工具定义', 'src/components/agent/agent-tools.ts (57个工具)'],
          ['主动交互', 'src/components/voice/voice-assistant-proactive-interaction.ts (15场景)'],
          ['TTS 播放引擎', 'src/lib/elevenlabs/ttsPlayback.ts'],
          ['Electron 主进程', 'electron/main.cjs (~405行)'],
          ['打包配置', 'package.json (build 字段)'],
        ]),
      ],
    },
  ],
});

// ══════════════ helper functions ══════════════

function createNodeTable() {
  const headers = [
    { text: '节点', width: 1200 }, { text: '功能', width: 1800 }, { text: '交互逻辑', width: 6000 },
  ];
  const rows = [
    ['PromptNode', '文本输入节点', '编辑文本 → 连线到下游生成节点作为 prompt 输入'],
    ['ImageNode', 'AI 图片生成', '接收上游 prompt → 选择模型/宽高比/分辨率 → 点击生成 → 预览、下载、连线'],
    ['VideoNode', 'AI 视频生成', '文生视频(T2V)和图生视频(I2V) → Seedance/Kling/Hailuo 等引擎 → 生成预览'],
    ['LLMNode', '大语言模型', '输入 prompt → 选择模型 → 流式输出文本'],
    ['AgentNode', '自主 AI Agent', '聊天式交互 → 操作画布/读写文件/搜索网页/执行终端'],
    ['MusicNode', 'AI 音乐/音频', 'MiniMax/Suno/ElevenLabs → 输入歌词/风格 → 生成音乐 + TTS'],
    ['StoryboardNode', '手绘白板', '画笔/橡皮擦/矩形/箭头/文字 → 自由绘制 → 连线到图片生成节点'],
    ['PanoramaNode', '720°全景', 'Three.js 渲染 → Seedream 生成全景图 → 拖拽旋转查看'],
    ['MaterialNode', '素材导入', '拖拽/上传图片/视频/音频 → @mention 别名 → 连线为输入源'],
    ['TopazEnhanceNode', '画质增强', '接收图片/视频 → Aliyun VIPAI 超分或 Topaz Labs → 输出增强媒体'],
    ['FaceComplianceNode', '人脸合规', '检测人脸/眼睛/嘴巴 → 自动模糊不合规内容'],
    ['RegionNode', '画布分组', '拖入节点编组 → 命名标签 → 整体移动'],
  ];

  return [
    table(headers, rows),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  ];
}

function createConfigTable() {
  const headers = [
    { text: '标签页', width: 1000 }, { text: '类别', width: 1000 }, { text: '内置提供商', width: 7000 },
  ];
  const rows = [
    ['图片', 'Image', 'Seedream(火山引擎)、GPT-Image-2、Nano Banana、Midjourney'],
    ['增强', 'Enhance', 'Aliyun VIPAI(超分)、Topaz Labs'],
    ['视频', 'Video', 'Seedance 2.0、Kling(快手)、Hailuo(MiniMax)、HappyHorse、Veo/Omni'],
    ['LLM', '大语言模型', '火山引擎(DeepSeek)、Gemini、Claude、OpenAI、DeepSeek Native、MiniMax'],
    ['音频', 'Audio', 'ElevenLabs、MiniMax Audio、Suno、Qwen3-ASR'],
    ['Dreamina CLI', '即梦命令行', 'ByteDance 即梦(文生图/视频/图生视频/多模态)，本地 CLI，无需 API Key'],
  ];

  return [
    table(headers, rows),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  ];
}

function createProactiveTable() {
  const headers = [
    { text: '#', width: 400 }, { text: '场景', width: 1400 }, { text: '触发条件', width: 7200 },
  ];
  const rows = [
    ['1', '时间问候', '会话 > 1分钟，按早/中/晚/周末变化问候语'],
    ['2', '空闲追踪', '上次活动超时，记录空闲开始时间'],
    ['3', '归来问候', '空闲→活跃切换，离开 > 2 分钟'],
    ['4', '分层空闲提示', '15/30/60 分钟空闲逐级升级提示'],
    ['5', '工作强度提醒', '高强度工作(高点击/按键/滚动)超阈值'],
    ['6', '深夜提醒', '23:00-05:00，每约 60 分钟'],
    ['7', '滚动疲劳', '滚动 > 5万px，点击 < 20'],
    ['8', '高频复制粘贴', '复制粘贴 > 30 次'],
    ['9', '连续错误', '连续错误 >= 3 次'],
    ['10', '标签页归来', '标签页隐藏 > 3 分钟后切回'],
    ['11', '跨夜提示', '0-3点跨日历日'],
    ['12', '快速打字', '连续快速打字 30+ 秒'],
    ['13', '整点里程碑', '会话满 3/6/8 小时'],
    ['14', '纯键盘操作', '按键 > 300，点击 < 5'],
    ['15', '频繁切标签', '标签切换 > 20 次'],
  ];

  return [
    table(headers, rows),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  ];
}

function createAgentToolsTable() {
  const headers = [
    { text: '类别', width: 1400 }, { text: '工具数', width: 800 }, { text: '典型操作', width: 6800 },
  ];
  const rows = [
    ['画布操作', '12', '增删节点、连线、运行生成、撤销、重做、排列、工作流模板'],
    ['文件系统', '5', '读/写/编辑文件、glob 搜索、grep 搜索'],
    ['网络', '2', '网页搜索、网页抓取'],
    ['API 配置', '6', '读取/设置/测试 API 配置、列出/切换/添加提供商'],
    ['Dreamina CLI', '9', '登录检测、安装、文生图/视频、图生图/视频、多模态生成'],
    ['项目管理', '3', '项目信息、列表、创建'],
    ['音乐控制', '9', '搜索、播放、暂停、切歌、音量、播放列表、推荐'],
    ['终端/任务', '5', 'Bash 执行、任务创建/更新、子代理、会话管理'],
    ['其他', '6', '获取配置、计划模式、会话信息、用户资料更新'],
  ];

  return [
    table(headers, rows),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  ];
}

function bulletList(items) {
  return items.map(([title, desc]) =>
    new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 60 },
      children: [new TextRun({ text: title + '：', bold: true }), new TextRun(desc)],
    })
  );
}

function cell(text, width) {
  return new TableCell({
    width: { size: width || 2000, type: WidthType.DXA },
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, size: '18' })],
    })],
  });
}

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.SOLID, color: 'e8ecf1' },
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, size: '18', bold: true, color: '1a1a2e' })],
    })],
  });
}

function table(headers, dataRows) {
  const colWidths = headers.map(h => h.width);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => headerCell(h.text, h.width)),
  });

  const rows = dataRows.map(row =>
    new TableRow({
      children: row.map((t, i) => cell(t, colWidths[i] || 2000)),
    })
  );

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...rows],
  });
}

// ── Generate ──
const desktop = path.join(os.homedir(), 'Desktop');
const outPath = path.join(desktop, 'MagineCanvas项目介绍.docx');

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('Done ->', outPath);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
