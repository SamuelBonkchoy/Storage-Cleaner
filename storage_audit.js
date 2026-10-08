/**
 * Storage Audit & Cleaner
 * Pembersihan Storage Riil di Harddisk Komputer
 * Runtime: Node.js bawaan (http, fs, path, crypto, child_process) - Zero npm dependencies
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

const PORT = 3000;
const USER_HOME = os.homedir();
const DEFAULT_TARGET = path.resolve(__dirname, 'Bahan Latihan P12');
const GIANT_THRESHOLD = 2 * 1024 * 1024; // 2 MB (2.048 KB)

// Standard Windows user directories
function getStandardDirs() {
  const dirs = [
    { id: 'desktop', name: 'Desktop', icon: '🖥️', path: path.join(USER_HOME, 'Desktop') },
    { id: 'downloads', name: 'Downloads', icon: '📥', path: path.join(USER_HOME, 'Downloads') },
    { id: 'documents', name: 'Documents', icon: '📄', path: path.join(USER_HOME, 'Documents') },
    { id: 'pictures', name: 'Pictures', icon: '🖼️', path: path.join(USER_HOME, 'Pictures') },
    { id: 'music', name: 'Music', icon: '🎵', path: path.join(USER_HOME, 'Music') },
    { id: 'videos', name: 'Videos', icon: '🎬', path: path.join(USER_HOME, 'Videos') },
    { id: 'workspace', name: 'Storage-Cleaner', icon: '📦', path: process.cwd() }
  ];
  return dirs.filter(d => fs.existsSync(d.path));
}

// Smart path resolver: Resolves paths within workspace or across Desktop, Downloads, Documents, Pictures, Music, Videos
function resolveSmartPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return DEFAULT_TARGET;
  const trimmed = inputPath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return DEFAULT_TARGET;

  // 1. Direct check: absolute or relative to cwd
  const directPath = path.resolve(trimmed);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    return directPath;
  }

  const standardDirs = getStandardDirs();
  const lower = trimmed.toLowerCase();

  // 2. Standard directory alias matching
  const aliasMap = {
    'desktop': 'Desktop', 'deskop': 'Desktop',
    'download': 'Downloads', 'downloads': 'Downloads',
    'document': 'Documents', 'documents': 'Documents',
    'picture': 'Pictures', 'pictures': 'Pictures', 'gambar': 'Pictures',
    'music': 'Music', 'musik': 'Music', 'lagu': 'Music',
    'video': 'Videos', 'videos': 'Videos', 'film': 'Videos'
  };

  if (aliasMap[lower]) {
    const matched = standardDirs.find(d => d.name.toLowerCase() === aliasMap[lower].toLowerCase());
    if (matched && fs.existsSync(matched.path)) return matched.path;
  }

  // 3. Look directly inside each standard directory (e.g. Downloads/Downloads_Lab)
  for (const std of standardDirs) {
    const candidate = path.join(std.path, trimmed);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // 4. Look in immediate subdirectories of each standard directory (depth 2 search)
  for (const std of standardDirs) {
    try {
      const subEntries = fs.readdirSync(std.path, { withFileTypes: true });
      for (const entry of subEntries) {
        if (entry.isDirectory()) {
          // If the subfolder itself matches the input name
          if (entry.name.toLowerCase() === lower) {
            return path.join(std.path, entry.name);
          }
          // If inside the subfolder
          const deepCandidate = path.join(std.path, entry.name, trimmed);
          if (fs.existsSync(deepCandidate) && fs.statSync(deepCandidate).isDirectory()) {
            return deepCandidate;
          }
        }
      }
    } catch (e) {}
  }

  // Fallback to directPath
  return directPath;
}

// Helper: Format bytes to human readable format
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Calculate SHA-256 hash of a file
function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => {
      stream.destroy();
      resolve(hash.digest('hex'));
    });
    stream.on('error', err => {
      stream.destroy();
      reject(err);
    });
  });
}

// Helper: Recursively scan directory
function scanDirRecursive(dir) {
  let fileList = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fileList = fileList.concat(scanDirRecursive(fullPath));
      } else if (entry.isFile()) {
        fileList.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Gagal membaca direktori ${dir}:`, err.message);
  }
  return fileList;
}

// Core Audit Function
async function auditStorage(targetDirectory) {
  const resolvedDir = path.resolve(targetDirectory);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Direktori tidak ditemukan: ${resolvedDir}`);
  }

  const filePaths = scanDirRecursive(resolvedDir);
  let totalBytes = 0;
  const allFiles = [];
  const hashMap = {};
  const tempFiles = [];

  for (const fp of filePaths) {
    try {
      const stat = fs.statSync(fp);
      totalBytes += stat.size;
      const ext = path.extname(fp).toLowerCase().replace('.', '') || 'FILE';
      const isTmp = ext === 'tmp' || fp.toLowerCase().endsWith('.tmp');

      let hash = null;
      try {
        hash = await getFileHash(fp);
      } catch (e) {
        console.warn(`Gagal menghitung hash untuk ${fp}:`, e.message);
      }

      const fileObj = {
        name: path.basename(fp),
        path: fp,
        relativePath: path.relative(resolvedDir, fp),
        sizeBytes: stat.size,
        sizeFormatted: formatBytes(stat.size),
        ext: ext.toUpperCase(),
        isTmp,
        mtime: stat.mtime,
        hash
      };

      allFiles.push(fileObj);

      if (isTmp) {
        tempFiles.push(fileObj);
      }

      if (hash) {
        if (!hashMap[hash]) hashMap[hash] = [];
        hashMap[hash].push(fileObj);
      }
    } catch (err) {
      console.error(`Gagal memproses file ${fp}:`, err.message);
    }
  }

  // Giant files: size >= 2 MB (2.048 KB) sorted descending by size
  const giantFiles = allFiles
    .filter(f => f.sizeBytes >= GIANT_THRESHOLD)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  // Duplicate groups: hash matches with 2+ files
  const duplicateGroups = [];
  let redundantFilesCount = 0;
  let redundantBytes = 0;

  for (const [hash, groupFiles] of Object.entries(hashMap)) {
    if (groupFiles.length > 1) {
      // Sort to establish master: earliest modified or shortest name
      groupFiles.sort((a, b) => a.name.length - b.name.length);
      const master = groupFiles[0];
      const duplicates = groupFiles.slice(1);

      redundantFilesCount += duplicates.length;
      redundantBytes += duplicates.reduce((acc, f) => acc + f.sizeBytes, 0);

      duplicateGroups.push({
        hash,
        master: { ...master, isMaster: true },
        duplicates: duplicates.map(d => ({ ...d, isMaster: false })),
        all: [
          { ...master, isMaster: true },
          ...duplicates.map(d => ({ ...d, isMaster: false }))
        ],
        fileSizeFormatted: formatBytes(master.sizeBytes),
        fileSizeBytes: master.sizeBytes,
        wastedBytes: duplicates.reduce((acc, f) => acc + f.sizeBytes, 0),
        wastedFormatted: formatBytes(duplicates.reduce((acc, f) => acc + f.sizeBytes, 0)),
        count: groupFiles.length
      });
    }
  }

  // Sort duplicate groups by wasted bytes descending
  duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);

  const potentialSavingsBytes = redundantBytes + tempFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
  const potentialSavingsMB = Math.round(potentialSavingsBytes / (1024 * 1024));
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

  return {
    targetPath: resolvedDir,
    totalFiles: allFiles.length,
    totalBytes,
    totalMB,
    giantCount: giantFiles.length,
    giantFiles,
    duplicateGroupsCount: duplicateGroups.length,
    duplicateGroups,
    redundantFilesCount,
    tempFilesCount: tempFiles.length,
    tempFiles,
    potentialSavingsBytes,
    potentialSavingsMB: `${potentialSavingsMB} MB`,
    potentialSavingsFormatted: formatBytes(potentialSavingsBytes)
  };
}

// Physical in-place deletion of duplicates and .tmp files
async function cleanStorage(targetDirectory) {
  const audit = await auditStorage(targetDirectory);
  const deletedFiles = [];
  const errors = [];
  let freedBytes = 0;

  // 1. Delete duplicates (preserve master)
  for (const group of audit.duplicateGroups) {
    for (const dup of group.duplicates) {
      try {
        if (fs.existsSync(dup.path)) {
          fs.unlinkSync(dup.path);
          deletedFiles.push({
            path: dup.path,
            name: dup.name,
            sizeBytes: dup.sizeBytes,
            type: 'duplicate'
          });
          freedBytes += dup.sizeBytes;
        }
      } catch (err) {
        errors.push({ path: dup.path, error: err.message });
      }
    }
  }

  // 2. Delete .tmp files if not already deleted
  for (const tmp of audit.tempFiles) {
    if (!deletedFiles.find(d => d.path === tmp.path)) {
      try {
        if (fs.existsSync(tmp.path)) {
          fs.unlinkSync(tmp.path);
          deletedFiles.push({
            path: tmp.path,
            name: tmp.name,
            sizeBytes: tmp.sizeBytes,
            type: 'temp'
          });
          freedBytes += tmp.sizeBytes;
        }
      } catch (err) {
        errors.push({ path: tmp.path, error: err.message });
      }
    }
  }

  // Re-run audit after cleanup to get fresh state
  const updatedAudit = await auditStorage(targetDirectory);

  return {
    success: true,
    targetPath: audit.targetPath,
    deletedCount: deletedFiles.length,
    freedBytes,
    freedFormatted: formatBytes(freedBytes),
    freedMB: Math.round(freedBytes / (1024 * 1024)),
    deletedFiles,
    errors,
    updatedAudit
  };
}

// Native Windows Folder Browser Dialog via PowerShell
function openNativeFolderDialog() {
  return new Promise((resolve) => {
    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Pilih Folder Target Audit Penyimpanan'; $f.SelectedPath = '${USER_HOME.replace(/\\/g, '\\\\')}'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $f.SelectedPath }`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err.message });
      } else {
        const folder = stdout.trim();
        resolve({ selectedPath: folder || null });
      }
    });
  });
}

// Reset sample folder from Downloads_Lab if available
function resetSampleFolder() {
  const source = path.resolve('c:/Users/Student/Downloads/Downloads_Lab');
  const dest = DEFAULT_TARGET;
  if (fs.existsSync(source)) {
    // Copy recursively
    fs.cpSync(source, dest, { recursive: true, force: true });
    return { success: true, message: 'Folder Bahan Latihan P12 berhasil dipulihkan dari data sampel.' };
  }
  return { success: false, message: 'Sumber data sampel Downloads_Lab tidak ditemukan.' };
}

// Embedded Web Application HTML/CSS/JS
function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Storage Audit & Cleaner - Pembersihan Storage Riil di Harddisk Komputer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f2937;
      --card-hover: #162032;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --primary-blue: #2563eb;
      --primary-blue-hover: #1d4ed8;
      --neon-cyan: #38bdf8;
      --accent-green: #10b981;
      --accent-green-glow: rgba(16, 185, 129, 0.2);
      --accent-red: #ef4444;
      --accent-red-hover: #dc2626;
      --accent-yellow: #f59e0b;
      --accent-purple: #c084fc;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    body {
      background-color: var(--bg-main);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding: 24px 36px 60px;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #0f172a;
    }
    ::-webkit-scrollbar-thumb {
      background: #334155;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #475569;
    }

    .container {
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
    }

    /* Top Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 12px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .app-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.4);
    }

    .app-icon svg {
      width: 26px;
      height: 26px;
      fill: #ffffff;
    }

    .title-group h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .direct-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      color: #4ade80;
      border: 1px solid rgba(74, 222, 128, 0.4);
      background: rgba(34, 197, 94, 0.12);
      border-radius: 6px;
      padding: 2px 8px;
      letter-spacing: 0.3px;
    }

    .title-group p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 3px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      outline: none;
      text-decoration: none;
    }

    .btn svg {
      width: 16px;
      height: 16px;
    }

    .btn-secondary {
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
      color: #ffffff;
    }

    .btn-danger {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: #ffffff;
      box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35);
    }
    .btn-danger:hover {
      background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.45);
    }

    .btn-blue {
      background: #2563eb;
      color: #ffffff;
    }
    .btn-blue:hover {
      background: #1d4ed8;
    }

    .btn-teal {
      background: #059669;
      color: #ffffff;
    }
    .btn-teal:hover {
      background: #047857;
    }

    .btn-slate {
      background: #374151;
      color: #ffffff;
    }
    .btn-slate:hover {
      background: #4b5563;
    }

    /* Target Harddisk Bar */
    .target-bar {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }

    .target-info {
      display: flex;
      align-items: center;
      gap: 14px;
      overflow: hidden;
    }

    .target-folder-icon {
      width: 32px;
      height: 32px;
      color: var(--accent-yellow);
      flex-shrink: 0;
    }

    .target-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;
    }

    .target-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.6px;
    }

    .target-path {
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 14px;
      font-weight: 700;
      color: var(--neon-cyan);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .target-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    /* Quick Locations Bar */
    .quick-locations-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: -12px;
      margin-bottom: 24px;
      padding: 10px 16px;
      background: rgba(17, 24, 39, 0.7);
      border: 1px solid var(--card-border);
      border-radius: 10px;
    }

    .quick-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.5px;
      margin-right: 4px;
    }

    .location-chip {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .location-chip:hover {
      background: #334155;
      color: #ffffff;
      border-color: var(--neon-cyan);
      transform: translateY(-1px);
    }

    .location-chip.active-chip {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
    }

    /* Metric Cards Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      margin-bottom: 24px;
    }

    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .metric-card:hover {
      border-color: #374151;
      transform: translateY(-2px);
    }

    .metric-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .metric-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.6px;
    }

    .metric-icon {
      width: 20px;
      height: 20px;
    }

    .metric-value {
      font-size: 38px;
      font-weight: 800;
      color: #ffffff;
      margin: 12px 0 6px 0;
      line-height: 1.1;
      letter-spacing: -0.5px;
    }

    .metric-subtitle {
      font-size: 12px;
      color: var(--text-dim);
    }

    /* Giant Files Section */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 22px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }

    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-title-icon {
      font-size: 18px;
    }

    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
    }

    .pill-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid #d97706;
      background: rgba(217, 119, 6, 0.15);
      color: #fbbf24;
    }

    .search-box {
      background: #0b0f19;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 14px;
      color: #e2e8f0;
      font-size: 13px;
      width: 260px;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box:focus {
      border-color: var(--neon-cyan);
    }

    /* Table Styles */
    .table-container {
      overflow-x: auto;
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    thead th {
      padding: 12px 16px;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 0.6px;
      border-bottom: 1px solid var(--card-border);
      background: rgba(11, 15, 25, 0.5);
    }

    tbody tr {
      border-bottom: 1px solid #1a2333;
      transition: background 0.15s ease;
    }
    tbody tr:hover {
      background: rgba(30, 41, 59, 0.4);
    }
    tbody tr:last-child {
      border-bottom: none;
    }

    tbody td {
      padding: 14px 16px;
      font-size: 13px;
    }

    .file-name-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 600;
      color: #ffffff;
    }

    .file-icon-badge {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .icon-pdf { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .icon-zip, .icon-rar { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
    .icon-pptx { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .icon-mp4 { background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); }
    .icon-docx { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
    .icon-xlsx { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .icon-sql { background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3); }
    .icon-default { background: rgba(148, 163, 184, 0.2); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }

    .file-path-cell {
      font-family: 'JetBrains Mono', Consolas, monospace;
      color: var(--text-dim);
      font-size: 12px;
      word-break: break-all;
    }

    .file-size-cell {
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
    }

    .format-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      text-transform: uppercase;
    }

    /* Accordion Section (Duplicate Groups) */
    .accordion-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .accordion-item {
      background: #0f1626;
      border: 1px solid #1e293b;
      border-radius: 10px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .accordion-item:hover {
      border-color: #334155;
    }

    .accordion-header {
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      background: #111a2e;
    }

    .accordion-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .group-num-badge {
      background: #1e293b;
      color: var(--neon-cyan);
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .accordion-title {
      font-size: 14px;
      font-weight: 600;
      color: #f1f5f9;
    }

    .accordion-meta {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .hash-badge {
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 11px;
      color: #64748b;
      background: #0a0e17;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #1e293b;
    }

    .wasted-badge {
      font-size: 12px;
      font-weight: 700;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.25);
      padding: 3px 8px;
      border-radius: 6px;
    }

    .chevron-icon {
      width: 18px;
      height: 18px;
      color: var(--text-dim);
      transition: transform 0.2s ease;
    }
    .accordion-item.active .chevron-icon {
      transform: rotate(180deg);
    }

    .accordion-body {
      display: none;
      padding: 16px 18px;
      background: #0b0f19;
      border-top: 1px solid #1a2333;
    }
    .accordion-item.active .accordion-body {
      display: block;
    }

    .dup-file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 6px;
      background: #111827;
      border: 1px solid #1f2937;
    }
    .dup-file-row:last-child {
      margin-bottom: 0;
    }

    .dup-left {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
    }

    .status-tag {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .tag-master {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .tag-dup {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .dup-path-text {
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 12px;
      color: #cbd5e1;
      word-break: break-all;
    }

    .dup-right {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    /* Modal Overlay & Card (Screenshot 2 Faithful Reproduction) */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(5, 8, 16, 0.8);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease-out;
    }
    .modal-overlay.active {
      display: flex;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-card {
      background: #141d2f;
      border: 1px solid #24324d;
      border-radius: 16px;
      width: 540px;
      max-width: 92%;
      padding: 28px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      animation: scaleIn 0.2s ease-out;
    }

    @keyframes scaleIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .modal-icon-badge {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #3b82f6;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .modal-icon-badge svg {
      width: 24px;
      height: 24px;
      color: #60a5fa;
    }

    .modal-title {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
    }

    .modal-desc {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
      margin-bottom: 6px;
    }

    .modal-target-box {
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--neon-cyan);
      word-break: break-all;
      margin-bottom: 18px;
    }

    .modal-stats-box {
      background: #0b101b;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .modal-stats-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: #94a3b8;
    }

    .modal-stats-val {
      font-weight: 700;
      color: #ffffff;
    }

    .val-highlight {
      color: #10b981;
      font-size: 15px;
    }

    .modal-guarantee {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
      padding: 8px 10px;
      background: rgba(245, 158, 11, 0.05);
      border-radius: 8px;
      border: 1px solid rgba(245, 158, 11, 0.15);
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    /* Input Path Modal */
    .input-group {
      margin-bottom: 16px;
    }
    .input-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .text-input {
      width: 100%;
      background: #0b101b;
      border: 1px solid #24324d;
      border-radius: 8px;
      padding: 10px 14px;
      color: #ffffff;
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 13px;
      outline: none;
    }
    .text-input:focus {
      border-color: var(--neon-cyan);
    }

    .presets-wrap {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .preset-chip {
      font-size: 11px;
      background: #1e293b;
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid #334155;
    }
    .preset-chip:hover {
      background: #334155;
      color: #ffffff;
    }

    /* Floating Toasts */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2000;
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      min-width: 340px;
      max-width: 480px;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.3s ease-out;
      transition: all 0.3s ease;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast-info {
      background: #1e293b;
      border: 1px solid #3b82f6;
      border-left: 4px solid #3b82f6;
      color: #f1f5f9;
    }

    .toast-success {
      background: #0f172a;
      border: 1px solid #10b981;
      border-left: 4px solid #10b981;
      color: #f1f5f9;
    }

    .toast-error {
      background: #1e1b1b;
      border: 1px solid #ef4444;
      border-left: 4px solid #ef4444;
      color: #fca5a5;
    }

    /* Loading Spinner */
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-dim);
      font-size: 14px;
    }

    /* Responsive */
    @media (max-width: 1024px) {
      .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .target-bar {
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
      }
      .target-actions {
        width: 100%;
        flex-wrap: wrap;
      }
    }

    @media (max-width: 640px) {
      body {
        padding: 16px;
      }
      header {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
      }
      .metrics-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Header Bar -->
    <header>
      <div class="header-left">
        <div class="app-icon">
          <svg viewBox="0 0 24 24">
            <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z"/>
          </svg>
        </div>
        <div class="title-group">
          <h1>Storage Audit & Cleaner <span class="direct-badge">Direct Execution</span></h1>
          <p>Pembersihan Storage Riil di Harddisk Komputer</p>
        </div>
      </div>
      <div class="header-actions">
        <button id="btnPindaiUlang" class="btn btn-secondary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Pindai Ulang
        </button>
        <button id="btnOpenCleanModal" class="btn btn-danger">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.36 2.72l1.42 1.42a2 2 0 010 2.83l-1.42 1.42-4.24-4.25 1.41-1.42a2 2 0 012.83 0M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"/>
          </svg>
          Bersihkan Duplikat & Sampah
        </button>
      </div>
    </header>

    <!-- Target Harddisk Aktif Bar -->
    <div class="target-bar">
      <div class="target-info">
        <svg class="target-folder-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <div class="target-text">
          <span class="target-label">TARGET HARDDISK AKTIF:</span>
          <span id="targetPathText" class="target-path">Memuat target...</span>
        </div>
      </div>
      <div class="target-actions">
        <button id="btnBrowseOS" class="btn btn-blue" title="Pilih folder melalui native dialog OS Windows">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          Browse Folder (Dialog OS)
        </button>
        <input type="file" id="folderPickerInput" webkitdirectory directory multiple style="display:none;">
        <button id="btnUploadFolder" class="btn btn-teal" title="Pilih folder dari browser">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>
          Pilih / Upload Folder
        </button>
        <button id="btnInputPath" class="btn btn-slate" title="Ketik path folder secara manual">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          Input Path
        </button>
      </div>
    </div>

    <!-- Quick Locations Bar (Desktop, Downloads, Documents, Pictures, Music, Videos) -->
    <div class="quick-locations-bar">
      <span class="quick-label">JELAJAHI FOLDER KOMPUTER:</span>
      <button class="location-chip" onclick="quickSelectPath('Desktop')">🖥️ Desktop</button>
      <button class="location-chip" onclick="quickSelectPath('Downloads')">📥 Downloads</button>
      <button class="location-chip" onclick="quickSelectPath('Documents')">📄 Documents</button>
      <button class="location-chip" onclick="quickSelectPath('Pictures')">🖼️ Pictures</button>
      <button class="location-chip" onclick="quickSelectPath('Music')">🎵 Music</button>
      <button class="location-chip" onclick="quickSelectPath('Videos')">🎬 Videos</button>
      <button class="location-chip" onclick="quickSelectPath('Downloads_Lab')">⚡ Downloads_Lab</button>
      <button class="location-chip active-chip" onclick="quickSelectPath('./Bahan Latihan P12')">📁 Bahan Latihan P12</button>
    </div>

    <!-- 4 Storage Metric Cards -->
    <div class="metrics-grid">
      <!-- Card 1 -->
      <div class="metric-card">
        <div class="metric-top">
          <span class="metric-title">TOTAL FILE DI-SCAN</span>
          <svg class="metric-icon" viewBox="0 0 24 24" fill="#eab308">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
        </div>
        <div id="statTotalFiles" class="metric-value">-</div>
        <div class="metric-subtitle">STG-01: Memindai seluruh file rekursif</div>
      </div>

      <!-- Card 2 -->
      <div class="metric-card">
        <div class="metric-top">
          <span class="metric-title">TOTAL KAPASITAS FOLDER</span>
          <svg class="metric-icon" viewBox="0 0 24 24" fill="#c084fc">
            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
          </svg>
        </div>
        <div id="statTotalMB" class="metric-value">-</div>
        <div class="metric-subtitle">Ukuran data fisik asli di disk</div>
      </div>

      <!-- Card 3 -->
      <div class="metric-card">
        <div class="metric-top">
          <span class="metric-title">FILE RAKSASA (≥ 2 MB)</span>
          <svg class="metric-icon" viewBox="0 0 24 24" fill="#f59e0b">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
          </svg>
        </div>
        <div id="statGiantFiles" class="metric-value">-</div>
        <div class="metric-subtitle">STG-03: Terdeteksi file boros kuota</div>
      </div>

      <!-- Card 4 -->
      <div class="metric-card">
        <div class="metric-top">
          <span class="metric-title">POTENSI HEMAT RUANG</span>
          <svg class="metric-icon" viewBox="0 0 24 24" fill="#fbbf24">
            <path d="M7 21h2v-2H7v2zm0-8h2v-2H7v2zm4 0h2v-2h-2v2zm0 8h2v-2h-2v2zm-8-4h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V9H3v2zm4 0h2V9H7v2zm8 8h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V9h-2v2zm4 0h2V9h-2v2zm0 4h2v-2h-2v2zm0 4h2v-2h-2v2zM7 5h2V3H7v2zm4 0h2V3h-2v2zm4 0h2V3h-2v2zm4 0h2V3h-2v2z"/>
          </svg>
        </div>
        <div id="statSavingsMB" class="metric-value">-</div>
        <div class="metric-subtitle">Duplikat identik & file sampah .tmp</div>
      </div>
    </div>

    <!-- Giant Files Table Section -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-title-icon">📦</span>
          <h2 class="section-title">Daftar File Raksasa (≥ 2 MB)</h2>
          <span id="giantBadge" class="pill-badge">0 file</span>
        </div>
        <input type="text" id="giantSearch" class="search-box" placeholder="Cari file raksasa...">
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 32%;">NAMA FILE</th>
              <th style="width: 44%;">PATH LOKASI HARDDISK</th>
              <th style="width: 14%;">UKURAN</th>
              <th style="width: 10%;">FORMAT</th>
            </tr>
          </thead>
          <tbody id="giantTableBody">
            <tr><td colspan="4" class="empty-state">Sedang memindai file raksasa...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Duplicate Groups Accordion Section -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-title-icon">👥</span>
          <div>
            <div style="display:flex; align-items:center; gap:10px;">
              <h2 class="section-title">Kelompok File Duplikat (SHA-256 Identik)</h2>
              <span id="duplicateBadge" class="pill-badge" style="border-color:#ef4444; color:#f87171; background:rgba(239,68,68,0.15);">0 kelompok</span>
            </div>
            <div style="font-size:12px; color:var(--text-dim); margin-top:3px;">
              Tiap grup berisi 2+ file dengan konten 100% identik. 1 file master dipertahankan, salinan kembar siap dibersihkan.
            </div>
          </div>
        </div>
      </div>

      <div id="duplicateList" class="accordion-list">
        <div class="empty-state">Sedang menghitung hash dan memeriksa duplikat...</div>
      </div>
    </div>
  </div>

  <!-- Confirmation Modal (Screenshots 2) -->
  <div id="cleanModal" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-icon-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <h3 class="modal-title">Konfirmasi Pembersihan Harddisk Asli</h3>
      <p class="modal-desc">
        Tindakan ini akan <strong>LANGSUNG MENGHAPUS FILE DUPLIKAT DAN FILE .TMP</strong> dari harddisk asli pada folder:
      </p>
      <div id="modalTargetDisplay" class="modal-target-box">...</div>

      <div class="modal-stats-box">
        <div class="modal-stats-row">
          <span>Salinan Duplikat yang akan Dihapus:</span>
          <span id="modalDupCount" class="modal-stats-val">0 file</span>
        </div>
        <div class="modal-stats-row">
          <span>File Sampah Cache (.tmp):</span>
          <span id="modalTmpCount" class="modal-stats-val">0 file</span>
        </div>
        <div class="modal-stats-row">
          <span>Total File yang Dibersihkan Fisik:</span>
          <span id="modalTotalCleanCount" class="modal-stats-val">0 file</span>
        </div>
        <div class="modal-stats-row">
          <span>Ruang Harddisk yang Dipulihkan:</span>
          <span id="modalSavingsSize" class="modal-stats-val val-highlight">0 MB</span>
        </div>
      </div>

      <div class="modal-guarantee">
        <span>💡</span>
        <span><strong>Garansi Keamanan:</strong> 1 File master asli per kelompok duplikat 100% dijamin tetap tersimpan rapi dan tidak akan terhapus.</span>
      </div>

      <div class="modal-actions">
        <button id="btnModalCancel" class="btn btn-secondary">Batal</button>
        <button id="btnModalConfirm" class="btn btn-danger">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          Ya, Bersihkan Langsung di Harddisk
        </button>
      </div>
    </div>
  </div>

  <!-- Input Path Modal -->
  <div id="inputPathModal" class="modal-overlay">
    <div class="modal-card">
      <h3 class="modal-title">Input Path Folder Target</h3>
      <p class="modal-desc">Masukkan path absolut atau relatif folder yang ingin diaudit dan dibersihkan:</p>
      <div class="input-group">
        <input type="text" id="inputPathField" class="text-input" placeholder="Misal: ./Bahan Latihan P12 atau C:\\Users\\...">
        <div class="presets-wrap">
          <span class="preset-chip" onclick="setPresetPath('Desktop')">🖥️ Desktop</span>
          <span class="preset-chip" onclick="setPresetPath('Downloads')">📥 Downloads</span>
          <span class="preset-chip" onclick="setPresetPath('Documents')">📄 Documents</span>
          <span class="preset-chip" onclick="setPresetPath('Pictures')">🖼️ Pictures</span>
          <span class="preset-chip" onclick="setPresetPath('Music')">🎵 Music</span>
          <span class="preset-chip" onclick="setPresetPath('Videos')">🎬 Videos</span>
          <span class="preset-chip" onclick="setPresetPath('Downloads_Lab')">⚡ Downloads_Lab</span>
          <span class="preset-chip" onclick="setPresetPath('./Bahan Latihan P12')">📁 Default: ./Bahan Latihan P12</span>
          <span class="preset-chip" onclick="setPresetPath('.')">📦 Workspace (.)</span>
        </div>
      </div>
      <div class="modal-actions">
        <button id="btnCancelInputPath" class="btn btn-secondary">Batal</button>
        <button id="btnSubmitInputPath" class="btn btn-blue">Terapkan & Pindai</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div id="toastContainer" class="toast-container"></div>

  <script>
    let currentAuditData = null;
    let currentTarget = "./Bahan Latihan P12";

    // Toast Manager
    function showToast(message, type = 'info', duration = 5000) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;

      let icon = 'ℹ️';
      if (type === 'success') icon = '✓';
      if (type === 'error') icon = '⚠️';

      toast.innerHTML = '<span>' + icon + '</span><span>' + message + '</span>';
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    // Helper: File Icon Class
    function getFileIconClass(ext) {
      ext = (ext || '').toLowerCase();
      if (ext === 'pdf') return 'icon-pdf';
      if (ext === 'zip' || ext === 'rar') return 'icon-zip';
      if (ext === 'pptx' || ext === 'ppt') return 'icon-pptx';
      if (ext === 'mp4' || ext === 'mkv' || ext === 'avi') return 'icon-mp4';
      if (ext === 'docx' || ext === 'doc') return 'icon-docx';
      if (ext === 'xlsx' || ext === 'xls') return 'icon-xlsx';
      if (ext === 'sql') return 'icon-sql';
      return 'icon-default';
    }

    // Load Audit Data
    async function runScan(targetPath) {
      showToast("Mencari lokasi fisik folder '" + (targetPath || currentTarget) + "' di harddisk...", "info", 3000);
      document.getElementById('btnPindaiUlang').innerHTML = '<div class="spinner"></div> Memindai...';
      document.getElementById('btnPindaiUlang').disabled = true;

      try {
        const query = targetPath ? '?path=' + encodeURIComponent(targetPath) : '?path=' + encodeURIComponent(currentTarget);
        const res = await fetch('/api/scan' + query);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Gagal memindai folder');
        }

        currentAuditData = data;
        currentTarget = data.targetPath;
        renderDashboard(data);

        showToast("Berhasil terhubung langsung ke harddisk: " + data.targetPath, "success", 4000);
      } catch (err) {
        showToast("Gagal memindai: " + err.message, "error", 6000);
      } finally {
        document.getElementById('btnPindaiUlang').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Pindai Ulang';
        document.getElementById('btnPindaiUlang').disabled = false;
      }
    }

    // Render Dashboard UI
    function renderDashboard(data) {
      // Path display
      document.getElementById('targetPathText').textContent = data.targetPath;
      document.getElementById('targetPathText').title = data.targetPath;

      // Metric Cards
      document.getElementById('statTotalFiles').textContent = data.totalFiles;
      document.getElementById('statTotalMB').textContent = data.totalMB + ' MB';
      document.getElementById('statGiantFiles').textContent = data.giantCount;
      document.getElementById('statSavingsMB').textContent = data.potentialSavingsMB;

      // Giant Files Table
      document.getElementById('giantBadge').textContent = data.giantCount + ' file';
      renderGiantTable(data.giantFiles);

      // Duplicate Groups
      document.getElementById('duplicateBadge').textContent = data.duplicateGroupsCount + ' kelompok';
      renderDuplicateList(data.duplicateGroups);
    }

    // Render Giant Files Table
    function renderGiantTable(files) {
      const tbody = document.getElementById('giantTableBody');
      const searchVal = (document.getElementById('giantSearch').value || '').toLowerCase();
      const filtered = files.filter(f => f.name.toLowerCase().includes(searchVal) || f.path.toLowerCase().includes(searchVal));

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Tidak ada file raksasa yang cocok.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(f => {
        const iconClass = getFileIconClass(f.ext);
        return \`
          <tr>
            <td>
              <div class="file-name-cell">
                <div class="file-icon-badge \${iconClass}">\${f.ext}</div>
                <span>\${f.name}</span>
              </div>
            </td>
            <td class="file-path-cell">\${f.path}</td>
            <td class="file-size-cell">\${f.sizeFormatted}</td>
            <td><span class="format-badge">\${f.ext}</span></td>
          </tr>
        \`;
      }).join('');
    }

    // Render Duplicate Accordion
    function renderDuplicateList(groups) {
      const container = document.getElementById('duplicateList');
      if (!groups || groups.length === 0) {
        container.innerHTML = '<div class="empty-state">Tidak ditemukan file duplikat! Harddisk bersih dari duplikasi.</div>';
        return;
      }

      container.innerHTML = groups.map((g, idx) => {
        const shortHash = g.hash.substring(0, 16) + '...';
        return \`
          <div class="accordion-item" id="group-\${idx}">
            <div class="accordion-header" onclick="toggleAccordion(\${idx})">
              <div class="accordion-title-wrap">
                <span class="group-num-badge">Grup #\${idx + 1}</span>
                <span class="accordion-title">\${g.master.name} (\${g.count} file identik)</span>
              </div>
              <div class="accordion-meta">
                <span class="hash-badge" title="SHA-256: \${g.hash}">SHA256: \${shortHash}</span>
                <span class="wasted-badge">Hemat \${g.wastedFormatted}</span>
                <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 9l-7 7-7-7"/>
                </svg>
              </div>
            </div>
            <div class="accordion-body">
              \${g.all.map(f => \`
                <div class="dup-file-row">
                  <div class="dup-left">
                    <span class="status-tag \${f.isMaster ? 'tag-master' : 'tag-dup'}">
                      \${f.isMaster ? '✓ Master (Dipertahankan)' : '✕ Salinan (Akan Dihapus)'}
                    </span>
                    <span class="dup-path-text">\${f.path}</span>
                  </div>
                  <div class="dup-right">
                    <span class="file-size-cell" style="font-size:12px;">\${f.sizeFormatted}</span>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }

    function toggleAccordion(idx) {
      const item = document.getElementById('group-' + idx);
      if (item) item.classList.toggle('active');
    }

    // Search filter
    document.getElementById('giantSearch').addEventListener('input', () => {
      if (currentAuditData) renderGiantTable(currentAuditData.giantFiles);
    });

    // Clean Modal Triggers
    const cleanModal = document.getElementById('cleanModal');
    document.getElementById('btnOpenCleanModal').addEventListener('click', () => {
      if (!currentAuditData) return;
      document.getElementById('modalTargetDisplay').textContent = currentAuditData.targetPath;
      document.getElementById('modalDupCount').textContent = currentAuditData.redundantFilesCount + ' file';
      document.getElementById('modalTmpCount').textContent = currentAuditData.tempFilesCount + ' file';
      document.getElementById('modalTotalCleanCount').textContent = (currentAuditData.redundantFilesCount + currentAuditData.tempFilesCount) + ' file';
      document.getElementById('modalSavingsSize').textContent = currentAuditData.potentialSavingsMB;
      cleanModal.classList.add('active');
    });

    document.getElementById('btnModalCancel').addEventListener('click', () => {
      cleanModal.classList.remove('active');
    });

    // Execute Physical Cleaning
    document.getElementById('btnModalConfirm').addEventListener('click', async () => {
      const btn = document.getElementById('btnModalConfirm');
      btn.innerHTML = '<div class="spinner"></div> Menghapus di disk...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath: currentAuditData.targetPath })
        });
        const result = await res.json();

        if (!res.ok) throw new Error(result.error || 'Gagal membersihkan disk');

        cleanModal.classList.remove('active');
        showToast("Pembersihan fisik selesai! " + result.deletedCount + " file dihapus, " + result.freedMB + " MB ruang harddisk dipulihkan.", "success", 7000);

        // Update dashboard with fresh post-cleanup data
        currentAuditData = result.updatedAudit;
        renderDashboard(result.updatedAudit);
      } catch (err) {
        showToast("Error saat pembersihan: " + err.message, "error", 6000);
      } finally {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Ya, Bersihkan Langsung di Harddisk';
        btn.disabled = false;
      }
    });

    // Input Path Modal
    const inputPathModal = document.getElementById('inputPathModal');
    document.getElementById('btnInputPath').addEventListener('click', () => {
      document.getElementById('inputPathField').value = currentTarget;
      inputPathModal.classList.add('active');
    });

    document.getElementById('btnCancelInputPath').addEventListener('click', () => {
      inputPathModal.classList.remove('active');
    });

    document.getElementById('btnSubmitInputPath').addEventListener('click', () => {
      const val = document.getElementById('inputPathField').value.trim();
      if (val) {
        currentTarget = val;
        inputPathModal.classList.remove('active');
        runScan(currentTarget);
      }
    });

    function setPresetPath(p) {
      document.getElementById('inputPathField').value = p;
    }

    function quickSelectPath(p) {
      currentTarget = p;
      document.querySelectorAll('.location-chip').forEach(el => el.classList.remove('active-chip'));
      if (window.event && window.event.target && window.event.target.classList.contains('location-chip')) {
        window.event.target.classList.add('active-chip');
      }
      runScan(p);
    }

    // Browse OS Dialog Button
    document.getElementById('btnBrowseOS').addEventListener('click', async () => {
      showToast("Membuka dialog pemilihan folder sistem operasi...", "info", 4000);
      try {
        const res = await fetch('/api/browse-dialog', { method: 'POST' });
        const data = await res.json();
        if (data.selectedPath) {
          currentTarget = data.selectedPath;
          runScan(currentTarget);
        } else if (data.cancelled) {
          showToast("Pemilihan folder dibatalkan.", "info", 3000);
        }
      } catch (err) {
        showToast("Gagal membuka dialog OS: " + err.message + ". Gunakan tombol 'Input Path'.", "error", 5000);
      }
    });

    // Upload / Web Directory Picker
    document.getElementById('btnUploadFolder').addEventListener('click', async () => {
      // If modern Directory Picker API is available, ask user
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker();
          showToast("Folder '" + dirHandle.name + "' dipilih. Memindai di sistem...", "info", 4000);
          runScan(dirHandle.name);
          return;
        } catch (e) {
          if (e.name !== 'AbortError') console.error(e);
        }
      }
      // Fallback: trigger input file picker
      document.getElementById('folderPickerInput').click();
    });

    document.getElementById('folderPickerInput').addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const first = files[0];
        const folderName = first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] : '';
        if (folderName) {
          showToast("Folder '" + folderName + "' dipilih dari browser. Memindai jalur...", "info", 4000);
          runScan(folderName);
        }
      }
    });

    // Pindai Ulang
    document.getElementById('btnPindaiUlang').addEventListener('click', () => {
      runScan(currentTarget);
    });

    // Initial Load
    window.addEventListener('DOMContentLoaded', () => {
      runScan(currentTarget);
    });
  </script>
</body>
</html>
`;
}

// HTTP Server Handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // 1. Dashboard View
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml());
      return;
    }

    // 2. Scan API
    if (pathname === '/api/scan' && req.method === 'GET') {
      const targetParam = parsedUrl.searchParams.get('path') || DEFAULT_TARGET;
      const targetPath = resolveSmartPath(targetParam);

      if (!fs.existsSync(targetPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Folder tidak ditemukan: ${targetPath}. Pastikan folder ada di Desktop, Downloads, Documents, Pictures, Music, Videos, atau gunakan Input Path.` }));
        return;
      }

      const auditResult = await auditStorage(targetPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(auditResult));
      return;
    }

    // 3. Clean API
    if (pathname === '/api/clean' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const target = resolveSmartPath(payload.targetPath || DEFAULT_TARGET);
          const cleanResult = await cleanStorage(target);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cleanResult));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Standard Locations API
    if (pathname === '/api/standard-locations' && req.method === 'GET') {
      const locations = getStandardDirs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ locations, userHome: USER_HOME }));
      return;
    }

    // 4. OS Browse Dialog API
    if (pathname === '/api/browse-dialog' && req.method === 'POST') {
      const dialogResult = await openNativeFolderDialog();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dialogResult));
      return;
    }

    // 5. Reset Sample API
    if (pathname === '/api/reset-sample' && req.method === 'POST') {
      const resetResult = resetSampleFolder();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resetResult));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan' }));
  } catch (err) {
    console.error('Server Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// Launch server & open browser
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('====================================================');
  console.log('⚡ Storage Audit & Cleaner (Direct Execution)');
  console.log('   Pembersihan Storage Riil di Harddisk Komputer');
  console.log('====================================================');
  console.log(`📡 Server berjalan di: ${url}`);
  console.log(`📁 Default Target   : ${DEFAULT_TARGET}`);
  console.log(`💡 Buka browser di  : ${url}`);
  console.log('====================================================\n');

  // Auto open browser on Windows / Mac / Linux
  const startCmd = process.platform === 'win32' ? `start ${url}` :
                   process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(startCmd, (err) => {
    if (err) console.log(`Buka manual melalui browser: ${url}`);
  });
});
