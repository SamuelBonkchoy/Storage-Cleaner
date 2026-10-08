#!/usr/bin/env python3
"""
Storage Audit & Cleaner
Pembersihan Storage Riil di Harddisk Komputer
Runtime: Python 3 bawaan (http.server, os, hashlib, json, webbrowser, subprocess) - Zero pip dependencies
"""

import os
import sys
import json
import hashlib
import subprocess
import webbrowser
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = 3000
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TARGET = BASE_DIR / "Bahan Latihan P12"
USER_HOME = Path.home()
GIANT_THRESHOLD = 2 * 1024 * 1024  # 2 MB (2,048 KB)

def get_standard_dirs():
    dirs = [
        {"id": "desktop", "name": "Desktop", "path": USER_HOME / "Desktop"},
        {"id": "downloads", "name": "Downloads", "path": USER_HOME / "Downloads"},
        {"id": "documents", "name": "Documents", "path": USER_HOME / "Documents"},
        {"id": "pictures", "name": "Pictures", "path": USER_HOME / "Pictures"},
        {"id": "music", "name": "Music", "path": USER_HOME / "Music"},
        {"id": "videos", "name": "Videos", "path": USER_HOME / "Videos"},
        {"id": "workspace", "name": "Storage-Cleaner", "path": BASE_DIR}
    ]
    return [d for d in dirs if d["path"].exists()]

def resolve_smart_path(input_str: str) -> Path:
    if not input_str or not input_str.strip():
        return DEFAULT_TARGET
    trimmed = input_str.strip().strip('"').strip("'")
    if not trimmed:
        return DEFAULT_TARGET

    direct = Path(trimmed).resolve()
    if direct.exists() and direct.is_dir():
        return direct

    std_dirs = get_standard_dirs()
    lower = trimmed.lower()
    alias_map = {
        "desktop": "Desktop", "deskop": "Desktop",
        "download": "Downloads", "downloads": "Downloads",
        "document": "Documents", "documents": "Documents",
        "picture": "Pictures", "pictures": "Pictures", "gambar": "Pictures",
        "music": "Music", "musik": "Music",
        "video": "Videos", "videos": "Videos"
    }

    if lower in alias_map:
        for s in std_dirs:
            if s["name"].lower() == alias_map[lower].lower():
                return s["path"]

    for s in std_dirs:
        cand = s["path"] / trimmed
        if cand.exists() and cand.is_dir():
            return cand

    for s in std_dirs:
        try:
            for item in s["path"].iterdir():
                if item.is_dir():
                    if item.name.lower() == lower:
                        return item
                    cand = item / trimmed
                    if cand.exists() and cand.is_dir():
                        return cand
        except Exception:
            pass

    return direct

def format_bytes(b: int, decimals: int = 2) -> str:
    if b == 0:
        return "0 Bytes"
    sizes = ["Bytes", "KB", "MB", "GB", "TB"]
    i = 0
    val = float(b)
    while val >= 1024 and i < len(sizes) - 1:
        val /= 1024
        i += 1
    return f"{round(val, decimals)} {sizes[i]}"

def get_file_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def scan_storage(target_dir_str: str):
    target_dir = Path(target_dir_str).resolve()
    if not target_dir.exists() or not target_dir.is_dir():
        raise FileNotFoundError(f"Direktori tidak ditemukan: {target_dir}")

    all_files = []
    total_bytes = 0
    hash_map = {}
    temp_files = []

    for root, _, files in os.walk(target_dir):
        for f in files:
            fp = Path(root) / f
            try:
                stat = fp.stat()
                size = stat.st_size
                total_bytes += size
                ext = fp.suffix.lower().replace(".", "") or "FILE"
                is_tmp = ext == "tmp" or fp.name.lower().endswith(".tmp")

                try:
                    f_hash = get_file_hash(fp)
                except Exception:
                    f_hash = None

                f_obj = {
                    "name": fp.name,
                    "path": str(fp),
                    "relativePath": str(fp.relative_to(target_dir)),
                    "sizeBytes": size,
                    "sizeFormatted": format_bytes(size),
                    "ext": ext.upper(),
                    "isTmp": is_tmp,
                    "hash": f_hash
                }
                all_files.append(f_obj)

                if is_tmp:
                    temp_files.append(f_obj)

                if f_hash:
                    hash_map.setdefault(f_hash, []).append(f_obj)
            except Exception as e:
                print(f"Gagal memproses file {fp}: {e}")

    # Giant files: >= 2 MB
    giant_files = [f for f in all_files if f["sizeBytes"] >= GIANT_THRESHOLD]
    giant_files.sort(key=lambda x: x["sizeBytes"], reverse=True)

    # Duplicate groups: identical SHA-256
    duplicate_groups = []
    redundant_files_count = 0
    redundant_bytes = 0

    for h, group_files in hash_map.items():
        if len(group_files) > 1:
            group_files.sort(key=lambda x: len(x["name"]))
            master = group_files[0]
            duplicates = group_files[1:]

            redundant_files_count += len(duplicates)
            waste = sum(d["sizeBytes"] for d in duplicates)
            redundant_bytes += waste

            duplicate_groups.append({
                "hash": h,
                "master": {**master, "isMaster": True},
                "duplicates": [{**d, "isMaster": False} for d in duplicates],
                "all": [{**master, "isMaster": True}] + [{**d, "isMaster": False} for d in duplicates],
                "fileSizeFormatted": format_bytes(master["sizeBytes"]),
                "fileSizeBytes": master["sizeBytes"],
                "wastedBytes": waste,
                "wastedFormatted": format_bytes(waste),
                "count": len(group_files)
            })

    duplicate_groups.sort(key=lambda x: x["wastedBytes"], reverse=True)
    potential_savings_bytes = redundant_bytes + sum(t["sizeBytes"] for t in temp_files)
    potential_savings_mb = round(potential_savings_bytes / (1024 * 1024))
    total_mb = f"{total_bytes / (1024 * 1024):.2f}"

    return {
        "targetPath": str(target_dir),
        "totalFiles": len(all_files),
        "totalBytes": total_bytes,
        "totalMB": total_mb,
        "giantCount": len(giant_files),
        "giantFiles": giant_files,
        "duplicateGroupsCount": len(duplicate_groups),
        "duplicateGroups": duplicate_groups,
        "redundantFilesCount": redundant_files_count,
        "tempFilesCount": len(temp_files),
        "tempFiles": temp_files,
        "potentialSavingsBytes": potential_savings_bytes,
        "potentialSavingsMB": f"{potential_savings_mb} MB",
        "potentialSavingsFormatted": format_bytes(potential_savings_bytes)
    }

def clean_storage(target_dir_str: str):
    audit = scan_storage(target_dir_str)
    deleted_files = []
    errors = []
    freed_bytes = 0

    # 1. Delete duplicates (preserve master)
    for group in audit["duplicateGroups"]:
        for dup in group["duplicates"]:
            p = Path(dup["path"])
            try:
                if p.exists():
                    p.unlink()
                    deleted_files.append({
                        "path": str(p),
                        "name": dup["name"],
                        "sizeBytes": dup["sizeBytes"],
                        "type": "duplicate"
                    })
                    freed_bytes += dup["sizeBytes"]
            except Exception as e:
                errors.append({"path": str(p), "error": str(e)})

    # 2. Delete .tmp files
    for tmp in audit["tempFiles"]:
        p = Path(tmp["path"])
        if not any(d["path"] == str(p) for d in deleted_files):
            try:
                if p.exists():
                    p.unlink()
                    deleted_files.append({
                        "path": str(p),
                        "name": tmp["name"],
                        "sizeBytes": tmp["sizeBytes"],
                        "type": "temp"
                    })
                    freed_bytes += tmp["sizeBytes"]
            except Exception as e:
                errors.append({"path": str(p), "error": str(e)})

    updated_audit = scan_storage(target_dir_str)
    return {
        "success": True,
        "targetPath": audit["targetPath"],
        "deletedCount": len(deleted_files),
        "freedBytes": freed_bytes,
        "freedFormatted": format_bytes(freed_bytes),
        "freedMB": round(freed_bytes / (1024 * 1024)),
        "deletedFiles": deleted_files,
        "errors": errors,
        "updatedAudit": updated_audit
    }

def open_native_folder_dialog():
    ps_cmd = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Pilih Folder Target Audit Penyimpanan'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $f.SelectedPath }"
    try:
        res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, check=True)
        path_chosen = res.stdout.strip()
        return {"selectedPath": path_chosen if path_chosen else None}
    except Exception as e:
        return {"error": str(e)}

class StorageAuditHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/", "/index.html"]:
            from storage_audit import get_dashboard_html if False else None
            # Read dashboard HTML from storage_audit.js or render template
            js_path = BASE_DIR / "storage_audit.js"
            if js_path.exists():
                content = js_path.read_text(encoding="utf-8")
                start = content.find("<!DOCTYPE html>")
                end = content.find("`;\n}", start)
                html = content[start:end]
            else:
                html = "<h1>Storage Audit & Cleaner</h1>"
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/scan":
            qs = parse_qs(parsed.query)
            target = qs.get("path", [str(DEFAULT_TARGET)])[0]
            resolved = resolve_smart_path(target)
            try:
                result = scan_storage(str(resolved))
                self._send_json(200, result)
            except Exception as e:
                self._send_json(404, {"error": str(e)})
            return

        if parsed.path == "/api/standard-locations":
            locs = [{"id": d["id"], "name": d["name"], "path": str(d["path"])} for d in get_standard_dirs()]
            self._send_json(200, {"locations": locs, "userHome": str(USER_HOME)})
            return

        self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"

        if parsed.path == "/api/clean":
            try:
                payload = json.loads(raw_body)
                target = payload.get("targetPath", str(DEFAULT_TARGET))
                resolved = resolve_smart_path(target)
                res = clean_storage(str(resolved))
                self._send_json(200, res)
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        if parsed.path == "/api/browse-dialog":
            res = open_native_folder_dialog()
            self._send_json(200, res)
            return

        self._send_json(404, {"error": "Not Found"})

def run():
    server = HTTPServer(("0.0.0.0", PORT), StorageAuditHandler)
    url = f"http://localhost:{PORT}"
    print("====================================================")
    print("⚡ Storage Audit & Cleaner (Python Runtime)")
    print("   Pembersihan Storage Riil di Harddisk Komputer")
    print("====================================================")
    print(f"📡 Server berjalan di: {url}")
    print(f"📁 Default Target   : {DEFAULT_TARGET}")
    print("====================================================\n")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
        server.server_close()

if __name__ == "__main__":
    run()
