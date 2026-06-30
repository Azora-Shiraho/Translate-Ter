# Translate-Ter UI & UX 设计准则说明文档

本文档定义了 **Translate-Ter** 桌面端前台界面的核心 UI 与 UX 交互视觉规范。整个系统采用现代**黑曜石磨砂玻璃态（Obsidian Glassmorphism）**与**专业生产力 IDE 双栏布局**，致力于为极客和专业音视频创作者提供最高水准的视听翻译体验。

---

## 🎨 1. 色彩与多主题系统 (Color & Theme System)

为了实现沉浸式的低反差美学以及舒适的双语校对体验，系统基于 CSS 变量定义了多套色彩体系，支持**深色模式**、**浅色模式**以及**跟随系统**。

### 1.1 全局共享核心变量 (Global Shared Variables)
- **字体族 (`--tt-font-family`)**：使用 `Inter` 结合系统无衬线字体，展现现代科技产品的精干感。
- **圆角体系 (Radius)**：
  - 输入框与小标签 (`--tt-radius-field`)：`8px`
  - 卡片容器 (`--tt-radius-card`)：`16px`
  - 大型主面板 (`--tt-radius-panel`)：`24px`
- **主题强调色 (`--tt-accent`)**：`#6366f1`（主题靛蓝，带微光阴影用于激活指示线）。
- **主题深强调色 (`--tt-accent-strong`)**：`#4f46e5`。
- **业务状态色 (Status tones)**：
  - 成功/运行完成 (`--tt-status-success`)：`#10b981` (翡翠绿)
  - 警告/冲突 (`--tt-status-warning`)：`#f59e0b` (琥珀橙)
  - 错误/异常终止 (`--tt-status-error`)：`#ef4444` (警示红)

### 1.2 深色模式变量 (`[data-theme='dark']`)
在深色模式下，界面采用夜空黑与曜石煤黑色阶，杜绝单调的纯黑色调，保持磨砂玻璃态的透光感。
- **全局底色 (`--tt-surface-app`)**：`#050506`（曜石深灰）
- **左侧边导航底色 (`--tt-surface-sidebar`)**：`rgba(10, 10, 12, 0.65)`（带微弱毛玻璃模糊效果）
- **核心容器底色 (`--tt-surface-panel`)**：`#0d0e12`（曜石煤黑）
- **悬浮与次级容器 (`--tt-surface-panel-soft`)**：`rgba(20, 21, 26, 0.7)`
- **极细边框线 (`--tt-border-soft`)**：`rgba(255, 255, 255, 0.05)`（极高的暗色透光率，用于边缘高光）
- **强化轮廓线 (`--tt-border-strong`)**：`rgba(255, 255, 255, 0.12)`
- **文字 - 主体高亮 (`--tt-text-strong`)**：`#fafafa`（纯白微灰，避免纯白刺眼）
- **文字 - 常规阅读 (`--tt-text-body`)**：`#e4e4e7`
- **文字 - 辅助弱化 (`--tt-text-muted`)**：`#8e9099`

### 1.3 浅色模式变量 (`[data-theme='light']`)
在浅色模式下，界面转换成高级 Slate 纸张色泽，保持清晰的层级感与极简的设计语境。
- **全局底色 (`--tt-surface-app`)**：`#f8fafc`（优雅极浅蓝灰）
- **左侧边导航底色 (`--tt-surface-sidebar`)**：`rgba(248, 250, 252, 0.7)`（毛玻璃态）
- **核心容器底色 (`--tt-surface-panel`)**：`#ffffff`（珍珠白）
- **悬浮与次级容器 (`--tt-surface-panel-soft`)**：`rgba(255, 255, 255, 0.8)`
- **极细边框线 (`--tt-border-soft`)**：`rgba(15, 23, 42, 0.08)`（柔和的暗色微线）
- **强化轮廓线 (`--tt-border-strong`)**：`rgba(15, 23, 42, 0.15)`
- **文字 - 主体高亮 (`--tt-text-strong`)**：`#0f172a`（深蓝黑）
- **文字 - 常规阅读 (`--tt-text-body`)**：`#334155`
- **文字 - 辅助弱化 (`--tt-text-muted`)**：`#64748b`
- **阴影强度 (`--tt-shadow-soft`)**：`0 10px 25px -5px rgba(0, 0, 0, 0.05)`

### 1.4 跟随系统机制 (System Synchronization)
当用户选择跟随系统设置时，前台将通过 Electron 预载脚本检测操作系统的主题偏好，并动态向 `:root` 节点追加或移除 `data-theme='dark'` 属性。在此期间，所有的过渡过渡效果必须加上 `transition: background-color 0.3s, border-color 0.3s`，防止主题切换时造成视觉闪烁。

---

## 🎛️ 2. 全类型卡片样式规范 (Card Styling Directory)

卡片是 Translate-Ter 承载内容与功能块的最小粒度。各类卡片必须严格遵循以下样式标准：

### 2.1 主题与标签卡片 (Tab Selection Cards)
用于“深色/浅色/跟随系统”的主题切换卡片，或是设置选项卡中的切换。
- **布局形式**：横向并排或紧凑网格，带有图标与文字纵向/横向居中对齐。
- **视觉反馈**：
  - **默认态**：`.themeCard` 具有浅边框与极弱的背景。
  - **悬停态**：`border-color: var(--tt-border-strong)` 并且微微向上位移 1px。
  - **选中态**：`.themeCard.selected` 强制将边框设为主题色 `border-color: var(--tt-accent)`，同时在其右上角或核心区域浮现一个淡紫色微光。
  - **图标适配**：在跟随系统卡片中，内部手绘图（如一半白一半黑的抽象圆弧）必须完美对齐，圆弧在选中时应展示高饱和发光。

### 2.2 服务与识别方式卡片 (Service & Method Cards)
用于“翻译服务”选择卡片与“识别方式”选择卡片。
- **排版结构**：左侧展示服务提供商/识别模型的立体品牌图标，右侧显示名称、版本与延迟状态，下方附带参数调整。
- **按钮格格不入修复标准**：
  - 卡片内部的启动、重试或配置按钮，**严禁使用亮色实色背景**。
  - 应使用轮廓态或带极低透明度背景的极简卡片按钮（`.settingsActionButton`），在 Hover 时才浮现强调色和位移，保证视觉的内敛和融入感。

### 2.3 工作区步骤向导卡片 (Wizard Stepper Cards)
工作区左侧的 1、2、3、4 管道步骤卡片，承载高频管线操作：
- **状态样式分类**：
  - **未激活 (`.wizardStep.disabled`)**：`opacity: 0.35`；鼠标禁用指针，不可交互。
  - **进行中/活动态 (`.wizardStep.active`)**：`border-color: var(--tt-accent)`；带有靛蓝微光 `box-shadow: 0 0 16px -5px rgba(99, 102, 241, 0.2)`，引导用户在此执行核心动作。
  - **已完成 (`.wizardStep.completed`)**：`border-color: rgba(16, 185, 129, 0.25)`，卡片头部右侧淡入一个绿色的 `CheckCircle2` 确认图标。
- **折叠态 (`.wizardStep-collapsed`)**：
  - 高度紧缩为 `38px` 左右的单行圆角小条，仅渲染步骤索引图标（如播放/翻译/视频）和当前值（如文件名或服务商名字），靠右侧淡入微小文本提示。
  - 点击折叠栏的头部时，自动执行展开/折叠的过渡动效。

### 2.4 媒体文件详情预览卡 (Media Information Card)
在文件导入后渲染的详情显示卡，包含文件元数据。
- **样式细节**：
  - 背景色比外层面板更深（使用原生的 `var(--tt-surface-app)`），产生雕刻内陷感。
  - 左侧配有紫底圆角的 `FileVideo` 媒体图标，右侧展现单行截断（`text-overflow: ellipsis`）的文件名。
  - 底部左下角渲染“重新选择”轻量轮廓按钮。

### 2.5 仪表盘环境指标卡 (Dashboard Metric Cards)
用于展示进度、已翻行数、冲突警告、服务状态的卡片组。
- **彩色左发光柱**：卡片左侧包含一个 `3px` 宽的垂直高饱和发光柱。
  - Progress (进度) -> 蓝色 (`#6366f1`)
  - Translated Rows (已翻译行数) -> 绿色 (`#10b981`)
  - Warnings (冲突警告) -> 橙色 (`#f59e0b`)
  - Translation Engine (翻译服务状态) -> 紫色 (`#a855f7`)
- **动效**：当后台任务在活动时，指标卡图标将顺时针 3D 旋转；若警告数大于零，警告指标卡变为可点击态（Hover 时轻微浮动，点击弹出警告详细面板）。

### 2.6 工作台字幕行段卡片 (Subtitle Segment Cards)
在字幕主网格列表中，承载单句双语字幕的快速切换卡片。
- **样式规范**：
  - **普通态**：扁平圆角背景，上方为单行等宽时间轴标签（`.segmentTime`），下方为原文及译文预览。
  - **激活态 (`.segmentCard.active`)**：卡片整体边框亮起并展现靛蓝强调线，同时带有平滑的向右位移（`padding-left` 微增或 `transform: translateX`）来标志当前选中行。
  - **时间轴微标**：使用紫色 monospace 字体并内置 Clock 图标，显示具体微秒。

---

## 🗂️ 3. 布局与核心流式体验 (Layout Architectures)

### 3.1 工作区双栏 IDE 级布局
- **左侧控制栏 (340px 固宽)**：垂直排布。顶部是控制中心页眉，中间是 1 -> 2 -> 3 -> 4 折叠向导通道，底端是状态卡片组。
- **右侧主编辑区**：
  - 无字幕时，展现带有粒子圆环微光与 `3s` 周期悬浮动画的**科技感空状态引导面板**。
  - 有字幕时，主舞台 `SubtitleWorkbench` **纵向 100% 满高撑满**，左侧为字幕滚动区，右侧为原文/译文双语文本框输入面板。
  - 警告面板 `WarningPanel` 以平滑的底部折叠抽屉展示，最大展开高度不超过 `35%`。

### 3.2 批量处理页面 (Batch Processing View)
- 采用 **左 45% 控制面板与控制台 + 右 55% 任务列表** 的非对称宽屏布局。
- **左侧面板**：包含多任务参数选择、语言包选择，以及实时的命令流控制台日志（Console Console），日志文字采用单色 monospace，支持自动跟随滚动。
- **右侧面板**：渲染多卡片式的任务清单。正在处理的任务行将自动展示彩虹进度条与运行微章。

---

## 🚀 4. 动效与微交互规范 (Animations & Micro-interactions)

动态交互能赋予静态界面“生命感”，在数据处理与等待阶段，必须运用以下微动效：

### 4.1 彩虹流体进度条 (Rainbow Fluid Progress)
```css
.rainbow-progress-bar-fill {
  background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #6366f1);
  background-size: 200% auto;
  animation: wave-flow-anim 2s linear infinite;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes wave-flow-anim {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
```

### 4.2 雷达双层呼吸灯 (Radar Wave Pulse)
```css
.radar-badge {
  position: relative;
  display: inline-flex;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--tt-accent);
}
.radar-badge::after {
  content: '';
  position: absolute;
  top: -3px; left: -3px; right: -3px; bottom: -3px;
  border: 2px solid var(--tt-accent);
  border-radius: 50%;
  opacity: 0;
  animation: radar-pulse-anim 1.6s infinite cubic-bezier(0.25, 0, 0, 1);
}
@keyframes radar-pulse-anim {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(1.8); opacity: 0; }
}
```

### 4.3 仪表盘 3D 自转齿轮 (3D Spinning Gear)
```css
.running-spin {
  animation: spin-clockwise-anim 2s infinite linear;
}
@keyframes spin-clockwise-anim {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

---

## 🛡️ 5. 界面安全排版防剪裁规范 (CSS Spacing Safety)

由于系统引入了大量发光投影（`box-shadow`）以及大圆角卡片，如果在局部配置 `overflow: auto` 或 `overflow: hidden` 时不进行特殊防护，会导致边角和投影被硬性剪断，造成粗糙的视觉缺陷。

### 5.1 滚动容器防剪裁补白 (Scroll Area Inset Padding)
- **核心规约**：任何具有独立纵向滚动的卡片网格列表容器（如字幕卡片列表 `.workbenchListArea`），都必须为其子元素留出至少 `4px` 的全方位内部补白。
- **示例**：
  ```css
  .workbenchListArea {
    padding: 4px 8px 16px 4px; /* 顶部/左侧预留 4px，右侧预留 8px 用于避免滚动条重叠，底端 16px */
    overflow-y: auto;
  }
  ```
  这样当 `.segmentCard` 在激活态亮起 `box-shadow`，或者 Hover 放大时，其周边的发光与圆角边界仍完全处于滚动视窗内部，保证流畅的磨砂边缘渲染。

### 5.2 绝对浮动定位防挡 (High Z-Index & Overlay Boundary)
- 翻译服务卡片或浮动菜单（如自定义 Select）的面板，在渲染时极易被父容器的 `overflow: hidden` 夹缝剪断。
- 所有的浮动选择面板应通过虚拟 Dom 挂载到根视口，或者在 CSS 中确保其父层级没有任何截断属性，同时设置 `z-index: 100` 以防被底层的字幕行或按钮组遮挡。
