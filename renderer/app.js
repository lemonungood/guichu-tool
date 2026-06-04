// === 更新通知 ===
function initUpdateChecker() {
  var banner = document.getElementById('update-banner');
  if (!banner) return;
  window.api.onUpdateAvailable(function(data) {
    showUpdateBanner(data);
  });
  window.api.checkUpdate = function() {
    window.api.checkForUpdate().then(function(r) {
      if (r && r.hasUpdate) showUpdateBanner(r);
      else window.api.setStatus && window.api.setStatus('已是最新版本','success');
    });
  };
}
function showUpdateBanner(data) {
  var banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.innerHTML =
    '<span class="ub-text">📦 发现新版本 <b>v' + data.latestVersion + '</b>（当前 v' + data.currentVersion + '）— 点击下载</span>' +
    '<span class="ub-close" id="ub-close">✕</span>';
  banner.classList.remove('hidden');
  banner.onclick = function(e) {
    if (e.target.id === 'ub-close') {
      banner.classList.add('hidden');
      return;
    }
    window.api.openExternal(data.downloadUrl);
    banner.classList.add('hidden');
  };
}

// === State ===
let videoPath = null, videoInfo = null, charLibrary = {}, allCharClips = [];
let timelineChars = [], selectedTimelineIdx = -1, nextClipId = 1;
let currentSettings = null, currentProjectId = null;
let isDirty = false;
let projectVideos = []; // {path, name}
let charGroups = {}; // { groupName: { color, chars[] } }
let clipboardChars = []; // Ctrl+C/X 剪贴板

// Helper
const $ = id => document.getElementById(id);
const videoPlayer = document.getElementById('video-player');
const placeholderText = document.getElementById('placeholder-text');

// === Log System（开发者专用，默认隐藏，防递归）===
(function() {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  let logging = 0;
  function sendLog(level, args) {
    if (logging > 0) return; // 防递归
    logging++;
    try { window.api.logWrite({ level, args: Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)) }); } catch {}
    finally { logging--; }
  }
  console.log = function() { origLog.apply(console, arguments); sendLog('INFO', arguments); };
  console.warn = function() { origWarn.apply(console, arguments); sendLog('WARN', arguments); };
  console.error = function() { origError.apply(console, arguments); sendLog('ERROR', arguments); };
})();

function openLogDir() {
  window.api.logOpenDir();
  setStatus('已打开日志目录','success');
}
function setStatus(text, type='') {
  const el = $('status-text');
  if (!el) return;
  el.textContent = text;
  el.className = '';
  if (type==='success') el.classList.add('success');
  if (type==='error') el.classList.add('error');
  if (type==='loading') el.classList.add('loading');
}

// Undo/Redo state
let undoStack = [], redoStack = [];
const MAX_UNDO = 50;

function pushUndo() {
  undoStack.push({
    timelineChars: JSON.parse(JSON.stringify(timelineChars)),
    selectedIdx: selectedTimelineIdx,
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  isDirty = true;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push({
    timelineChars: JSON.parse(JSON.stringify(timelineChars)),
    selectedIdx: selectedTimelineIdx,
  });
  const state = undoStack.pop();
  timelineChars = state.timelineChars;
  selectedTimelineIdx = state.selectedIdx;
  renderTimeline();
  setStatus('已撤回');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push({
    timelineChars: JSON.parse(JSON.stringify(timelineChars)),
    selectedIdx: selectedTimelineIdx,
  });
  const state = redoStack.pop();
  timelineChars = state.timelineChars;
  selectedTimelineIdx = state.selectedIdx;
  renderTimeline();
  setStatus('已恢复');
}

function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtTime(iso) {
  if (!iso) return '未知';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch(e) { return iso; }
}
function matchesFilter(char, ft) {
  if (!ft) return true;
  const lower = ft.toLowerCase();
  if (char.toLowerCase().includes(lower)) return true;
  if (charLibrary[char]?.pinyin?.some(p => p.toLowerCase().includes(lower))) return true;
  return false;
}

// ========== Project Management ==========
async function loadProjectList() {
  try {
    const list = await window.api.projectList();
    const container = $('project-list');
    if (!list || !list.length) {
      container.innerHTML = '<div class="project-list-empty">暂无项目<br><span style="font-size:11px;color:var(--text-dim);">点击上方「新建项目」开始</span></div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(p => {
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = '<div class="project-card-name">' + escHtml(p.name) + '</div>' +
        '<div class="project-card-meta">修改: ' + fmtTime(p.lastModified || p.updatedAt || '') + '</div>' +
        '<div class="project-card-actions">' +
          '<button class="project-btn-edit" data-id="' + p.id + '">编辑</button>' +
          '<button class="project-btn-del" data-id="' + p.id + '" data-name="' + escHtml(p.name) + '">删除</button>' +
        '</div>';
      card.querySelector('.project-btn-edit').addEventListener('click', () => openProject(p.id));
      card.querySelector('.project-btn-del').addEventListener('click', async () => {
        const res = await showDialog({ title:'删除项目', message:'确定删除项目「'+p.name+'」？', type:'confirm', confirmText:'删除', cancelText:'取消', dangerText:null });
        if (res.confirmed) { await window.api.projectDelete(p.id); setStatus('项目已删除','success'); loadProjectList(); }
      });
      container.appendChild(card);
    });
  } catch(e) { console.error('loadProjectList', e); }
}

async function newProject() {
  if (isDirty && allCharClips.length > 0) {
    const res = await showDialog({ title:'未保存', message:'当前有未保存的更改，是否保存？', type:'confirm', confirmText:'保存', cancelText:'取消', dangerText:'不保存' });
    if (res.dangerClicked) { /* skip save */ }
    else if (res.confirmed) { await saveCurrentProject(); }
    else return;
  }
  const name = await showDialog({ title:'新建项目', message:'请输入项目名称：', type:'prompt', inputDefault:'我的项目', confirmText:'创建', cancelText:'取消' });
  if (!name.confirmed || !name.inputValue.trim()) return;
  const id = 'proj_' + Date.now();
  await window.api.clearSegments({ projectId: id });
  await window.api.projectSave(id, { name: name.inputValue.trim(), version:1, createdAt: new Date().toISOString(), charLibrary:{}, allCharClips:[], timelineChars:[], projectVideos:[], charGroups:{} });
  await openProject(id);
}

async function openProject(id) {
  if (isDirty && allCharClips.length > 0) {
    const res = await showDialog({ title:'未保存', message:'当前有未保存的更改，是否保存？', type:'confirm', confirmText:'保存', cancelText:'取消', dangerText:'不保存' });
    if (res.dangerClicked) { /* skip */ }
    else if (res.confirmed) { await saveCurrentProject(); }
    else return;
  }
  try {
    const data = await window.api.projectGet(id);
    if (!data) { setStatus('项目加载失败','error'); return; }
    currentProjectId = id;
    charLibrary = data.charLibrary || {};
    allCharClips = data.allCharClips || [];
    timelineChars = (data.timelineChars||[]).map(tc => {
      if (tc.clipId && tc.char) {
        const clip = allCharClips.find(c => c.id === tc.clipId);
        return { char:tc.char, clipId:tc.clipId, clip: clip || null };
      }
      return tc;
    });
    projectVideos = data.projectVideos || [];
    charGroups = data.charGroups || {};
    videoPath = null;
    nextClipId = allCharClips.reduce((max,c) => Math.max(max,c.id||0), 0) + 1;
    $('project-title').textContent = (data.name||'未命名') + ' — 鬼畜活字乱刷';
    $('view-home').classList.add('hidden');
    $('view-editor').classList.remove('hidden');
    renderCharPanel();
    renderTimeline();
    renderVideoPanel();
    isDirty = false;
    setStatus('项目已加载: ' + (data.name||''), 'success');
  } catch(e) { setStatus('加载失败: '+e.message,'error'); }
}

async function saveCurrentProject() {
  if (!currentProjectId) { setStatus('没有打开的项目','error'); return; }
  try {
    const project = await window.api.projectGet(currentProjectId);
    console.log('[项目] 保存项目:', currentProjectId, '时间轴:', timelineChars.length, '个片段');
    await window.api.projectSave(currentProjectId, {
      name: $('project-title').textContent.replace(' — 鬼畜活字乱刷',''),
      version: (project?.version || 0) + 1,
      savedAt: new Date().toISOString(),
      charLibrary, allCharClips, timelineChars, projectVideos, charGroups
    });
    isDirty = false;
    setStatus('已保存','success');
  } catch(e) { setStatus('保存失败: '+e.message,'error'); }
}

async function showHome() {
  if (isDirty && allCharClips.length > 0) {
    const res = await showDialog({ title:'未保存', message:'当前有未保存的更改，是否保存？', type:'confirm', confirmText:'保存', cancelText:'取消', dangerText:'不保存' });
    if (res.dangerClicked) { /* skip */ }
    else if (res.confirmed) { await saveCurrentProject(); }
    else return;
  }
  currentProjectId = null;
  charLibrary = {}; allCharClips = []; timelineChars = []; projectVideos = []; charGroups = {};
  clipboardChars = [];
  videoPath = null;
  $('view-editor').classList.add('hidden');
  $('view-home').classList.remove('hidden');
  loadProjectList();
  isDirty = false;
}

// ========== Settings ==========
function loadSettings() {
  try {
    const raw = localStorage.getItem('guichu-settings');
    currentSettings = raw ? JSON.parse(raw) : { theme:{ mode:'dark', accentColor:'#e94560', bgColor:'#1a1a2e' }, batchConcurrency:1 };
    applySettings(currentSettings);
  } catch(e) { currentSettings = { theme:{ mode:'dark', accentColor:'#e94560', bgColor:'#1a1a2e' }, batchConcurrency:1 }; }
}
function saveSetting(path, val) {
  const parts = path.split('.');
  let obj = currentSettings;
  for (let i=0;i<parts.length-1;i++) obj = obj[parts[i]] ||= {};
  obj[parts[parts.length-1]] = val;
  localStorage.setItem('guichu-settings', JSON.stringify(currentSettings));
  applySettings(currentSettings);
}
function applySettings(s) {
  const t = s?.theme || {};
  const mode = t.mode||'dark';
  // system 模式由 CSS @media (prefers-color-scheme) 控制，只需设 data-theme
  document.documentElement.setAttribute('data-theme', mode);
  if (t.accentColor) document.documentElement.style.setProperty('--accent', t.accentColor);
  if (t.bgColor) document.documentElement.style.setProperty('--bg', t.bgColor);
  const radios = document.querySelectorAll('input[name="theme-mode"]');
  radios.forEach(r => r.checked = (r.value === mode));
  if ($('setting-accent')) $('setting-accent').value = t.accentColor||'#e94560';
  if ($('setting-bg')) $('setting-bg').value = t.bgColor||'#1a1a2e';
  if ($('setting-batch-concurrency')) $('setting-batch-concurrency').value = s.batchConcurrency || 1;
}
function syncSettingsUI() { applySettings(currentSettings); }

// ========== Video Import ==========
async function importVideo() {
  const fp = await window.api.selectVideo();
  if (!fp) return;
  setStatus('导入中...','loading');
  showProgress(2,'清理旧片段...');
  await window.api.clearSegments({ projectId: currentProjectId }); // 清空上次导入的预提取片段
  showProgress(5,'复制视频...');
  try {
    const copyResult = await window.api.copyVideo({ projectId:currentProjectId, sourcePath:fp });
    if (!copyResult) { hideProgress(); setStatus('复制视频失败: 未知错误','error'); return; }
    if (copyResult.error) { hideProgress(); setStatus('复制视频失败: ' + copyResult.error, 'error'); return; }
    if (!copyResult.path) { hideProgress(); setStatus('复制视频失败','error'); return; }
    const destPath = copyResult.path;
    videoPath = destPath;
    projectVideos.push({ path:destPath, name:copyResult.name || fp.split(/[\\\/]/).pop() });
    showProgress(15,'语音识别中...');
    setStatus('语音识别中...','loading');
    const result = await window.api.transcribeAudio(destPath);
    if (!result || !result.words?.length) { hideProgress(); setStatus('未识别到可剪辑片段','error'); renderVideoPanel(); return; }

    // 逐字时间戳（whisper-cli 输出），每个 word 有独立的 startMs/endMs
    const words = result.words;
    console.log('[导入] 识别完成, words:', words.length, '个字, 首个:', words[0]?.text, words[0]?.startMs+'ms-'+words[0]?.endMs+'ms');
    const allExtractClips = [];
    const newClips = [];
    words.forEach((word, wi) => {
      const txt = word.text?.trim();
      if (!txt) return;
      const chars = [...txt];
      const wordStartMs = word.startMs;
      const wordEndMs   = word.endMs;
      if (wordStartMs == null || wordEndMs == null || wordEndMs <= wordStartMs) return;
      // 对于多字 token 继续均分（通常 -wt 0.3 下单字单 token 但保险）
      const perCharMs = (wordEndMs - wordStartMs) / chars.length;
      chars.forEach((ch, ci) => {
        const clipId  = nextClipId++;
        const startMs = Math.round(wordStartMs + ci * perCharMs);
        const endMs   = Math.round(wordStartMs + (ci + 1) * perCharMs);
        if (endMs <= startMs) return;
        const clip = { id:clipId, char:ch, sourceVideo:destPath, startMs, endMs, text:txt, segPath:null };
        allCharClips.push(clip);
        newClips.push(clip);
        allExtractClips.push({ clipId, char: ch, startMs, endMs });
        if (!charLibrary[ch]) charLibrary[ch] = { char:ch, clips:[] };
        charLibrary[ch].clips.push(clip);
      });
    });
    charGroups = {};
    console.log('[导入] 字库生成完成: 共', allCharClips.length, '个片段,', Object.keys(charLibrary).length, '个不同字');

    // 批量预提取：一次性切割所有片段，后续播放/导出直接用
    if (allExtractClips.length > 0) {
      const totalExtract = allExtractClips.length;
      const extractStart = Date.now();
      showProgress(25,'切割 0/'+totalExtract+' ...');

      // 监听批量提取进度（主进程事件推送）
      let extractDone = false;
      function onBatchProgress(d) {
        if (extractDone) return;
        const cur = d.current, tot = d.total;
        const elapsed = (Date.now() - extractStart) / 1000;
        const avgSec = cur > 0 ? elapsed / cur : 0;
        const remaining = Math.max(0, tot - cur) * avgSec;
        // 进度映射 25% -> 90%
        const pct = cur > 0 ? 25 + Math.round((cur / tot) * 65) : 25;
        let etaText = '';
        if (remaining > 60) etaText = '预计剩余 ' + Math.round(remaining / 60) + ' 分钟';
        else if (remaining > 1) etaText = '预计剩余 ' + Math.round(remaining) + ' 秒';
        else etaText = '即将完成';
        showProgress(pct, '切割 '+cur+'/'+tot+' '+etaText);
      }
      window.api.onBatchExtractProgress(onBatchProgress);

      setStatus('批量切割中...','loading');
      const batchConcurrency = currentSettings?.batchConcurrency || 1;
      const batchResult = await window.api.batchExtractClips({
        videoPath: destPath,
        projectId: currentProjectId,
        clips: allExtractClips.map(c => ({ id:c.clipId, char:c.char, startMs:c.startMs, endMs:c.endMs })),
        batchId: 'imp_' + Date.now(),
        concurrency: batchConcurrency
      });
      extractDone = true;
      window.api.offBatchExtractProgress(onBatchProgress);
      console.log('[导入] 批量切割完成, 并发:', batchConcurrency+',', '耗时:', ((Date.now()-extractStart)/1000).toFixed(1)+'s');

      if (batchResult && batchResult.extracted) {
        let hitCount = 0;
        batchResult.extracted.forEach((segPath, idx) => {
          if (segPath && newClips[idx]) {
            newClips[idx].segPath = segPath;
            hitCount++;
          }
        });
        const totalTime = ((Date.now() - extractStart) / 1000).toFixed(1);
        showProgress(90,'切割完成 '+hitCount+'/'+totalExtract+' 耗时'+totalTime+'秒');
      }
    }

    showProgress(100,'完成');
    renderCharPanel();
    renderVideoPanel();
    isDirty = true;
    setStatus('导入完成，识别到 '+newClips.length+' 个片段','success');
    setTimeout(hideProgress, 800);
  } catch(e) { hideProgress(); setStatus('导入失败: '+e.message,'error'); }
}

// ========== Character Panel ==========
function renderCharPanel(ft) {
  const list = $('char-list');
  list.innerHTML = '';
  const filter = (ft||$('char-search')?.value||'').trim().toLowerCase();
  const groupNames = Object.keys(charGroups);

  // Grouped chars
  if (groupNames.length) {
    for (const gName of groupNames) {
      const g = charGroups[gName];
      const groupedChars = (g.chars||[]).filter(ch => matchesFilter(ch, filter));
      if (!groupedChars.length && filter) continue;
      const header = document.createElement('div');
      header.className = 'char-group-header';
      header.innerHTML = '<span class="char-group-dot" style="background:'+(g.color||'#888')+'"></span>'+escHtml(gName)+' ('+groupedChars.length+')';
      header.style.cursor = 'pointer';
      list.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'char-grid';
      groupedChars.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = 'char-btn';
        btn.textContent = ch;
        if (g.color) btn.style.setProperty('--char-color', g.color);
        btn.addEventListener('click', () => addToTimeline(ch));
        btn.addEventListener('contextmenu', e => { e.preventDefault(); showCharContextMenu(ch, e); });
        grid.appendChild(btn);
      });
      list.appendChild(grid);
    }
  }

  // Ungrouped chars
  const ungrouped = Object.keys(charLibrary).filter(ch => {
    if (!matchesFilter(ch, filter)) return false;
    const inAnyGroup = groupNames.some(g => (charGroups[g].chars||[]).includes(ch));
    return !inAnyGroup;
  });
  if (ungrouped.length && (groupNames.length||filter)) {
    const header = document.createElement('div');
    header.className = 'char-group-header';
    header.innerHTML = '未分组 ('+ungrouped.length+')';
    list.appendChild(header);
  }
  const grid = document.createElement('div');
  grid.className = 'char-grid';
  ungrouped.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'char-btn';
    btn.textContent = ch;
    btn.addEventListener('click', () => addToTimeline(ch));
    btn.addEventListener('contextmenu', e => { e.preventDefault(); showCharContextMenu(ch, e); });
    grid.appendChild(btn);
  });
  if (ungrouped.length) list.appendChild(grid);

  if (!list.children.length) list.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:16px 0;">字库为空，请先导入视频</div>';
  $('char-count').textContent = Object.keys(charLibrary).length + ' 字';
}

function showCharContextMenu(ch, e) {
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const editOpt = document.createElement('div');
  editOpt.textContent = '纠正文字';
  editOpt.addEventListener('click', async () => {
    menu.remove();
    const res = await showDialog({ title:'纠正文字', message:'将「'+ch+'」改为：', type:'prompt', inputDefault:ch, confirmText:'确定', cancelText:'取消' });
    if (!res.confirmed || !res.inputValue.trim()) return;
    const newCh = res.inputValue.trim();
    if (newCh === ch) return;
    if (charLibrary[ch]) {
      charLibrary[newCh] = charLibrary[ch];
      charLibrary[newCh].char = newCh;
      delete charLibrary[ch];
    }
    allCharClips.forEach(c => { if (c.char===ch) c.char=newCh; });
    timelineChars.forEach(tc => { if (tc.char===ch) tc.char=newCh; });
    Object.values(charGroups).forEach(g => {
      const idx = (g.chars||[]).indexOf(ch);
      if (idx>=0) { g.chars[idx]=newCh; }
    });
    renderCharPanel();
    renderTimeline();
    isDirty = true;
    setStatus('已纠正: '+ch+' → '+newCh, 'success');
  });
  menu.appendChild(editOpt);

  const delOpt = document.createElement('div');
  delOpt.textContent = '删除此字所有片段';
  delOpt.style.color = '#e94560';
  delOpt.addEventListener('click', async () => {
    menu.remove();
    const res = await showDialog({ title:'删除确认', message:'确定删除「'+ch+'」的所有片段？', type:'confirm', confirmText:'删除', cancelText:'取消' });
    if (!res.confirmed) return;
    const ids = new Set((charLibrary[ch]?.clips||[]).map(c=>c.id));
    allCharClips = allCharClips.filter(c=>!ids.has(c.id));
    timelineChars = timelineChars.filter(tc=>!ids.has(tc.clipId));
    delete charLibrary[ch];
    Object.values(charGroups).forEach(g => { g.chars = (g.chars||[]).filter(c=>c!==ch); });
    renderCharPanel();
    renderTimeline();
    isDirty = true;
    setStatus('已删除: '+ch, 'success');
  });
  menu.appendChild(delOpt);

  // Group submenu
  const groupItem = document.createElement('div');
  groupItem.textContent = '设置分组';
  groupItem.style.position = 'relative';
  const groupSub = document.createElement('div');
  groupSub.className = 'context-submenu';
  const noGroupOpt = document.createElement('div');
  noGroupOpt.textContent = '（无分组）';
  noGroupOpt.addEventListener('click', () => {
    menu.remove();
    Object.values(charGroups).forEach(g => { g.chars = (g.chars||[]).filter(c=>c!==ch); });
    renderCharPanel();
    isDirty = true;
  });
  groupSub.appendChild(noGroupOpt);
  Object.keys(charGroups).forEach(gName => {
    const opt = document.createElement('div');
    opt.textContent = gName;
    opt.addEventListener('click', () => {
      menu.remove();
      Object.values(charGroups).forEach(g => { g.chars = (g.chars||[]).filter(c=>c!==ch); });
      if (!charGroups[gName].chars) charGroups[gName].chars = [];
      if (!charGroups[gName].chars.includes(ch)) charGroups[gName].chars.push(ch);
      renderCharPanel();
      isDirty = true;
    });
    groupSub.appendChild(opt);
  });
  groupItem.appendChild(groupSub);
  menu.appendChild(groupItem);

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 5)+'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 5)+'px';
}

// ========== Group Manager ==========
async function showGroupManager() {
  const names = Object.keys(charGroups);
  if (!names.length) { showDialog({ title:'分组管理', message:'暂无分组', type:'alert', confirmText:'确定' }); return; }
  const list = names.map((n,i) => (i+1)+'. '+n+' ('+((charGroups[n].chars||[]).length)+'字) [色: '+(charGroups[n].color||'#888')+']').join('\n');
  const res = await showDialog({
    title: '分组管理',
    message: '现有分组：\n'+list+'\n\n操作说明：\n- 输入分组编号可删除该分组（仅删除分组，不会删除字）\n- 输入分组名+空格+新色值可改颜色，如「动词 #ff0000」',
    type: 'prompt',
    inputDefault: '',
    confirmText: '执行',
    cancelText: '取消',
  });
  if (!res.confirmed || !res.inputValue) return;
  const input = res.inputValue.trim();
  const num = parseInt(input);
  if (num>0 && num<=names.length) {
    delete charGroups[names[num-1]];
    renderCharPanel();
    isDirty = true;
    setStatus('已删除分组「'+names[num-1]+'」','success');
    return;
  }
  const match = input.match(/^(.+?)\s+(#[0-9a-fA-F]{3,8})$/);
  if (match && charGroups[match[1].trim()]) {
    charGroups[match[1].trim()].color = match[2];
    renderCharPanel();
    isDirty = true;
    setStatus('已更新分组颜色','success');
    return;
  }
  setStatus('无法识别的操作','error');
}

// ========== Timeline ==========
function renderTimeline() {
  const timelineEl = $('timeline');
  timelineEl.innerHTML = '';
  $('timeline-count').textContent = timelineChars.length + ' 个字';
  timelineChars.forEach((item, idx) => {
    const el = document.createElement('div');
    const isWait = item.clip && item.clip.type === 'wait';
    el.className = 'timeline-char' + (idx===selectedTimelineIdx?' selected':'') + (isWait?' timeline-wait':'');
    if (isWait) {
      el.innerHTML = '<span class="char-index">'+(idx+1)+'</span><span class="char-text" style="font-size:14px;">⏳</span><span class="char-sub">'+((item.clip.waitMs||500)+'ms')+'</span>';
    } else {
      el.innerHTML = '<span class="char-index">'+(idx+1)+'</span><span class="char-text">'+escHtml(item.char||'?')+'</span>';
    }
    el.addEventListener('click', () => { selectedTimelineIdx=idx; renderTimeline(); $('btn-delete-selected').disabled=false; });
    el.addEventListener('dblclick', () => { if(!isWait&&item.clip&&videoPath){ videoPlayer.currentTime=(item.clip.startMs||0)/1000; videoPlayer.play(); } });
    timelineEl.appendChild(el);
  });
  function b(id) { const el = $(id); if (el) return el; return { get disabled(){}, set disabled(v){} }; }
  b('btn-clear-timeline').disabled = timelineChars.length===0;
  b('btn-play-all').disabled = timelineChars.length===0;
  b('btn-delete-selected').disabled = selectedTimelineIdx < 0;
  b('btn-copy-selected').disabled = selectedTimelineIdx < 0;
  b('btn-cut-selected').disabled = selectedTimelineIdx < 0;
  b('btn-paste').disabled = clipboardChars.length === 0;
  b('btn-export').disabled = timelineChars.length === 0;
}

function addToTimeline(char) {
  const data = charLibrary[char]; if (!data||!data.clips.length) return;
  const used = new Set(timelineChars.map(tc=>tc.clipId));
  const clip = data.clips.find(c=>!used.has(c.id)) || data.clips[0];
  if (!clip) return;
  console.log('[时间轴] 添加字:', char, 'clipId:', clip.id, '区间:', clip.startMs+'ms-'+clip.endMs+'ms, 来源:', clip.sourceVideo?.split(/[\\\/]/).pop());
  pushUndo();
  timelineChars.push({char:clip.char, clipId:clip.id, clip});
  renderTimeline();
}

function deleteSelected() {
  if (selectedTimelineIdx<0||selectedTimelineIdx>=timelineChars.length) return;
  pushUndo();
  timelineChars.splice(selectedTimelineIdx,1);
  if (selectedTimelineIdx >= timelineChars.length) selectedTimelineIdx = timelineChars.length - 1;
  renderTimeline();
}

function clearTimeline() {
  if (!timelineChars.length) return;
  pushUndo();
  timelineChars=[]; selectedTimelineIdx=-1; renderTimeline();
}

// ========== Clipboard (Ctrl+C/X/V/D) ==========
function copySelected() {
  if (selectedTimelineIdx < 0) return;
  const item = timelineChars[selectedTimelineIdx];
  clipboardChars = [JSON.parse(JSON.stringify(item))];
  setStatus('已复制','success');
  renderTimeline();
}

function cutSelected() {
  if (selectedTimelineIdx < 0) return;
  pushUndo();
  const item = timelineChars[selectedTimelineIdx];
  clipboardChars = [JSON.parse(JSON.stringify(item))];
  timelineChars.splice(selectedTimelineIdx, 1);
  if (selectedTimelineIdx >= timelineChars.length) selectedTimelineIdx = timelineChars.length - 1;
  renderTimeline();
  setStatus('已剪切','success');
}

function pasteClipboard() {
  if (!clipboardChars.length) return;
  pushUndo();
  const insertIdx = selectedTimelineIdx >= 0 ? selectedTimelineIdx + 1 : timelineChars.length;
  const items = clipboardChars.map(c => ({...JSON.parse(JSON.stringify(c))}));
  timelineChars.splice(insertIdx, 0, ...items);
  selectedTimelineIdx = insertIdx + items.length - 1;
  renderTimeline();
  setStatus('已粘贴 ' + items.length + ' 个字','success');
}

function duplicateSelected() {
  if (selectedTimelineIdx < 0) return;
  pushUndo();
  const item = JSON.parse(JSON.stringify(timelineChars[selectedTimelineIdx]));
  timelineChars.splice(selectedTimelineIdx + 1, 0, item);
  selectedTimelineIdx++;
  renderTimeline();
  setStatus('已复制','success');
}

// ========== Video Panel ==========
function renderVideoPanel() {
  const list = $('video-list');
  const count = $('video-panel-count');
  list.innerHTML = '';
  if (!projectVideos.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:10px;padding:4px;text-align:center;">暂无视频</div>';
    count.textContent = '0';
    return;
  }
  count.textContent = projectVideos.length.toString();
  for (const v of projectVideos) {
    const el = document.createElement('div');
    el.className = 'video-item';
    el.innerHTML = '<span class="video-item-name" title="'+escHtml(v.path)+'">'+escHtml(v.name)+'</span>'+
      '<button class="video-item-del" title="删除">✕</button>';
    el.querySelector('.video-item-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await showDialog({ title:'删除视频文件', message:'确定删除视频「'+v.name+'」？', type:'confirm-checkbox', confirmText:'删除', cancelText:'取消', checkboxText:'同时删除该视频对应的字库片段', checkboxDefault:false });
      if (!res.confirmed) return;
      await window.api.deleteVideoFile(v.path);
      if (res.checkboxChecked) {
        const clipsToRemove = allCharClips.filter(c => c.sourceVideo === v.path);
        const idsToRemove = new Set(clipsToRemove.map(c=>c.id));
        timelineChars = timelineChars.filter(tc => !idsToRemove.has(tc.clipId));
        allCharClips = allCharClips.filter(c => !idsToRemove.has(c.id));
        // Rebuild charLibrary from scratch
        const newLib = {};
        allCharClips.forEach(c => { if(!newLib[c.char]) newLib[c.char]={char:c.char,clips:[]}; newLib[c.char].clips.push(c); });
        // Replace charLibrary entirely, delete old keys
        const removedChars = Object.keys(charLibrary).filter(ch => !newLib[ch]);
        removedChars.forEach(ch => delete charLibrary[ch]);
        Object.assign(charLibrary, newLib);
        selectedTimelineIdx = -1;
        renderTimeline();
        renderCharPanel();
        $('btn-export').disabled = timelineChars.length===0;
      }
      const idx = projectVideos.indexOf(v);
      if (idx>=0) projectVideos.splice(idx,1);
      if (v.path===videoPath) { videoPath=null; videoPlayer.src=''; videoPlayer.style.display='none'; placeholderText.style.display='block'; }
      renderVideoPanel();
      isDirty = true;
    });
    list.appendChild(el);
  }
}

// ========== Play / Export ==========
async function playAllTimeline() {
  if (!timelineChars.length) return;
  console.log('[playAll] timelineChars:', timelineChars.length, 'items');
  const videoClips = timelineChars.map(tc=>tc.clip).filter(Boolean).filter(c=>c.type!=='wait'&&c.sourceVideo);
  if (!videoClips.length) { setStatus('时间轴中无视频片段','error'); return; }
  console.log('[playAll] videoClips:', videoClips.length, 'clips. First clip:', JSON.stringify({id:videoClips[0]?.id, char:videoClips[0]?.char, segPath:videoClips[0]?.segPath, startMs:videoClips[0]?.startMs, endMs:videoClips[0]?.endMs, sourceVideo:videoClips[0]?.sourceVideo}));
  setStatus('生成预览...','loading'); showProgress(10,'准备片段...');
  try {
    // 构建片段列表，先检查预提取片段文件是否仍存在
    const previewClips = [];
    for (const c of videoClips) {
      const segOk = c.segPath && await window.api.fileExists(c.segPath);
      console.log('[playAll] clip', c.id, 'segOk='+segOk, 'segPath='+c.segPath, 'startMs='+c.startMs, 'endMs='+c.endMs);
      previewClips.push({
        videoPath: segOk ? c.segPath : (c.sourceVideo||videoPath),
        startMs: c.startMs, endMs: c.endMs,
        segPath: segOk ? c.segPath : null
      });
    }
    console.log('[playAll] calling buildPreview with', previewClips.length, 'clips');
    const previewPath = await window.api.buildPreview({ clips: previewClips });
    console.log('[playAll] previewPath:', previewPath);
    showProgress(100,'完成');
    videoPlayer.src = 'file:///'+previewPath.replace(/\\/g,'/');
    videoPlayer.style.display='block'; placeholderText.style.display='none';
    await videoPlayer.play();
    setStatus('播放预览','success');
    setTimeout(hideProgress, 800);
  } catch(err) { console.error('[playAll] FAILED:', err); hideProgress(); alert('预览生成失败:\n'+err.message); setStatus('预览失败: '+err.message,'error'); }
}

async function exportVideo() {
  if (!timelineChars.length) { setStatus('时间轴为空','error'); return; }
  const outputPath = await window.api.selectOutput(); if (!outputPath) return;
  setStatus('导出中...','loading');
  showProgress(0,'准备导出...');
  try {
    const clipPaths = [];
    let hasWait = false;
    const total = timelineChars.length;
    for (let i=0;i<total;i++) {
      const clip = timelineChars[i].clip; if (!clip) { console.log('[export] clip', i, 'is null, skipping'); continue; }
      if (clip.type==='wait') { hasWait=true; continue; }
      // 优先使用预提取片段（需验证文件仍存在）
      const segOk = clip.segPath && await window.api.fileExists(clip.segPath);
      console.log('[export] clip', i, 'id='+clip.id, 'segOk='+segOk, 'segPath='+clip.segPath, 'startMs='+clip.startMs, 'endMs='+clip.endMs);
      if (segOk) {
        clipPaths.push(clip.segPath);
      } else {
        const pct = Math.round((i+1)/total*80);
        showProgress(pct,'提取片段 '+(i+1)+'/'+total);
        setStatus('提取 '+(i+1)+'/'+total,'loading');
        const srcPath = clip.sourceVideo||videoPath;
        clipPaths.push(await window.api.extractClip({ videoPath:srcPath, startMs:clip.startMs, endMs:clip.endMs, outputName:'seg_'+String(i).padStart(4,'0')+'.mp4' }));
      }
    }
    if (clipPaths.length===0) { hideProgress(); setStatus('无视频片段可导出','error'); return; }
    console.log('[export] clipPaths:', clipPaths);
    showProgress(90,'合并视频...');
    setStatus('合并中...','loading');
    await window.api.exportVideo({ clips:clipPaths, outputPath });
    showProgress(100,'完成');
    setStatus(hasWait?'导出成功（等待片段已跳过）':'导出成功','success');
    setTimeout(hideProgress, 1000);
  } catch(err) { console.error('[export] FAILED:', err); hideProgress(); alert('导出失败:\n'+err.message); setStatus('导出失败: '+err.message,'error'); }
}

// ========== Progress ==========
function showProgress(pct, txt) { $('progress-wrap').classList.remove('hidden'); $('progress-fill').style.width=Math.min(pct,100)+'%'; if(txt)$('progress-text').textContent=txt; }
function hideProgress() { $('progress-wrap').classList.add('hidden'); }

// ========== Custom Dialog System ==========
function showDialog(opts={}) {
  return new Promise((resolve) => {
    const overlay = $('custom-dialog-overlay');
    const titleEl = $('custom-dialog-title');
    const msgEl = $('custom-dialog-message');
    const btnArea = $('custom-dialog-buttons');
    const checkboxArea = $('custom-dialog-checkbox-area');
    const checkbox = $('custom-dialog-checkbox');
    const checkboxText = $('custom-dialog-checkbox-text');
    const inputArea = $('custom-dialog-input-area');
    const input = $('custom-dialog-input');
    const closeX = $('custom-dialog-close-x');

    titleEl.textContent = opts.title||'确认';
    msgEl.textContent = opts.message||'';

    if (opts.type==='confirm-checkbox') {
      checkboxArea.classList.remove('hidden');
      checkboxText.textContent = opts.checkboxText||'';
      checkbox.checked = opts.checkboxDefault===true;
    } else { checkboxArea.classList.add('hidden'); }

    if (opts.type==='prompt') {
      inputArea.classList.remove('hidden');
      input.value = opts.inputDefault||'';
      setTimeout(()=>input.focus(),50);
    } else { inputArea.classList.add('hidden'); }

    btnArea.innerHTML='';
    const buttons=[];
    if (opts.dangerText) buttons.push({text:opts.dangerText, cls:'dialog-btn dialog-btn-danger', value:'danger'});
    if (opts.type!=='alert') buttons.push({text:opts.cancelText||'取消', cls:'dialog-btn dialog-btn-cancel', value:'cancel'});
    buttons.push({text:opts.confirmText||'确定', cls:'dialog-btn dialog-btn-primary', value:'confirm'});

    for (const btn of buttons) {
      const el = document.createElement('button');
      el.textContent = btn.text;
      el.className = btn.cls;
      el.addEventListener('click', () => {
        overlay.classList.add('hidden');
        resolve({ confirmed:btn.value==='confirm', dangerClicked:btn.value==='danger', checkboxChecked:checkbox.checked, inputValue:input.value });
      });
      btnArea.appendChild(el);
    }

    const cleanClose = () => { overlay.classList.add('hidden'); resolve({confirmed:false,checkboxChecked:checkbox.checked,inputValue:input.value}); };
    closeX.onclick = cleanClose;
    overlay.onclick = (e) => { if(e.target===overlay) cleanClose(); };

    if (opts.type==='prompt') {
      input.onkeydown = (e) => { if(e.key==='Enter') { overlay.classList.add('hidden'); resolve({confirmed:true,checkboxChecked:checkbox.checked,inputValue:input.value}); } };
    }

    overlay.classList.remove('hidden');
  });
}

// ========== Event Binds ==========
$('btn-new-project').addEventListener('click', newProject);
$('btn-home').addEventListener('click', showHome);
$('btn-import').addEventListener('click', importVideo);
$('btn-export').addEventListener('click', exportVideo);
$('btn-save-project').addEventListener('click', ()=>saveCurrentProject());
$('btn-play-all').addEventListener('click', playAllTimeline);
$('btn-delete-selected').addEventListener('click', deleteSelected);
$('btn-clear-timeline').addEventListener('click', clearTimeline);
$('char-search').addEventListener('input', function(){ renderCharPanel(this.value); });

// Clipboard buttons (if exist in DOM)
if ($('btn-copy-selected')) $('btn-copy-selected').addEventListener('click', copySelected);
if ($('btn-cut-selected')) $('btn-cut-selected').addEventListener('click', cutSelected);
if ($('btn-paste')) $('btn-paste').addEventListener('click', pasteClipboard);

// Window controls
$('win-close').addEventListener('click', async ()=>{
  if (!$('view-editor').classList.contains('hidden')&&isDirty&&allCharClips.length>0) {
    const res = await showDialog({ title:'项目未保存', message:'当前项目有未保存的更改，是否保存？', type:'confirm', confirmText:'保存并关闭', cancelText:'取消', dangerText:'不保存' });
    if (res.dangerClicked) return window.api.close();
    if (res.confirmed) { await saveCurrentProject(); return window.api.close(); }
    return;
  }
  window.api.close();
});
$('win-min').addEventListener('click', ()=>window.api.minimize());
$('win-max').addEventListener('click', ()=>window.api.maximize());

// Playback tools
$('play-speed').addEventListener('change', function(){ videoPlayer.playbackRate=parseFloat(this.value); });
$('btn-mute').addEventListener('click', function(){ videoPlayer.muted=!videoPlayer.muted; this.textContent=videoPlayer.muted?'🔇':'🔊'; });

// Settings
$('btn-settings').addEventListener('click', ()=>{ $('settings-overlay').classList.remove('hidden'); syncSettingsUI(); });
$('btn-settings-close').addEventListener('click', ()=>$('settings-overlay').classList.add('hidden'));
$('settings-overlay').addEventListener('click', e=>{ if(e.target===$('settings-overlay')) $('settings-overlay').classList.add('hidden'); });
document.querySelectorAll('input[name="theme-mode"]').forEach(el=>{ el.addEventListener('change',function(){ if(this.checked)saveSetting('theme.mode',this.value); }); });
$('setting-accent').addEventListener('input', e=>document.documentElement.style.setProperty('--accent',e.target.value));
$('setting-accent').addEventListener('change', e=>saveSetting('theme.accentColor',e.target.value));
$('setting-bg').addEventListener('input', e=>document.documentElement.style.setProperty('--bg',e.target.value));
$('setting-bg').addEventListener('change', e=>saveSetting('theme.bgColor',e.target.value));
$('setting-batch-concurrency').addEventListener('change', function(){
  const v = parseInt(this.value) || 1;
  this.value = Math.max(1, v);
  currentSettings.batchConcurrency = parseInt(this.value);
  localStorage.setItem('guichu-settings', JSON.stringify(currentSettings));
});
// 日志系统（开发者）
$('btn-open-log').addEventListener('click', openLogDir);

// About modal
const ABOUT_PAGES = {
  sdk: '<h2>第三方SDK接入说明</h2><h3>1. FFmpeg</h3><p><b>用途：</b>视频解码、音频提取、片段切割、合并导出</p><p><b>协议：</b>LGPL/GPL</p><p><b>说明：</b>本工具内嵌 FFmpeg 二进制，首次启动时自动解压部署。</p><h3>2. Whisper（语音识别）</h3><p><b>用途：</b>将视频音频转为文字，自动生成字库</p><p><b>协议：</b>MIT</p><p>首次语音识别时自动下载模型。</p><h3>3. Electron</h3><p><b>用途：</b>桌面应用运行环境</p><p><b>协议：</b>MIT</p><h3>4. 数据安全</h3><p>所有数据存储在本地项目文件中，不会上传到任何服务器。</p>',
  privacy: '<h2>用户隐私许可协议</h2><p>本工具为纯本地离线应用，不会收集、传输或存储用户的任何个人信息。应用仅在以下情况下进行网络访问：</p><ul><li>首次运行时下载 FFmpeg 工具</li><li>首次语音识别时下载 Whisper 模型</li></ul><p>用户可以通过删除项目文件或卸载应用来完全清除所有本地数据。</p>',
  terms: '<h2>服务条款</h2><p>本工具基于 MIT 协议开源发布。您可以自由使用、修改和分发。</p><h3>使用限制</h3><ul><li>不得将本工具用于任何非法目的</li><li>不得利用本工具制作违反法律法规的内容</li></ul><p>本工具按「现状」提供，开发者不对因使用本工具而产生的任何损失承担责任。</p>'
};

async function showAboutPage(page) {
  if (page === 'about') {
    let version = '加载中...';
    try { version = await window.api.getAppVersion(); } catch(e) { version = '1.0.0'; }
    $('about-content').innerHTML =
      '<div style="text-align:center;padding:20px 0;">' +
        '<h1 style="font-size:28px;color:var(--accent);margin-bottom:4px;">鬼畜活字乱刷</h1>' +
        '<p style="font-size:14px;color:var(--text-dim);margin-bottom:24px;">视频字库编排工具</p>' +
        '<div style="background:var(--char-bg);border:1px solid var(--char-border);border-radius:8px;padding:16px;text-align:left;margin-bottom:16px;">' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-sub);">' +
            '<span style="color:var(--text-dim);">软件版本</span>' +
            '<span style="color:var(--text);font-weight:600;">v' + escHtml(version) + '</span>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-sub);">' +
            '<span style="color:var(--text-dim);">运行环境</span>' +
            '<span style="color:var(--text);">Electron</span>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;">' +
            '<span style="color:var(--text-dim);">作者</span>' +
            '<span style="color:var(--text);font-weight:600;">哔哩哔哩: 一只科中球屑</span>' +
          '</div>' +
        '</div>' +
        '<a id="about-bilibili-link" style="display:inline-block;padding:8px 24px;background:#fb7299;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;transition:filter 0.15s;" onmouseover="this.style.filter=\'brightness(1.15)\'" onmouseout="this.style.filter=\'none\'">访问作者B站主页</a>' +
        '<p style="font-size:10px;color:var(--text-muted);margin-top:8px;">点击后将通过默认浏览器打开</p>' +
      '</div>';
    document.getElementById('about-bilibili-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await window.api.openExternal('https://space.bilibili.com/3546651169917287');
    });
  } else {
    $('about-content').innerHTML = ABOUT_PAGES[page] || '内容加载失败';
  }
  document.querySelectorAll('#about-tabs .tab-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.page===page));
  setTimeout(()=>$('about-content').scrollTop=0,10);
}
$('btn-about').addEventListener('click', ()=>{ $('about-overlay').classList.remove('hidden'); showAboutPage('about'); });
$('btn-about-close').addEventListener('click', ()=>$('about-overlay').classList.add('hidden'));
$('about-overlay').addEventListener('click', e=>{ if(e.target===$('about-overlay'))$('about-overlay').classList.add('hidden'); });
document.querySelectorAll('#about-tabs .tab-btn').forEach(btn=>btn.addEventListener('click',()=>showAboutPage(btn.dataset.page)));

// ========== Plugin Manager ==========
$('btn-plugins').addEventListener('click', ()=>{ $('plugin-overlay').classList.remove('hidden'); refreshPluginList(); });
$('btn-plugin-close').addEventListener('click', ()=>$('plugin-overlay').classList.add('hidden'));
$('plugin-overlay').addEventListener('click', e=>{ if(e.target===$('plugin-overlay'))$('plugin-overlay').classList.add('hidden'); });

async function refreshPluginList() {
  const list = $('plugin-list-container');
  try {
    const plugins = await window.api.pluginList();
    if (!plugins||!plugins.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px 0;">暂无插件 — 点击右上角「导入插件」从文件夹导入</div>';
      return;
    }
    list.innerHTML = '';
    for (const p of plugins) {
      const meta = p.manifest||{};
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;background:var(--char-bg);border:1px solid var(--char-border);border-radius:6px;';
      card.innerHTML =
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-size:13px;font-weight:600;color:var(--text);">'+escHtml(meta.name||p.name)+'</div>'+
          '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">v'+escHtml(meta.version||'1.0')+' — '+escHtml(meta.author||'未知作者')+'</div>'+
          '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(meta.description||'')+'</div>'+
        '</div>'+
        '<button class="plugin-del-btn" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;padding:4px 8px;border-radius:3px;" title="删除插件">✕</button>';
      card.querySelector('.plugin-del-btn').addEventListener('click', async (e)=>{
        e.stopPropagation();
        const res = await showDialog({ title:'删除插件', message:'确定删除插件「'+(meta.name||p.name)+'」？\n此操作不可撤销！', type:'confirm', confirmText:'删除', cancelText:'取消' });
        if (!res.confirmed) return;
        await window.api.pluginDelete(p.name);
        refreshPluginList();
        setStatus('插件已删除','success');
      });
      list.appendChild(card);
    }
  } catch(e) { list.innerHTML = '<div style="color:#e94545;font-size:12px;text-align:center;padding:24px 0;">加载插件列表失败</div>'; }
}

$('btn-plugin-import').addEventListener('click', async ()=>{
  const result = await window.api.pluginImportFolder();
  if (!result) return;
  if (result.error) { setStatus('导入失败: '+result.error,'error'); return; }
  if (result.success) {
    refreshPluginList();
    setStatus('插件「'+(result.plugin?.manifest?.name||result.plugin?.name)+'」导入成功','success');
  }
});

if ($('btn-plugin-import-zip')) {
  $('btn-plugin-import-zip').addEventListener('click', async ()=>{
    const result = await window.api.pluginImportZip();
    if (!result) return;
    if (result.error) { setStatus('导入失败: '+result.error,'error'); return; }
    if (result.success) {
      refreshPluginList();
      setStatus('插件「'+(result.plugin?.manifest?.name||result.plugin?.name)+'」导入成功','success');
    }
  });
}

if ($('btn-plugin-manager')) {
  $('btn-plugin-manager').addEventListener('click', ()=>{
    $('plugin-overlay').classList.remove('hidden');
    refreshPluginList();
  });
}

// ========== UI Pack Manager ==========
$('btn-ui-pack-close').addEventListener('click', ()=>$('ui-pack-overlay').classList.add('hidden'));
$('ui-pack-overlay').addEventListener('click', e=>{ if(e.target===$('ui-pack-overlay'))$('ui-pack-overlay').classList.add('hidden'); });

async function refreshUiPackList() {
  const list = $('ui-pack-list-container');
  try {
    const packs = await window.api.uiPackList();
    if (!packs||!packs.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px 0;">暂无UI包 — 点击右上角「导入 .zip」导入</div>';
      return;
    }
    list.innerHTML = '';
    for (const p of packs) {
      const meta = p.manifest||{};
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;background:var(--char-bg);border:1px solid var(--char-border);border-radius:6px;';
      card.innerHTML =
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-size:13px;font-weight:600;color:var(--text);">'+escHtml(meta.name||p.name)+'</div>'+
          '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">v'+escHtml(meta.version||'1.0')+' — '+escHtml(meta.author||'未知作者')+'</div>'+
          '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">'+escHtml(meta.description||'')+'</div>'+
        '</div>'+
        '<button class="ui-pack-del-btn" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;padding:4px 8px;border-radius:3px;" title="删除UI包">✕</button>';
      card.querySelector('.ui-pack-del-btn').addEventListener('click', async (e)=>{
        e.stopPropagation();
        const res = await showDialog({ title:'删除UI包', message:'确定删除UI包「'+(meta.name||p.name)+'」？', type:'confirm', confirmText:'删除', cancelText:'取消' });
        if (!res.confirmed) return;
        await window.api.uiPackDelete(p.name);
        refreshUiPackList();
        setStatus('UI包已删除','success');
      });
      list.appendChild(card);
    }
  } catch(e) { list.innerHTML = '<div style="color:#e94545;font-size:12px;text-align:center;padding:24px 0;">加载失败</div>'; }
}

$('btn-ui-pack-import').addEventListener('click', async ()=>{
  const result = await window.api.uiPackImportZip();
  if (!result) return;
  if (result.error) { setStatus('导入失败: '+result.error,'error'); return; }
  if (result.success) {
    refreshUiPackList();
    setStatus('UI包「'+(result.pack?.manifest?.name||result.pack?.name)+'」导入成功','success');
  }
});

if ($('btn-ui-pack-manager')) {
  $('btn-ui-pack-manager').addEventListener('click', ()=>{
    $('ui-pack-overlay').classList.remove('hidden');
    refreshUiPackList();
  });
}

// ========== UI Pack Apply System ==========
async function applyUiPack(packName) {
  try {
    const result = await window.api.uiPackApply(packName || '');
    const styleEl = $('ui-pack-style');
    if (!styleEl) return;
    if (result.css) {
      styleEl.textContent = result.css;
      // UI 包 CSS 优先级高于默认 inline 样式，清除内联冲突
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--bg');
      console.log('[UI] 已应用:', packName, '样式大小:', result.css.length, '字节');
    } else {
      styleEl.textContent = '';
      // 恢复默认主题内联样式
      const s = currentSettings?.theme || {};
      if (s.accentColor) document.documentElement.style.setProperty('--accent', s.accentColor);
      if (s.bgColor) document.documentElement.style.setProperty('--bg', s.bgColor);
      if (packName) console.warn('[UI] 应用失败:', result.error);
    }
  } catch(e) { console.error('[UI] 应用异常:', e); }
}

async function refreshUiPackDropdown() {
  const sel = $('setting-ui-pack');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">默认主题</option>';
  try {
    const packs = await window.api.uiPackList();
    if (packs && packs.length) {
      for (const p of packs) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.manifest?.displayName || p.manifest?.name || p.name;
        sel.appendChild(opt);
      }
    }
  } catch(e) { console.error('[UI] 刷新列表失败:', e); }
  if (currentVal) sel.value = currentVal;
}

$('setting-ui-pack')?.addEventListener('change', async function() {
  const packName = this.value;
  currentSettings.activeUiPack = packName || '';
  localStorage.setItem('guichu-settings', JSON.stringify(currentSettings));
  await applyUiPack(packName);
  setStatus(packName ? '已应用 UI 包: ' + packName : '已恢复默认主题', 'success');
});

$('btn-refresh-ui-packs')?.addEventListener('click', refreshUiPackDropdown);

function initUiPack() {
  const saved = currentSettings?.activeUiPack;
  if (saved) {
    const sel = $('setting-ui-pack');
    if (sel) sel.value = saved;
    applyUiPack(saved);
  }
  refreshUiPackDropdown();
}

// ========== Keyboard Shortcuts ==========
document.addEventListener('keydown', e=>{
  const ctrl = e.ctrlKey||e.metaKey;
  // 不在输入框中时触发编辑快捷键
  const isInput = ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName||'');
  if (ctrl&&e.key==='o') { e.preventDefault(); if(!$('view-editor').classList.contains('hidden')) importVideo(); }
  if (ctrl&&e.key==='s') { e.preventDefault(); saveCurrentProject(); }
  if (ctrl&&e.key==='e') { e.preventDefault(); exportVideo(); }
  if (ctrl&&e.key==='n') { e.preventDefault(); newProject(); }
  if (ctrl&&e.shiftKey&&(e.key==='z'||e.key==='Z')) { e.preventDefault(); redo(); }
  if (ctrl&&e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if (ctrl&&e.key==='y') { e.preventDefault(); redo(); }
  // 剪贴板快捷键 (不在输入框中)
  if (!isInput) {
    if (ctrl&&e.key==='c') { e.preventDefault(); copySelected(); }
    if (ctrl&&e.key==='x') { e.preventDefault(); cutSelected(); }
    if (ctrl&&e.key==='v') { e.preventDefault(); pasteClipboard(); }
    if (ctrl&&e.key==='d') { e.preventDefault(); duplicateSelected(); }
  }
  if (e.key===' '&&!isInput) { e.preventDefault(); if(videoPlayer.paused)videoPlayer.play();else videoPlayer.pause(); }
  if ((e.key==='Delete'||e.key==='Backspace')&&selectedTimelineIdx>=0&&!isInput) { deleteSelected(); e.preventDefault(); }
  if (ctrl&&e.shiftKey&&(e.key==='l'||e.key==='L')) { e.preventDefault(); openLogDir(); }
  if (e.key==='Escape') {
    $('settings-overlay').classList.add('hidden');
    $('custom-dialog-overlay').classList.add('hidden');
    $('plugin-overlay').classList.add('hidden');
    $('about-overlay').classList.add('hidden');
    $('ui-pack-overlay').classList.add('hidden');
  }
});

// Progress listener
window.api.onTranscribeProgress(d=>showProgress(d.percent, d.text||d.percent+'%'));

// ========== Init ==========
initUpdateChecker();
loadSettings();
initUiPack();
showHome();

// ========== Load Renderer Plugins ==========
(async function loadRendererPlugins() {
  try {
    const plugins = await window.api.pluginList();
    if (!plugins || !plugins.length) return;
    for (const p of plugins) {
      if (!p.rendererCode) continue;
      try {
        const script = document.createElement('script');
        script.textContent = p.rendererCode;
        document.body.appendChild(script);
      } catch(e) {
        console.error('加载插件 renderer 失败:', p.name, e);
      }
    }
  } catch(e) {
    // plugins 列表为空或未实现，静默跳过
  }
})();
