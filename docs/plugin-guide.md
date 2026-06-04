# 插件开发指南

本文档介绍如何为"鬼畜活字乱刷"创建自定义插件。

---

## 插件格式

插件以 **`.zip` 压缩包**分发。一个 `.zip` 包解压后是一个文件夹，包含以下内容：

```
my-plugin.zip
└── my-plugin/
    ├── manifest.json      # 插件描述（必选）
    ├── main.js           # 后端主入口（必选）
    ├── renderer.js       # 前端脚本（可选）
    ├── assets/           # 素材目录（可选）
    │   ├── icon.svg
    │   ├── sample.png
    │   └── ...
    └── ...
```

### 安装方式

1. 在应用内打开 **插件管理器** → **导入插件(.zip)**
2. 选择 `.zip` 文件，系统自动解压到插件目录
3. 如果插件与已安装的插件存在冲突，会提示并阻止安装

### 插件目录自动恢复

插件和UI包均存放在 **软件根目录**：
- 开发模式：项目目录下的 `plugins/` 和 `ui-packs/`
- 打包模式：`userData` 目录下的 `plugins/` 和 `ui-packs/`

> **如果目录被用户意外删除，应用启动时会自动重建空目录。**
> 已安装的插件/UI包不会自动恢复（需要重新导入），但目录框架会保证存在。

---

## UI 包（主题/皮肤）

UI包是用于改变应用外观的资源包，与插件使用相同的 zip 导入机制。

### UI 包结构

```
my-ui-pack.zip
└── my-ui-pack/
    ├── manifest.json       # 包描述
    └── assets/             # 样式/素材
        ├── style.css
        └── ...
```

### manifest.json

```json
{
  "name": "暗黑红主题",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "暗黑红色调主题"
}
```

### 安装 UI 包

在主界面点击 **UI包管理** → **导入 .zip**，选择包文件即可。

> UI包导入后暂未自动应用，需要配合插件或手动加载，后续版本会加入一键切换功能。

---

## manifest.json 格式

```json
{
  "name": "示例插件",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "插件的简短描述",
  "main": "main.js",
  "renderer": "renderer.js",
  "hooks": ["onProjectLoad", "onExportStart"],
  "icon": "icon.svg",
  "incompatible": ["other-plugin-name"],
  "priority": 100
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件唯一标识名，**全局唯一**，用作目录名 |
| `version` | string | ✅ | 语义化版本号，如 `1.0.0`、`2.3.1-beta` |
| `author` | string | ✅ | 作者署名 |
| `description` | string | ✅ | 插件功能简短描述 |
| `main` | string | ✅ | 后端主入口，相对路径 |
| `renderer` | string | - | 前端脚本文件，相对路径 |
| `hooks` | string[] | - | 插件订阅的事件列表 |
| `icon` | string | - | 图标文件路径（SVG/PNG），相对路径 |
| `incompatible` | string[] | - | **不兼容的插件名称列表**，与这些插件同时安装时会冲突 |
| `priority` | number | - | **优先级**，数值越大优先级越高。默认 `0`。详见下方"优先级系统" |

---

## 优先级系统

当多个插件（或插件与核心）之间存在冲突或竞争时，按以下规则裁决：

### 规则

1. **插件 > 核心** — 如果插件的某个行为与核心功能冲突，插件的行为优先
2. **数值越高越优先** — 同一事件上注册了多个插件 hook 时，按 `priority` 从高到低依次执行
3. **优先级相同 → 加载顺序** — 若 `priority` 相同，以插件被加载的顺序为先后

### 优先级参考

| 场景 | 建议值 |
|------|--------|
| 普通增强型插件 | `0`（默认） |
| 需要覆盖部分核心行为的插件 | `50` |
| 完全替代核心某个功能的插件 | `100` |
| 系统级/必须最后执行的插件 | `200` |

> **注意**：不恰当地设置高优先级可能导致其他插件失效。建议从默认值开始。

---

## 后端插件 (main.js)

后端插件运行在 Electron 主进程，可以访问 Node.js API 和文件系统。

### 模块导出

`main.js` 必须导出一个对象，结构如下：

```javascript
module.exports = {
  // 初始化函数（插件加载时调用）
  async initialize(api) {
    console.log('插件初始化');
    // api 对象提供了与宿主的交互接口
  },

  // 清理函数（插件卸载时调用）
  async cleanup() {
    console.log('插件清理');
  },

  // 事件处理器（可选）
  hooks: {
    async onProjectLoad(projectId, data) {
      // 当项目被加载时触发
      return data; // 可以修改后返回
    },
    async onExportStart(clips, outputPath) {
      // 当开始导出视频时触发
      // 可以修改 clips 数组或输出路径
      return { clips, outputPath };
    }
  },

  // 自定义 IPC 命令（可选）
  ipcHandlers: {
    'my-custom-command': async (event, args) => {
      return { result: 'ok' };
    }
  }
};
```

### API 对象

`api` 对象在 `initialize` 中传入，提供以下方法：

| 方法 | 说明 |
|------|------|
| `api.registerIpcHandler(channel, handler)` | 注册自定义 IPC 处理器 |
| `api.invokeRenderer(channel, args)` | 调用渲染进程函数 |
| `api.getAppPath()` | 返回应用数据目录 |
| `api.log(level, message)` | 记录日志 |
| `api.getPluginInfo(name)` | 获取指定插件的 manifest 信息 |
| `api.getInstalledPlugins()` | 获取所有已安装插件列表 |

### 可用的事件钩子 (hooks)

插件可以通过 `hooks` 对象订阅以下事件：

| 钩子名称 | 触发时机 | 参数 | 优先级执行 |
|----------|---------|------|-----------|
| `onProjectLoad` | 项目加载时 | `projectId`, `projectData` | ✅ |
| `onProjectSave` | 项目保存前 | `projectId`, `projectData` | ✅ |
| `onVideoImport` | 视频导入后 | `projectId`, `filePath`, `segments` | ✅ |
| `onExportStart` | 导出开始前 | `clips`, `outputPath` | ✅ |
| `onExportEnd` | 导出结束后 | `outputPath`, `success` | ✅ |
| `onAppStart` | 应用启动时 | - | ✅ |
| `onAppQuit` | 应用退出前 | - | ✅ |

**优先级执行**：当多个插件注册了同一个钩子时，系统按照 `priority` 从高到低的顺序依次调用。高优先级插件的返回值会影响低优先级插件接收到的参数。

---

## 前端插件 (renderer.js)

前端插件运行在渲染进程，可以操作 DOM、添加 UI 元素、注册快捷键等。

### 模块导出

`renderer.js` 必须导出一个对象：

```javascript
export default {
  // 前端初始化
  async initialize(api) {
    // api 提供与主进程通信的接口
    const button = document.createElement('button');
    button.textContent = '插件按钮';
    button.addEventListener('click', () => {
      api.invoke('my-custom-command', { foo: 'bar' });
    });
    document.getElementById('toolbar').appendChild(button);
  },

  // 清理函数
  async cleanup() {
    // 移除添加的元素或事件监听器
  }
};
```

### 前端 API

前端 `api` 对象提供：

| 方法 | 说明 |
|------|------|
| `api.invoke(channel, args)` | 调用主进程 IPC 命令 |
| `api.on(channel, callback)` | 监听主进程事件 |
| `api.off(channel, callback)` | 取消监听 |
| `api.dom` | 工具函数：`api.dom.createElement`, `api.dom.addStyle` 等 |

---

## 插件示例

### 1. 简单统计插件

**manifest.json**
```json
{
  "name": "project-stats",
  "version": "1.0.0",
  "author": "示例作者",
  "description": "显示项目字数统计",
  "main": "main.js",
  "renderer": "renderer.js",
  "priority": 0
}
```

**main.js**
```javascript
module.exports = {
  async initialize(api) {
    api.registerIpcHandler('get-stats', async (event, projectId) => {
      const data = await api.getProjectData(projectId);
      return {
        charCount: Object.keys(data.charLibrary).length,
        clipCount: data.allCharClips.length
      };
    });
  }
};
```

**renderer.js**
```javascript
export default {
  async initialize(api) {
    const stats = await api.invoke('get-stats', 'current');
    const div = document.createElement('div');
    div.className = 'plugin-stats';
    div.innerHTML = `字数: ${stats.charCount}, 片段: ${stats.clipCount}`;
    document.querySelector('.status-bar').appendChild(div);
  }
};
```

### 2. 导出前处理插件（使用 priority + incompatible）

```json
{
  "name": "watermark-plugin",
  "version": "2.0.0",
  "author": "示例作者",
  "description": "导出视频时添加水印",
  "main": "main.js",
  "hooks": ["onExportStart"],
  "priority": 50,
  "incompatible": ["old-watermark-plugin"]
}
```

**main.js**
```javascript
module.exports = {
  hooks: {
    async onExportStart(clips, outputPath) {
      const processedClips = clips.map(clip => ({
        ...clip,
        watermark: '鬼畜活字乱刷'
      }));
      return { clips: processedClips, outputPath };
    }
  }
};
```

### 3. 素材插件（带 assets 目录）

```
my-assets-plugin.zip
└── my-assets-plugin/
    ├── manifest.json
    ├── main.js
    └── assets/
        ├── bg-pattern.png
        └── overlay.mp4
```

`manifest.json` 中可以通过 `icon` 指向 `assets/icon.svg`，后端代码通过 `__dirname + '/assets/'` 访问素材文件。

---

## 插件安装与分发

### 安装方式

1. **.zip 导入（推荐）**：在插件管理器中点击"导入插件(.zip)"，选择 `.zip` 文件
2. **远程脚本更新（未来）**：通过远程更新引导自动下载安装

### 更新插件

1. 删除旧版本插件（插件管理中点击✕）
2. 导入新版本的 `.zip` 文件

---

## 不兼容检测

当导入插件时，系统会自动检查：

1. **名称冲突**：已存在同名插件
2. **互不兼容声明**：新插件的 `incompatible` 列表中包含已安装的插件 → 阻止安装并提示
3. **反向冲突**：已安装的某个插件在其 `incompatible` 列表中声明了不兼容新插件 → 阻止安装并提示

---

## 调试与测试

### 开发模式

1. 将插件源码放在 `%APPDATA%/guichu-tool/plugins-dev/` 目录下（自动加载）
2. 或者打包为 `.zip` 通过导入安装

### 日志查看

插件日志输出到：
- 主进程：查看应用控制台（终端）日志
- 渲染进程：使用浏览器开发者工具（Ctrl+Shift+I）

### 常见问题

**Q: 插件没有加载？**
A: 检查 manifest.json 格式是否正确，main.js 是否存在语法错误。

**Q: 提示不兼容？**
A: 查看冲突的插件名称，移除其中一个。

**Q: 插件崩溃了怎么办？**
A: 应用会捕获插件异常并显示错误信息。检查主进程日志。

**Q: 如何更新插件？**
A: 在插件管理中删除旧版本，然后导入新版本的 `.zip` 文件。

---

## API 参考

### 主进程 API（供插件后端使用）

| 方法 | 说明 |
|------|------|
| `projectList()` | 获取所有项目列表 |
| `projectGet(id)` | 获取项目数据 |
| `projectSave(id, data)` | 保存项目数据 |
| `videoCopy(options)` | 复制视频到项目目录 |
| `transcribeAudio(path)` | 语音识别（Whisper） |
| `exportVideo(options)` | 导出视频 |

### 渲染进程 API（供插件前端使用）

| 方法 | 说明 |
|------|------|
| `pluginList()` | 获取已安装插件列表 |
| `pluginImportZip()` | 导入 `.zip` 插件包 |
| `pluginDelete(name)` | 删除插件 |
| `pluginLoadRenderer(name)` | 动态加载插件前端脚本 |

---

## 安全注意事项

1. 插件拥有与主进程相同的权限，请仅从可信来源安装插件。
2. 插件可以访问文件系统、网络等，请确保了解插件功能。
3. 应用会对插件进行基本沙箱隔离，但无法完全防止恶意行为。
4. 导入 `.zip` 来源不明时，请先检查 zip 内容。

---

如有问题，请通过应用内"反馈"功能联系开发者。
