const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PROJECTS_DIR = path.join(app.getPath('userData'), 'projects');

function ensureDir() {
  if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function getVideosDir(projectId) {
  const d = path.join(PROJECTS_DIR, 'videos', projectId);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function listAll() {
  ensureDir();
  const projects = [];
  try {
    const files = fs.readdirSync(PROJECTS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf-8');
        const data = JSON.parse(raw);
        projects.push({
          id: f.replace('.json', ''),
          name: data.name || f.replace('.json', ''),
          sourceVideo: data.sourceVideo || '',
          charCount: (data.chars || []).length,
          timelineCount: (data.timeline || []).length,
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || '',
        });
      } catch {}
    }
  } catch {}
  projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return projects;
}

function get(id) {
  ensureDir();
  const fp = path.join(PROJECTS_DIR, id + '.json');
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return null; }
}

function save(id, data) {
  ensureDir();
  const fp = path.join(PROJECTS_DIR, id + '.json');
  data.updatedAt = new Date().toISOString();
  if (!data.createdAt) data.createdAt = data.updatedAt;
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  return true;
}

function remove(id) {
  // Delete both json and video files
  const fp = path.join(PROJECTS_DIR, id + '.json');
  try { fs.unlinkSync(fp); } catch {}
  // Remove video dir
  const vd = getVideosDir(id);
  try { fs.rmSync(vd, { recursive: true, force: true }); } catch {}
  return true;
}

module.exports = { listAll, get, save, remove, getVideosDir };
