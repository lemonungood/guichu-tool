const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const settings = require('./js/settings');
const projects = require('./js/projects');
const bootloader = require('./js/bootloader');
const { checkForUpdate } = require('./js/update-checker');
const { createTrayIcon, createAppIcon } = require('./js/icon');

let mainWindow;
let tray = null;

// --- Paths ---
const isDev = !app.isPackaged;
const resourcesPath = isDev
  ? path.join(__dirname, 'resources')
  : path.join(process.resourcesPath);
const ffmpegDir = path.join(resourcesPath, 'ffmpeg');
const ffmpegPath = path.join(ffmpegDir, 'ffmpeg.exe');
const ffprobePath = path.join(ffmpegDir, 'ffprobe.exe');
const whisperDir = path.join(resourcesPath, 'whisper');
const whisperCliPath = path.join(whisperDir, 'whisper-cli.exe');
const whisperModelPath = path.join(resourcesPath, 'models', 'ggml-medium.bin');
const segmentsDir = path.join(resourcesPath, 'segments');
const outputDir = path.join(resourcesPath, 'output');
const logsDir = path.join(app.getPath('userData'), 'logs');
const appRoot = isDev ? path.resolve(__dirname, '..', '..') : app.getPath('userData');
const pluginsDir = path.join(appRoot, 'plugins');
const uiPacksDir = path.join(appRoot, 'ui-packs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// === Single Instance Lock ===
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// === Window ===
function createWindow() {
  const prefs = settings.getAll();
  const winSize = prefs.window || { width: 1400, height: 900 };

  mainWindow = new BrowserWindow({
    width: winSize.width,
    height: winSize.height,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    title: '鬼畜活字乱刷',
    backgroundColor: '#1a1a2e',
    icon: path.join(__dirname, 'icon.png'),
    frame: false,
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => { if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('win-maximize-change', true); });
  mainWindow.on('unmaximize', () => { if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('win-maximize-change', false); });

  mainWindow.on('close', (e) => {
    app.isQuitting = true;
    mainWindow.destroy();
  });
}

// === Tray ===
function createTray() {
  const prefs = settings.getAll();
  tray = new Tray(createTrayIcon(prefs.theme?.accentColor || '#e94560'));
  tray.setToolTip('鬼畜活字乱刷');

  function updateTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? '隐藏窗口' : '显示窗口',
        click: () => {
          if (mainWindow?.isVisible()) { mainWindow.hide(); }
          else { mainWindow?.show(); mainWindow?.focus(); }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  }

  tray.on('click', () => {
    if (mainWindow?.isVisible()) { mainWindow.hide(); }
    else { mainWindow?.show(); mainWindow?.focus(); }
    updateTrayMenu();
  });

  updateTrayMenu();
  return tray;
}

// === App Lifecycle ===
app.whenReady().then(() => {
  ensureDir(segmentsDir);
  ensureDir(outputDir);

  // 启动引导：拉远程 JS 执行，签名验证失败或网络不通时静默继续
  bootloader.bootstrap({
    appVersion: require('./package.json').version,
    platform: process.platform,
    settings: settings.getAll(),
    appPath: __dirname,
  });

  createWindow();
  createTray();

  // 启动后延迟 3s 自动检查更新（等渲染器就绪）
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      checkForUpdate().then(result => {
        if (result.hasUpdate) {
          try { mainWindow.webContents.send('update-available', result); } catch {}
        } else if (result.error) {
          console.warn('[update] 检查更新失败:', result.error);
        }
      });
    }
  }, 3000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  // 兜底：强制退出（防残留）
  setTimeout(() => app.exit(0), 2000);
});
app.on('before-quit', () => {
  app.isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
});
app.on('will-quit', () => {
  // 强制杀掉所有子进程（包括FFmpeg等）
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
  try { process.kill(-process.pid, 'SIGKILL'); } catch {}
});

// === IPC: Window Controls ===
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() || false);
ipcMain.on('win-is-maximized-send', () => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('win-maximize-change', mainWindow.isMaximized());
});

// === IPC: External Links ===
ipcMain.handle('open-external', async (e, url) => {
  await shell.openExternal(url);
});

// === IPC: App Info ===
ipcMain.handle('get-app-version', () => {
  return require('./package.json').version;
});

// === IPC: Projects ===
ipcMain.handle('project-list', () => projects.listAll());
ipcMain.handle('project-get', (e, id) => projects.get(id));
ipcMain.handle('project-save', (e, id, data) => projects.save(id, data));
ipcMain.handle('project-delete', (e, id) => projects.remove(id));
ipcMain.handle('project-rename', (e, id, name) => {
  const data = projects.get(id);
  if (!data) return false;
  data.name = name;
  return projects.save(id, data);
});
ipcMain.handle('copy-video', async (e, { projectId, sourcePath }) => {
  if (!projectId) return { error: '项目ID无效' };
  if (!sourcePath) return { error: '视频路径无效' };
  if (!fs.existsSync(sourcePath)) return { error: '视频文件不存在: ' + sourcePath };
  const videosDir = projects.getVideosDir(projectId);
  ensureDir(videosDir);
  const ext = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, ext);
  let dest = path.join(videosDir, baseName + ext);
  // 同名文件加时间戳避免冲突
  if (fs.existsSync(dest)) {
    dest = path.join(videosDir, baseName + '_' + Date.now() + ext);
  }
  try {
    await fs.promises.copyFile(sourcePath, dest);
    return { path: dest, name: path.basename(dest) };
  } catch (err) {
    // 跨设备/权限问题时改用流式复制
    try {
      await new Promise((resolve, reject) => {
        const rd = fs.createReadStream(sourcePath);
        const wr = fs.createWriteStream(dest);
        rd.pipe(wr);
        wr.on('finish', resolve);
        wr.on('error', reject);
        rd.on('error', reject);
      });
      return { path: dest, name: path.basename(dest) };
    } catch (err2) {
      console.error('copy-video failed:', sourcePath, '->', dest, err2);
      return { error: '复制视频失败: ' + (err2.message || err2.code || '未知错误') };
    }
  }
});

// === IPC: Settings ===
ipcMain.handle('settings-get-all', () => settings.getAll());
ipcMain.handle('settings-get', (e, key) => settings.get(key));
ipcMain.handle('settings-set', (e, key, value) => {
  settings.set(key, value);
  // Update tray icon if theme changed
  if (key.startsWith('theme') && tray) {
    const prefs = settings.getAll();
    const ic = createTrayIcon(prefs.theme?.accentColor || '#e94560');
    tray.setImage(ic);
  }
  return true;
});

// === IPC: Audio/video ===
ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    filters: [
      { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-output', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出视频',
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    defaultPath: 'output.mp4',
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('get-video-info', async (e, videoPath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const info = JSON.parse(out);
        const vs = info.streams?.find(s => s.codec_type === 'video');
        const as = info.streams?.find(s => s.codec_type === 'audio');
        resolve({
          duration: parseFloat(info.format?.duration || 0),
          width: vs?.width || 0, height: vs?.height || 0,
          hasAudio: !!as, bitrate: info.format?.bit_rate || '0',
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
});

let transcribing = false;

ipcMain.handle('transcribe-audio', async (e, videoPath) => {
  try {
    if (transcribing) return { error: '已有识别任务进行中', words: [] };
    transcribing = true;
    console.log('[识别] 开始语音识别, 视频:', videoPath?.split(/[\\/]/).pop(), '模型:', whisperModelPath);
    if (!fs.existsSync(whisperModelPath)) {
      transcribing = false;
      return { error: '模型文件不存在，请重新运行安装程序', words: [] };
    }
    return new Promise((resolve, reject) => {
      const done = (err, result) => { transcribing = false; if (err) reject(err); else resolve(result); };
      ensureDir(whisperDir);
    const audioCopy = path.join(whisperDir, 'temp_audio.wav');
    const outPrefix = path.join(whisperDir, 'whisper_out');

    // Get video duration for progress estimation
    const probe = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', videoPath]);
    let probeOut = '';
    probe.stdout.on('data', d => probeOut += d.toString());
    probe.on('close', () => {
      let totalMs = 0;
      try { totalMs = Math.round(parseFloat(JSON.parse(probeOut).format.duration) * 1000); } catch {}

      // 1. Extract audio
      const extractProc = spawn(ffmpegPath, ['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioCopy]);
      extractProc.on('close', (code) => {
        if (code !== 0) return done(new Error('提取音频失败'));
        if (!fs.existsSync(audioCopy)) return done(new Error('音频文件未生成'));

        // 2. Run whisper-cli with word-level timestamps + progress
        // -l zh : Chinese language
        // -wt 0.3 : word threshold for timestamps
        // -ojf  : output full JSON (includes per-token offsets)
        // -of   : output file prefix
        // -pp   : print progress to stderr (REQUIRED for progress bar!)
        const wp = spawn(whisperCliPath, [
          '-m', whisperModelPath,
          '-f', audioCopy,
          '-l', 'zh',
          '-wt', '0.3',
          '-ojf',
          '-pp',
          '-of', outPrefix
        ], { cwd: whisperDir });

        let lastPct = 0;
        const onWhisperData = (d) => {
          const chunk = d.toString();
          // whisper-cli prints progress: "  progress = 45%"
          const m = chunk.match(/progress\s*=\s*(\d+)%/);
          if (m) {
            const pct = Math.min(parseInt(m[1]), 99);
            if (pct > lastPct) {
              lastPct = pct;
              const remSec = totalMs > 0 ? Math.max(0, Math.round((1 - pct / 100) * totalMs / 1000)) : '?';
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('transcribe-progress', { percent: pct, text: '识别中 ' + pct + '%  剩余~' + remSec + 's' });
              }
            }
          }
        };
        wp.stdout?.on('data', onWhisperData);
        wp.stderr?.on('data', onWhisperData);

        wp.on('close', (code2) => {
          // Cleanup audio
          try { fs.unlinkSync(audioCopy); } catch {}

          if (code2 !== 0) return done(new Error('语音识别失败，退出码 ' + code2));

          // 3. Parse JSON output
          const jsonPath = outPrefix + '.json';
          if (!fs.existsSync(jsonPath)) return done(new Error('识别输出文件未生成'));
          let raw;
          try { raw = fs.readFileSync(jsonPath, 'utf-8'); } catch (e) { return done(new Error('读取识别结果失败: ' + e.message)); }

          let words = [];
          try {
            const parsed = JSON.parse(raw);
            // whisper-cli -ojf outputs: { "transcription": [ { "offsets": {...}, "text": "...", "tokens": [...] } ] }
            const segments = Array.isArray(parsed) ? parsed : (parsed.transcription || []);
            for (const seg of segments) {
              if (!seg.text?.trim()) continue;

              // Try to extract word-level info from tokens (with -ojf, tokens contain per-character offsets)
              let segWords = [];
              if (seg.tokens && Array.isArray(seg.tokens)) {
                for (const tok of seg.tokens) {
                  const txt = tok.text?.trim();
                  if (!txt) continue;
                  // Skip special tokens (bracketed like [_BEG_], [_TT_100], etc.)
                  if (txt.startsWith('[') && txt.endsWith(']')) continue;
                  const ws = tok.offsets?.from;
                  const we = tok.offsets?.to;
                  if (ws != null && we != null && we > ws && we - ws >= 10) { // min 10ms for a real word
                    segWords.push({ text: txt, startMs: ws, endMs: we });
                  }
                }
              }

              // Fallback: segment-level data
              if (!segWords.length) {
                const chars = [...seg.text.trim()];
                const segStart = (seg.offsets?.from != null) ? seg.offsets.from : 0;
                const segEnd   = (seg.offsets?.to != null) ? seg.offsets.to : 0;
                const segDur   = segEnd - segStart;
                const perChar  = segDur > 0 && chars.length > 0 ? segDur / chars.length : 0;
                chars.forEach((ch, ci) => {
                  const startMs = segStart + Math.round(ci * perChar);
                  const endMs   = segStart + Math.round((ci + 1) * perChar);
                  segWords.push({ text: ch, startMs, endMs });
                });
              }

              words = words.concat(segWords);
            }
          } catch (e) { return done(new Error('解析识别结果失败: ' + e.message)); }

          // Send 100% progress
          try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('transcribe-progress', { percent: 100, text: '识别完成' }); } catch {}
          try { fs.unlinkSync(jsonPath); } catch {}
          console.log('[识别] 完成: words:', words.length, '个, 总时长:', words.length > 0 ? (words[words.length-1].endMs - words[0].startMs)+'ms' : 'N/A');
          done(null, { words });
        });
      });
      extractProc.on('error', (e) => done(e));
    });
    probe.on('error', () => {});
  }).catch(e => {
    console.error('[识别] Promise rejected:', e?.message || e || 'unknown error');
    transcribing = false;
    throw e;
  });
} catch(e) {
  transcribing = false;
  console.error('[识别] 同步错误:', e?.message || e);
  return { error: '识别启动失败: ' + (e?.message || e || '未知错误'), words: [] };
}
});

ipcMain.handle('extract-clip', async (e, { videoPath, startMs, endMs, outputName }) => {
  return new Promise((resolve, reject) => {
    const durMs = (endMs||0) - (startMs||0);
    if (!durMs || durMs <= 0) return reject(new Error('无效片段时长: start='+startMs+' end='+endMs));
    if (!fs.existsSync(videoPath)) return reject(new Error('视频文件不存在: '+videoPath));
    ensureDir(segmentsDir);
    const outPath = path.join(segmentsDir, outputName);
    const proc = spawn(ffmpegPath, ['-y', '-ss', (startMs / 1000).toFixed(3), '-i', videoPath, '-t', (durMs / 1000).toFixed(3), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', '-b:a', '128k', '-avoid_negative_ts', 'make_zero', outPath], { cwd: ffmpegDir });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => { if (code !== 0) return reject(new Error(stderr.slice(-200) || '提取片段失败')); resolve(outPath); });
    proc.on('error', reject);
  });
});

// 导入时批量预提取所有片段，按字符存入对应子目录 projects/segments/<projectId>/<字>/0.mp4
ipcMain.handle('batch-extract-clips', async (e, { videoPath, projectId, clips, batchId, concurrency }) => {
  console.log('[batch-extract] videoPath:', videoPath, 'projectId:', projectId, 'clips count:', clips?.length, 'concurrency:', concurrency);
  if (!videoPath || !fs.existsSync(videoPath)) return { error: '视频文件不存在: ' + videoPath };
  if (!clips || !clips.length) return { error: '无片段' };
  console.log('[batch-extract] first clip:', JSON.stringify(clips[0]));

  // 存到项目目录：userData/projects/segments/<projectId>/
  const projSegDir = path.join(
    app.getPath('userData'), 'projects', 'segments', projectId || batchId || 'default'
  );
  ensureDir(projSegDir);

  // 记录每个字符已生成了多少个片段
  const charCounters = {};
  const ensureCharDir = (ch) => {
    const safeCh = (ch || '_').replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(projSegDir, safeCh);
    ensureDir(dir);
    if (charCounters[safeCh] == null) charCounters[safeCh] = 0;
    const outName = String(charCounters[safeCh]++) + '.mp4';
    return path.join(dir, outName);
  };

  const total = clips.length;
  const results = new Array(total).fill(null);
  let completed = 0;
  const concurrencyLimit = Math.max(1, parseInt(concurrency) || 1);
  let nextIndex = 0;       // 下一个要处理的 clip 下标
  let activeJobs = 0;      // 当前运行中的 FFmpeg 数量

  const sendP = () => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('batch-extract-progress', { current: completed, total: total }); } catch {} };

  // 启动单个切割任务，返回 Promise
  const processOne = (i) => new Promise((resolve) => {
    const c = clips[i];
    if (!c || c.startMs == null || c.endMs == null) { resolve(null); return; }
    const durMs = (c.endMs||0) - (c.startMs||0);
    if (durMs <= 0) { console.error('batch-extract clip', i, 'invalid duration:', c.startMs, c.endMs); resolve(null); return; }

    const outPath = ensureCharDir(c.char);
    const proc = spawn(ffmpegPath, [
      '-y', '-ss', (c.startMs / 1000).toFixed(3),
      '-i', videoPath,
      '-t', (durMs / 1000).toFixed(3),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-avoid_negative_ts', 'make_zero',
      outPath
    ], { cwd: ffmpegDir });

    let errOut = '';
    proc.stderr.on('data', d => { errOut += d.toString().slice(0, 500); });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('batch-extract clip', i, 'failed:', errOut.slice(-200));
        results[i] = null;
      } else {
        results[i] = outPath;
      }
      completed++;
      sendP();
      resolve();
    });
    proc.on('error', (err) => { console.error('batch-extract spawn error:', err); completed++; sendP(); resolve(); });
  });

  // 调度器：保持 activeJobs 不超过 concurrencyLimit
  const scheduler = async () => {
    while (nextIndex < total) {
      if (activeJobs >= concurrencyLimit) {
        // 等一个空闲 slot
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      const idx = nextIndex++;
      activeJobs++;
      processOne(idx).finally(() => { activeJobs--; });
    }
    // 所有任务已提交，等待全部完成
    while (activeJobs > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  };

  await scheduler();

  const hitCount = results.filter(Boolean).length;
  console.log('[batch-extract] done:', hitCount + '/' + total, 'successful, concurrency:', concurrencyLimit);
  return { extracted: results };
});

ipcMain.handle('export-video', async (e, { clips, outputPath }) => {
  console.log('[export-video] clips count:', clips?.length, 'outputPath:', outputPath);
  return new Promise((resolve, reject) => {
    // 验证所有片段文件存在
    const missing = clips.filter(c => !fs.existsSync(c));
    if (missing.length) return reject(new Error('片段文件不存在: ' + missing[0]));
    const normalizedOutput = path.normalize(outputPath);
    ensureDir(path.dirname(normalizedOutput));
    ensureDir(outputDir);
    const concatFile = path.normalize(path.join(outputDir, 'concat_list.txt'));
    const normalizedClips = clips.map(c => path.normalize(c).replace(/\\/g, '/'));
    const lines = normalizedClips.map(c => "file '" + c + "'");
    fs.writeFileSync(concatFile, lines.join('\n'), 'utf-8');
    const proc = spawn(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', normalizedOutput], { cwd: ffmpegDir });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => { try { fs.unlinkSync(concatFile); } catch {} if (code !== 0) return reject(new Error(stderr.slice(-200) || '导出失败')); resolve(normalizedOutput); });
    proc.on('error', reject);
  });
});

ipcMain.handle('delete-video-file', async (e, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) { console.error('delete-video-file failed:', filePath, err); return false; }
});

ipcMain.handle('clear-segments', async (e, { projectId } = {}) => {
  function rmRecursive(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) { rmRecursive(fp); try { fs.rmdirSync(fp); } catch {} }
      else if (f !== '.gitkeep') { try { fs.unlinkSync(fp); } catch {} }
    }
  }
  try {
    // 清理旧的 resources/segments（兼容旧版）
    rmRecursive(segmentsDir);
    // 清理项目目录下的 segments
    if (projectId) {
      const projSegDir = path.join(app.getPath('userData'), 'projects', 'segments', projectId);
      rmRecursive(projSegDir);
      try { fs.rmdirSync(projSegDir); } catch {}
    }
    return true;
  } catch { return false; }
});

// --- Log System ---
function writeLog(level, tag, msg) {
  try {
    ensureDir(logsDir);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const logFile = path.join(logsDir, dateStr + '.log');
    const timeStr = date.toTimeString().slice(0, 8);
    const line = `[${timeStr}][${level}][${tag}] ${msg}\n`;
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch {}
}
// 重写 console 输出到文件（防递归）
let _logging = 0;
['log','warn','error'].forEach(lvl => {
  const orig = console[lvl];
  console[lvl] = function(...args) {
    orig.apply(console, args);
    if (_logging > 0) return;
    _logging++;
    try {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      const tag = lvl === 'error' ? 'ERR' : (lvl === 'warn' ? 'WRN' : 'INF');
      writeLog(lvl.toUpperCase(), tag, msg);
    } finally { _logging--; }
  };
});

ipcMain.handle('file-exists', async (e, p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

// 渲染器日志写入 + 打开日志目录
ipcMain.handle('log-write', async (e, { level, args }) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeLog(level, 'REN', msg);
});
ipcMain.handle('check-for-update', async () => {
  return await checkForUpdate();
});
ipcMain.handle('log-open-dir', async () => {
  try { shell.openPath(logsDir); } catch {}
});

// Build a preview video from timeline clips (use pre-extracted segPaths if available)
ipcMain.handle('build-preview', async (e, { clips }) => {
  if (!clips || !clips.length) return Promise.reject(new Error('时间轴无片段'));
  console.log('[build-preview] clips count:', clips.length, 'first clip:', JSON.stringify({videoPath:clips[0]?.videoPath, segPath:clips[0]?.segPath, startMs:clips[0]?.startMs, endMs:clips[0]?.endMs}));
  return new Promise((resolve, reject) => {
    ensureDir(segmentsDir);
    const ts = Date.now();
    const previewPath = path.normalize(path.join(segmentsDir, 'preview_' + ts + '.mp4'));
    ensureDir(path.dirname(previewPath));

    // 如果所有片段都已预提取，直接用 concat
    const allPreExtracted = clips.every(c => c.segPath && fs.existsSync(c.segPath));
    if (allPreExtracted) {
      const concatFile = path.normalize(path.join(segmentsDir, 'preview_concat_' + ts + '.txt'));
      const lines = clips.map(c => "file '" + c.segPath.replace(/\\/g, '/') + "'");
      fs.writeFileSync(concatFile, lines.join('\n'), 'utf-8');
      const proc = spawn(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-c', 'copy',
        previewPath
      ], { cwd: ffmpegDir });
      let errOut = '';
      proc.stderr.on('data', d => { errOut += d.toString().slice(0, 500); });
      proc.on('close', (code) => {
        try { fs.unlinkSync(concatFile); } catch {}
        if (code !== 0) return reject(new Error('拼接预览失败: ' + (errOut.slice(-120) || 'code=' + code)));
        resolve(previewPath);
      });
      proc.on('error', (e) => reject(new Error('启动FFmpeg失败: ' + e.message)));
      return;
    }

    // 回退：逐个提取再合并
    const clipFiles = [];
    function processClip(idx) {
      if (idx >= clips.length) {
        if (clipFiles.length === 0) return reject(new Error('没有可拼接的片段'));
        const concatFile = path.normalize(path.join(segmentsDir, 'preview_concat_' + ts + '.txt'));
        const lines = clipFiles.map(f => "file '" + f.replace(/\\/g, '/') + "'");
        fs.writeFileSync(concatFile, lines.join('\n'), 'utf-8');
        const proc = spawn(ffmpegPath, [
          '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          '-c:a', 'aac', '-b:a', '128k',
          previewPath
        ], { cwd: ffmpegDir });
        let errOut = '';
        proc.stderr.on('data', d => { errOut += d.toString().slice(0, 500); });
        proc.on('close', (code) => {
          try { fs.unlinkSync(concatFile); } catch {}
          if (code !== 0) return reject(new Error('拼接预览失败: ' + (errOut.slice(-120) || 'code=' + code)));
          resolve(previewPath);
        });
        proc.on('error', (e) => reject(new Error('启动FFmpeg失败: ' + e.message)));
        return;
      }
      const clip = clips[idx];
      if (!clip || !clip.videoPath) return processClip(idx + 1);
      if (!fs.existsSync(clip.videoPath)) return reject(new Error('视频文件不存在: ' + clip.videoPath));
      const durMs = (clip.endMs||0) - (clip.startMs||0);
      if (durMs <= 0) { console.error('build-preview: invalid duration for clip', idx, clip); return processClip(idx + 1); }
      const outName = 'preview_seg_' + ts + '_' + String(idx).padStart(4, '0') + '.mp4';
      const outPath = path.normalize(path.join(segmentsDir, outName));
      const exe = spawn(ffmpegPath, [
        '-y', '-i', clip.videoPath,
        '-ss', (clip.startMs / 1000).toFixed(3),
        '-t', (durMs / 1000).toFixed(3),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
        '-c:a', 'aac', '-b:a', '128k',
        outPath,
      ], { cwd: ffmpegDir });
      let errOut = '';
      exe.stderr.on('data', d => { errOut += d.toString().slice(0, 500); });
      exe.on('close', (code) => {
        if (code !== 0) return reject(new Error('提取片段失败: ' + (errOut.slice(-120) || 'code=' + code)));
        clipFiles.push(outPath);
        processClip(idx + 1);
      });
      exe.on('error', (e) => reject(new Error('启动FFmpeg失败: ' + e.message)));
    }
    processClip(0);
  });
});
// --- Plugin System ---

const loadedPlugins = new Map();

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') {
      execFile('tar', ['-xf', zipPath, '-C', destDir], { timeout: 30000 }, (err) => {
        if (!err) return resolve();
        const psCmd = "Expand-Archive -Path '" + zipPath.replace(/'/g, "''") + "' -DestinationPath '" + destDir.replace(/'/g, "''") + "' -Force";
        execFile('powershell', ['-NoProfile', '-Command', psCmd], { timeout: 60000 }, (err2) => {
          if (err2) return reject(new Error('解压失败'));
          resolve();
        });
      });
    } else {
      execFile('unzip', ['-o', zipPath, '-d', destDir], { timeout: 30000 }, (err) => {
        if (err) return reject(new Error('解压失败'));
        resolve();
      });
    }
  });
}

function checkPluginCompatibility(manifest, name) {
  const errors = [];
  if (fs.existsSync(path.join(pluginsDir, name))) { errors.push('同名插件「' + name + '」已存在'); return errors; }
  const incompatList = manifest.incompatible || [];
  if (Array.isArray(incompatList)) {
    for (const otherName of incompatList) {
      if (fs.existsSync(path.join(pluginsDir, otherName))) errors.push('此插件声明不兼容「' + otherName + '」');
    }
  }
  try {
    const items = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const mp = path.join(pluginsDir, item.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(mp, 'utf-8'));
        const oi = m.incompatible || [];
        if (Array.isArray(oi) && oi.includes(name)) errors.push('已安装插件「' + item.name + '」声明不兼容');
      } catch {}
    }
  } catch {}
  return errors;
}

function readPluginManifest(pluginName) {
  const mp = path.join(pluginsDir, pluginName, 'manifest.json');
  if (!fs.existsSync(mp)) return null;
  try { return JSON.parse(fs.readFileSync(mp, 'utf-8')); } catch { return null; }
}

ipcMain.handle('plugin-list', async () => {
  const result = [];
  try {
    const items = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const mp = path.join(pluginsDir, item.name, 'manifest.json');
      const rp = path.join(pluginsDir, item.name, 'renderer.js');
      if (!fs.existsSync(mp)) continue;
      const manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      const p = { name: item.name, manifest };
      if (fs.existsSync(rp)) p.rendererCode = fs.readFileSync(rp, 'utf-8');
      result.push(p);
    }
  } catch {}
  return result;
});

ipcMain.handle('plugin-load-renderer', async (e, pluginName) => {
  const rp = path.join(pluginsDir, pluginName, 'renderer.js');
  if (!fs.existsSync(rp)) return null;
  return fs.readFileSync(rp, 'utf-8');
});

ipcMain.handle('plugin-import-zip', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择插件包 (.zip)', filters: [{ name: '插件包', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return false;
  const tmpDir = path.join(pluginsDir, '__tmp_' + Date.now());
  ensureDir(tmpDir);
  try {
    await extractZip(r.filePaths[0], tmpDir);
    let pd = null;
    for (const e of fs.readdirSync(tmpDir, { withFileTypes: true })) { if (e.isDirectory()) { pd = path.join(tmpDir, e.name); break; } }
    if (!pd) return { error: 'zip 中未找到插件文件夹' };
    const name = path.basename(pd), mp = path.join(pd, 'manifest.json');
    if (!fs.existsSync(mp)) return { error: '缺少 manifest.json' };
    const manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
    const errs = checkPluginCompatibility(manifest, name);
    if (errs.length) { fs.rmSync(tmpDir, { recursive: true, force: true }); return { error: errs.join('；') }; }
    const dest = path.join(pluginsDir, name);
    copyDirSync(pd, dest);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const rp = path.join(dest, 'renderer.js');
    const rc = fs.existsSync(rp) ? fs.readFileSync(rp, 'utf-8') : null;
    const loaded = loadPluginMain(name);
    if (loaded) { loadedPlugins.set(name, loaded); if (loaded.module.initialize) loaded.module.initialize(createPluginApi(name)).catch(e => console.error('插件初始化失败:', name, e)); }
    return { success: true, plugin: { name, manifest, rendererCode: rc } };
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { error: '导入失败: ' + (e.message || '未知错误') };
  }
});

ipcMain.handle('plugin-import-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择插件文件夹', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return false;
  const src = r.filePaths[0], name = path.basename(src);
  if (!fs.existsSync(path.join(src, 'manifest.json'))) return { error: '缺少 manifest.json' };
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf-8'));
  if (fs.existsSync(path.join(pluginsDir, name))) return { error: '同名插件已存在' };
  copyDirSync(src, path.join(pluginsDir, name));
  const rp = path.join(src, 'renderer.js');
  const rc = fs.existsSync(rp) ? fs.readFileSync(rp, 'utf-8') : null;
  const loaded = loadPluginMain(name);
  if (loaded) { loadedPlugins.set(name, loaded); if (loaded.module.initialize) loaded.module.initialize(createPluginApi(name)).catch(e => console.error('插件初始化失败:', name, e)); }
  return { success: true, plugin: { name, manifest, rendererCode: rc } };
});

ipcMain.handle('plugin-delete', async (e, pluginName) => {
  const dir = path.join(pluginsDir, pluginName);
  if (!fs.existsSync(dir)) return false;
  const ex = loadedPlugins.get(pluginName);
  if (ex && ex.module && ex.module.cleanup) try { await ex.module.cleanup(); } catch {}
  loadedPlugins.delete(pluginName);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
});

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, item.name), d = path.join(dest, item.name);
    if (item.isDirectory()) copyDirSync(s, d); else fs.copyFileSync(s, d);
  }
}

// --- UI Pack System ---
ipcMain.handle('ui-pack-list', async () => {
  const result = [];
  try {
    const items = fs.readdirSync(uiPacksDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) continue;
      const mp = path.join(uiPacksDir, item.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      try { result.push({ name: item.name, manifest: JSON.parse(fs.readFileSync(mp, 'utf-8')) }); } catch {}
    }
  } catch {}
  return result;
});

ipcMain.handle('ui-pack-import-zip', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择UI包 (.zip)', filters: [{ name: 'UI包', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return false;
  const tmpDir = path.join(uiPacksDir, '__tmp_' + Date.now());
  ensureDir(tmpDir);
  try {
    await extractZip(r.filePaths[0], tmpDir);
    let pd = null;
    for (const e of fs.readdirSync(tmpDir, { withFileTypes: true })) { if (e.isDirectory()) { pd = path.join(tmpDir, e.name); break; } }
    if (!pd) return { error: 'zip 中未找到UI包文件夹' };
    const name = path.basename(pd), mp = path.join(pd, 'manifest.json');
    if (!fs.existsSync(mp)) return { error: '缺少 manifest.json' };
    const manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
    const dest = path.join(uiPacksDir, name);
    if (fs.existsSync(dest)) return { error: '同名UI包已存在' };
    copyDirSync(pd, dest);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { success: true, pack: { name, manifest } };
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { error: '导入失败: ' + (e.message || '未知错误') };
  }
});

ipcMain.handle('ui-pack-delete', async (e, packName) => {
  const dir = path.join(uiPacksDir, packName);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
});

ipcMain.handle('ui-pack-apply', async (e, packName) => {
  console.log('[ui-pack] applying pack:', packName);
  if (!packName) return { css: '' };  // 清除 UI 包（回到默认）
  const packDir = path.join(uiPacksDir, packName);
  const mp = path.join(packDir, 'manifest.json');
  if (!fs.existsSync(mp)) return { error: 'UI包不存在' };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(mp, 'utf-8')); } catch { return { error: 'manifest.json 解析失败' }; }
  const styleFile = path.join(packDir, manifest.style || 'assets/style.css');
  if (!fs.existsSync(styleFile)) return { error: '缺少样式文件: ' + (manifest.style || 'assets/style.css') };
  const css = fs.readFileSync(styleFile, 'utf-8');
  console.log('[ui-pack] applied', packName, '- style size:', css.length, 'bytes');
  return { css, manifest };
});

// === Hook 引擎 ===
function loadPluginMain(pluginName) {
  const mp = path.join(pluginsDir, pluginName, 'main.js');
  if (!fs.existsSync(mp)) return null;
  try { return { module: require(mp), manifest: readPluginManifest(pluginName) }; } catch { return null; }
}

function initAllPlugins() {
  try {
    for (const item of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      if (!fs.existsSync(path.join(pluginsDir, item.name, 'main.js'))) continue;
      const loaded = loadPluginMain(item.name);
      if (loaded) {
        loadedPlugins.set(item.name, loaded);
        if (loaded.module.initialize) loaded.module.initialize(createPluginApi(item.name)).catch(e => console.error('插件初始化失败:', item.name, e));
      }
    }
  } catch {}
}

function createPluginApi(pluginName) {
  return {
    registerIpcHandler: (ch, handler) => { ipcMain.handle('plugin:' + pluginName + ':' + ch, handler); },
    invokeRenderer: (ch, args) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('plugin:' + pluginName + ':' + ch, args); },
    getAppPath: () => app.getPath('userData'),
    log: (level, msg) => console.log('[' + pluginName + '][' + level + ']', msg),
    getPluginInfo: (name) => readPluginManifest(name) || loadedPlugins.get(name)?.manifest || null,
    getInstalledPlugins: () => Array.from(loadedPlugins.keys()),
  };
}

function getSortedPluginsForHook(hookName) {
  const c = [];
  for (const [name, plugin] of loadedPlugins) {
    const hooks = plugin.module?.hooks || {};
    if (typeof hooks[hookName] === 'function') c.push({ name, hookFn: hooks[hookName], priority: plugin.manifest?.priority || 0 });
  }
  return c.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

async function runPluginHook(hookName, ...args) {
  let ca = args;
  for (const p of getSortedPluginsForHook(hookName)) {
    try {
      const r = await p.hookFn(...ca);
      if (r !== undefined && r !== null) ca = Array.isArray(r) ? r : [r];
    } catch (e) { console.error('插件 hook 出错:', p.name, hookName, e); }
  }
  return ca.length === 1 ? ca[0] : ca;
}
