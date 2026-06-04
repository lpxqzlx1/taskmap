const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== HELPERS =====================
function readProjects() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8')); }
  catch { return []; }
}

function writeProjects(projects) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function getProjectFile(id) {
  return path.join(DATA_DIR, `project_${id}.json`);
}

function readProjectData(id) {
  const file = getProjectFile(id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

function writeProjectData(id, data) {
  fs.writeFileSync(getProjectFile(id), JSON.stringify(data, null, 2));
}

function deleteProjectFile(id) {
  const file = getProjectFile(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function countTasks(data) {
  if (!data || !data.tasks) return { total: 0, done: 0 };
  let total = 0, done = 0;
  for (const key in data.tasks) {
    total++;
    if (data.tasks[key].completed) done++;
  }
  return { total, done };
}

// ===================== API ROUTES =====================

// GET /api/projects - List all projects
app.get('/api/projects', (_req, res) => {
  try {
    const projects = readProjects();
    const list = projects.map(p => {
      const data = readProjectData(p.id);
      const counts = data ? countTasks(data) : { total: 0, done: 0 };
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        createdAt: p.createdAt,
        taskCount: counts.total,
        doneCount: counts.done,
      };
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/projects/:id - Get full project data
app.get('/api/projects/:id', (req, res) => {
  try {
    const data = readProjectData(req.params.id);
    if (!data) return res.status(404).json({ error: 'Project not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects - Create new project
app.post('/api/projects', (req, res) => {
  try {
    const { name, color, id } = req.body;
    const project = {
      id: id || ('proj_' + Date.now()),
      name: name || '新项目',
      color: color || '#e94560',
      createdAt: Date.now(),
    };

    const projects = readProjects();
    projects.unshift(project);
    writeProjects(projects);

    // Initialize empty project data
    writeProjectData(project.id, { tasks: {}, roots: [], nextId: 1, colorIdx: 0 });

    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/projects/:id - Update project (name/color/tasks data)
app.put('/api/projects/:id', (req, res) => {
  try {
    const { name, color, tasks, roots, nextId, colorIdx, _v } = req.body;
    const projectId = req.params.id;

    // Version check: reject stale writes
    if (_v !== undefined) {
      if (!app._versions) app._versions = {};
      const currentV = app._versions[projectId] || 0;
      if (_v < currentV) {
        return res.json({ success: true, stale: true });
      }
      app._versions[projectId] = _v;
    }

    // Update project metadata
    if (name || color) {
      const projects = readProjects();
      const idx = projects.findIndex(p => p.id === projectId);
      if (idx !== -1) {
        if (name) projects[idx].name = name;
        if (color) projects[idx].color = color;
        writeProjects(projects);
      }
    }

    // Update project task data - SMART MERGE
    if (tasks !== undefined || roots !== undefined) {
      let data = readProjectData(projectId) || { tasks: {}, roots: [], nextId: 1, colorIdx: 0 };

      // Merge tasks: union of old and new, new values win
      if (tasks !== undefined) {
        data.tasks = { ...data.tasks, ...tasks };
      }

      // Merge roots: use incoming roots (authoritative)
      if (roots !== undefined) {
        data.roots = roots;
      }

      // nextId: always take the larger value
      if (nextId !== undefined) {
        data.nextId = Math.max(data.nextId || 1, nextId);
      }

      // colorIdx: take incoming
      if (colorIdx !== undefined) {
        data.colorIdx = colorIdx;
      }

      writeProjectData(projectId, data);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id - Delete project
app.delete('/api/projects/:id', (req, res) => {
  try {
    const projects = readProjects();
    const filtered = projects.filter(p => p.id !== req.params.id);
    writeProjects(filtered);
    deleteProjectFile(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects/import - Import project from JSON
app.post('/api/projects/import', (req, res) => {
  try {
    const { name, color, id, tasks, roots, nextId, colorIdx } = req.body;

    if (!tasks || !roots) {
      return res.status(400).json({ error: 'Invalid format: tasks and roots required' });
    }

    const projectId = id || ('proj_' + Date.now());
    const project = {
      id: projectId,
      name: name || '导入项目',
      color: color || '#e94560',
      createdAt: Date.now(),
    };

    const projects = readProjects();
    projects.unshift(project);
    writeProjects(projects);

    writeProjectData(projectId, {
      tasks: tasks,
      roots: roots,
      nextId: nextId || 1,
      colorIdx: colorIdx || 0,
    });

    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', dataDir: DATA_DIR }));

// Debug: list data files
app.get('/api/debug', (_req, res) => {
  try {
    const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
    const projects = readProjects();
    res.json({
      dataDir: DATA_DIR,
      dirExists: fs.existsSync(DATA_DIR),
      files,
      projectCount: projects.length,
      projectIds: projects.map(p => ({ id: p.id, name: p.name, hasData: fs.existsSync(getProjectFile(p.id)) })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TaskMap server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Projects file: ${PROJECTS_FILE}`);
});
