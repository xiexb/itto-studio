"""
ITTO Studio —— FastAPI 后端

职责：
  1. 提供 49 个过程 + 关系边的读写接口（唯一数据源，落盘到 data/itto.db SQLite 库）
  2. 写入前做一致性与自洽校验（边的两端必须存在、交付物必须能对上）
  3. 事务写入 + 自动备份，避免误操作丢数据
  4. 首次启动自动从旧版 itto.json / 种子文件迁移数据
  5. 生产模式下顺带托管打包好的前端（backend/static）

启动：
  python app.py            # 或 uvicorn app:app --reload --port 8000
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_FILE = DATA_DIR / "itto.db"
LEGACY_FILE = DATA_DIR / "itto.json"  # 旧版 JSON 数据源，仅用于一次性迁移
SEED_FILE = DATA_DIR / "itto.seed.json"
DOMAINS_SEED_FILE = DATA_DIR / "domains.seed.json"  # 知识领域「定义/作用」种子（教程 8~17 章）
BACKUP_DIR = DATA_DIR / "backups"
STATIC_DIR = BASE_DIR / "static"
EXPORT_FILE = DATA_DIR / "_export.json"
MAX_BACKUPS = 40

VALID_PHASES = ["启动", "规划", "执行", "监控", "收尾"]
VALID_EDGE_KINDS = {"main", "plan", "perf", "data", "change"}
ITEM_KINDS = ("ins", "outs", "insGen", "outsUpd", "tools")
NOTE_SCOPES = ["综合", "案例", "论文"]  # 笔记应用范围（可多选）

_LOCK = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS procs (
  name       TEXT PRIMARY KEY,
  dom        TEXT NOT NULL,
  phase      TEXT NOT NULL,
  upd_detail TEXT NOT NULL DEFAULT '{}',
  tools_detail TEXT NOT NULL DEFAULT '{}',
  defn       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  mastery    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '[]',
  pos        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  proc TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  pos  INTEGER NOT NULL,
  PRIMARY KEY (proc, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_items_proc ON items(proc, pos);
CREATE TABLE IF NOT EXISTS edges (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  src  TEXT NOT NULL,
  dst  TEXT NOT NULL,
  art  TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main',
  pos  INTEGER NOT NULL,
  UNIQUE (src, dst, art)
);
CREATE TABLE IF NOT EXISTS domains (
  name    TEXT PRIMARY KEY,
  chapter TEXT NOT NULL DEFAULT '',
  defn    TEXT NOT NULL DEFAULT '',
  role    TEXT NOT NULL DEFAULT '',
  pos     INTEGER NOT NULL DEFAULT 0
);
"""


# --------------------------------------------------------------------------
# 模型
# --------------------------------------------------------------------------
class ProcModel(BaseModel):
    dom: str = Field(..., description="知识领域")
    phase: str = Field(..., description="过程组")
    ins: List[str] = Field(default_factory=list)
    outs: List[str] = Field(default_factory=list)
    insGen: List[str] = Field(default_factory=list)
    outsUpd: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    toolsDetail: Dict[str, List[str]] = Field(default_factory=dict)
    updDetail: Dict[str, List[str]] = Field(default_factory=dict)
    defn: str = Field("", description="过程定义")
    role: str = Field("", description="过程主要作用")


class DatasetModel(BaseModel):
    procs: Dict[str, ProcModel]
    edges: List[List[Any]] = Field(default_factory=list)


class SaveResult(BaseModel):
    rev: int
    updated_at: str
    procs: int
    edges: int
    repaired: List[str]
    backup: Optional[str] = None


# --------------------------------------------------------------------------
# 存储
# --------------------------------------------------------------------------
def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _write_json(path: Path, payload: dict) -> None:
    _ensure_dirs()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)


def _backup(tag: str = "auto") -> Optional[str]:
    if not DB_FILE.exists():
        return None
    _ensure_dirs()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_DIR / f"itto-{tag}-{stamp}.db"
    src = sqlite3.connect(DB_FILE)
    dst = sqlite3.connect(dest)
    with dst:
        src.backup(dst)
    dst.close()
    src.close()
    olds = sorted(BACKUP_DIR.glob("itto-*.db"))
    for f in olds[:-MAX_BACKUPS]:
        try:
            f.unlink()
        except OSError:
            pass
    return dest.name


def _db_is_empty(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT COUNT(*) AS n FROM procs").fetchone()
    return row["n"] == 0


def _write_dataset(conn: sqlite3.Connection, data: dict) -> None:
    """整体替换库中数据（在调用方的事务内执行），保留 procs 顺序与 items/edges 的 pos 排序。"""
    conn.execute("DELETE FROM edges")
    conn.execute("DELETE FROM items")
    conn.execute("DELETE FROM procs")

    procs = data.get("procs") or {}
    for pos, (name, p) in enumerate(procs.items()):
        # 学习元数据统一存 notes 列：笔记列表 + 掌握程度轨迹/显式设置
        learn = {k: p[k] for k in ("mHistory", "mNote") if p.get(k)}
        conn.execute(
            "INSERT INTO procs(name, dom, phase, upd_detail, tools_detail, defn, role, note, mastery, notes, pos) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (name, p.get("dom") or "未分类", p.get("phase") or "规划",
             json.dumps(p.get("updDetail") or {}, ensure_ascii=False),
             json.dumps(p.get("toolsDetail") or {}, ensure_ascii=False),
             p.get("defn") or "", p.get("role") or "",
             p.get("note") or "",
             json.dumps(p.get("mastery"), ensure_ascii=False) if p.get("mastery") else "",
             json.dumps({"notes": p.get("notes") or [], **learn}, ensure_ascii=False),
             pos),
        )
        for kind in ITEM_KINDS:
            for i, art in enumerate(p.get(kind) or []):
                conn.execute(
                    "INSERT OR IGNORE INTO items(proc, kind, name, pos) VALUES (?,?,?,?)",
                    (name, kind, art, i),
                )

    for pos, e in enumerate(data.get("edges") or []):
        src, dst, art = str(e[0]), str(e[1]), str(e[2])
        kind = str(e[3]) if len(e) > 3 and e[3] else "main"
        conn.execute(
            "INSERT OR IGNORE INTO edges(src, dst, art, kind, pos) VALUES (?,?,?,?,?)",
            (src, dst, art, kind, pos),
        )

    # 领域「定义/作用」：payload 未携带 domains 键时保持库中现状（兼容旧前端）
    domains = data.get("domains")
    if domains is not None:
        conn.execute("DELETE FROM domains")
        for pos, (name, d) in enumerate(domains.items()):
            conn.execute(
                "INSERT OR REPLACE INTO domains(name, chapter, defn, role, pos) VALUES (?,?,?,?,?)",
                (str(name), str(d.get("chapter") or ""),
                 str(d.get("defn") or ""), str(d.get("role") or ""), pos),
            )


def _read_dataset(conn: sqlite3.Connection) -> dict:
    """从库中还原前端需要的 {procs, edges} 结构，顺序完全按 pos。"""
    procs: Dict[str, dict] = {}
    for row in conn.execute("SELECT * FROM procs ORDER BY pos"):
        obj = {
            "dom": row["dom"],
            "phase": row["phase"],
            "ins": [],
            "outs": [],
            "insGen": [],
            "outsUpd": [],
            "tools": [],
            "toolsDetail": json.loads(row["tools_detail"] or "{}"),
            "updDetail": json.loads(row["upd_detail"] or "{}"),
            "defn": row["defn"] or "",
            "role": row["role"] or "",
        }
        if row["note"]:
            obj["note"] = row["note"]
        if row["mastery"]:
            try:
                obj["mastery"] = json.loads(row["mastery"])
            except ValueError:
                pass
        try:
            learn = json.loads(row["notes"] or "{}")
        except ValueError:
            learn = {}
        if not isinstance(learn, dict):
            learn = {}
        notes = learn.get("notes")
        # 兼容旧格式：notes 列直接是笔记数组
        if isinstance(learn, list):
            notes = learn
        if notes:
            obj["notes"] = notes
        if learn.get("mHistory"):
            obj["mHistory"] = learn["mHistory"]
        if learn.get("mNote"):
            obj["mNote"] = learn["mNote"]
        procs[row["name"]] = obj
    for row in conn.execute("SELECT proc, kind, name FROM items ORDER BY proc, kind, pos"):
        p = procs.get(row["proc"])
        if p is not None and row["kind"] in ITEM_KINDS:
            p[row["kind"]].append(row["name"])
    edges = [
        [r["src"], r["dst"], r["art"]] + ([r["kind"]] if r["kind"] != "main" else [])
        for r in conn.execute("SELECT * FROM edges ORDER BY pos")
    ]
    domains: Dict[str, dict] = {}
    for row in conn.execute("SELECT * FROM domains ORDER BY pos"):
        domains[row["name"]] = {
            "chapter": row["chapter"] or "",
            "defn": row["defn"] or "",
            "role": row["role"] or "",
        }
    return {"procs": procs, "edges": edges, "domains": domains}


def _get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def _migrate_columns(conn: sqlite3.Connection) -> None:
    """旧库缺列时补列（如 procs.defn / procs.role / procs.tools_detail）。"""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(procs)")}
    if "defn" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN defn TEXT NOT NULL DEFAULT ''")
    if "role" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN role TEXT NOT NULL DEFAULT ''")
    if "tools_detail" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN tools_detail TEXT NOT NULL DEFAULT '{}'")
    if "note" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN note TEXT NOT NULL DEFAULT ''")
    if "mastery" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN mastery TEXT NOT NULL DEFAULT ''")
    if "notes" not in cols:
        conn.execute("ALTER TABLE procs ADD COLUMN notes TEXT NOT NULL DEFAULT '[]'")
    _migrate_note_to_list(conn)


def _migrate_note_to_list(conn: sqlite3.Connection) -> None:
    """把旧的单条 note / mastery（或裸数组 notes）迁移为新包装格式（只处理旧结构的行）。"""
    rows = conn.execute(
        "SELECT name, note, mastery, notes FROM procs"
    ).fetchall()
    for row in row_iter(rows):
        raw = (row["notes"] or "").strip()
        # 已是新包装格式则跳过
        if raw.startswith("{"):
            continue
        old_notes = []
        if raw and raw != "[]":
            try:
                v = json.loads(raw)
                if isinstance(v, list):
                    old_notes = v
            except ValueError:
                pass
        note = (row["note"] or "").strip()
        mastery_raw = (row["mastery"] or "").strip()
        if not old_notes and not note and not mastery_raw:
            continue
        item: dict = {}
        if old_notes:
            item = old_notes[0]
            if len(old_notes) > 1:
                # 多条时保留全部，只把旧 note/mastery 排在最前
                rest = old_notes[1:]
            else:
                rest = []
        else:
            rest = []
        if note and not item.get("text"):
            item["text"] = note
        if mastery_raw and not item.get("mastery"):
            try:
                m = json.loads(mastery_raw)
            except ValueError:
                m = None
            if isinstance(m, dict) and m.get("level") in (1, 2, 3):
                item["mastery"] = {"level": m["level"], "at": str(m.get("at") or "")[:19]}
                if m.get("at"):
                    item["mAt"] = str(m.get("at"))[:19]
        merged = []
        if item.get("text"):
            item.setdefault("at", (item.get("mAt") or item.get("at") or "")[:19])
            merged.append(item)
            merged.extend(rest)
        conn.execute(
            "UPDATE procs SET notes=? WHERE name=?",
            (json.dumps({"notes": merged}, ensure_ascii=False), row["name"]),
        )


def row_iter(rows):
    return rows


def _load_domains_seed() -> Optional[dict]:
    """读取领域种子文件（{领域名: {chapter, defn, role}} 或其 {domains: ...} 包装）。"""
    if not DOMAINS_SEED_FILE.exists():
        return None
    try:
        raw = _read_json(DOMAINS_SEED_FILE)
    except Exception:
        return None
    if isinstance(raw, dict) and isinstance(raw.get("domains"), dict):
        raw = raw["domains"]
    return raw if isinstance(raw, dict) and raw else None


def _seed_domains(conn: sqlite3.Connection) -> None:
    """domains 表为空时注入教程提取的领域「定义/作用」（幂等，不覆盖用户编辑）。"""
    row = conn.execute("SELECT COUNT(*) AS n FROM domains").fetchone()
    if row["n"]:
        return
    seed = _load_domains_seed()
    if not seed:
        return
    for pos, (name, d) in enumerate(seed.items()):
        if not isinstance(d, dict):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO domains(name, chapter, defn, role, pos) VALUES (?,?,?,?,?)",
            (str(name), str(d.get("chapter") or ""),
             str(d.get("defn") or ""), str(d.get("role") or ""), pos),
        )
    print(f"[itto] 已注入 {len(seed)} 个知识领域的定义/作用（{DOMAINS_SEED_FILE.name}）")


def _init_db() -> None:
    """建库建表；空库时依次尝试 旧 itto.json → 种子文件 完成首次迁移。"""
    _ensure_dirs()
    with _LOCK:
        conn = _connect()
        try:
            with conn:
                conn.executescript(SCHEMA)
                _migrate_columns(conn)
                _seed_domains(conn)
                if not _db_is_empty(conn):
                    return
                source: Optional[dict] = None
                src_name = ""
                if LEGACY_FILE.exists():
                    try:
                        source = _read_json(LEGACY_FILE)
                        src_name = LEGACY_FILE.name
                    except Exception:
                        source = None
                if source is None and SEED_FILE.exists():
                    source = _read_json(SEED_FILE)
                    src_name = SEED_FILE.name
                if source is None:
                    source = {"procs": {}, "edges": []}
                    src_name = "空库"
                clean, _ = normalize(source)
                _write_dataset(conn, clean)
                _set_meta(conn, "migrated_from", src_name)
                _set_meta(conn, "updated_at", _now())
                _set_meta(conn, "rev", "0")
            if src_name != "空库":
                print(f"[itto] 已从 {src_name} 迁移数据到 {DB_FILE.name}")
        finally:
            conn.close()


def load_dataset() -> dict:
    _init_db()
    conn = _connect()
    try:
        return _read_dataset(conn)
    finally:
        conn.close()


# --------------------------------------------------------------------------
# 校验：保证「谁产出 → 谁消费」在数据上永远自洽
# --------------------------------------------------------------------------
def normalize(payload: dict) -> tuple[dict, List[str]]:
    procs_in = payload.get("procs") or {}
    edges_in = payload.get("edges") or []
    if not isinstance(procs_in, dict) or not isinstance(edges_in, list):
        raise HTTPException(status_code=422, detail="procs 必须是对象、edges 必须是数组")

    repaired: List[str] = []
    procs: Dict[str, dict] = {}
    for name, p in procs_in.items():
        name = str(name).strip()
        if not name:
            continue
        phase = str(p.get("phase", "")).strip()
        if phase not in VALID_PHASES:
            repaired.append(f"{name}: 未知过程组 {phase} → 归入「规划」")
            phase = "规划"
        upd_detail_raw = p.get("updDetail") or {}
        upd_detail: Dict[str, List[str]] = {}
        for dk, dv in upd_detail_raw.items():
            dk = str(dk).strip()
            vals = _uniq(str(v).strip() for v in (dv or []) if str(v).strip())
            if dk and vals:
                upd_detail[dk] = vals
        tools_detail_raw = p.get("toolsDetail") or {}
        tools_detail: Dict[str, List[str]] = {}
        for dk, dv in tools_detail_raw.items():
            dk = str(dk).strip()
            vals = _uniq(str(v).strip() for v in (dv or []) if str(v).strip())
            if dk and vals:
                tools_detail[dk] = vals
        proc_obj = {
            "dom": str(p.get("dom") or "未分类").strip(),
            "phase": phase,
            "ins": _uniq(str(x).strip() for x in (p.get("ins") or []) if str(x).strip()),
            "outs": _uniq(str(x).strip() for x in (p.get("outs") or []) if str(x).strip()),
            "insGen": _uniq(str(x).strip() for x in (p.get("insGen") or []) if str(x).strip()),
            "outsUpd": _uniq(str(x).strip() for x in (p.get("outsUpd") or []) if str(x).strip()),
            "tools": _uniq(str(x).strip() for x in (p.get("tools") or []) if str(x).strip()),
            "toolsDetail": tools_detail,
            "updDetail": upd_detail,
            "defn": str(p.get("defn") or "").strip(),
            "role": str(p.get("role") or "").strip(),
        }
        # 学习元数据：笔记与掌握程度（可选字段，非空才落盘）
        note = str(p.get("note") or "").strip()
        if note:
            proc_obj["note"] = note
        m_raw = p.get("mastery")
        if isinstance(m_raw, dict):
            try:
                lv = int(m_raw.get("level"))
            except (TypeError, ValueError):
                lv = 0
            if lv in (1, 2, 3):
                proc_obj["mastery"] = {
                    "level": lv,
                    "at": str(m_raw.get("at") or "").strip()[:19],
                }
        # 笔记列表：每条 {text, at, mastery?, mAt?, his?}（mastery 为保存时的掌握程度，mAt 为其设置时间，
        # his 为编辑前的历史快照 [{text, at, mastery?}]，最新在最后）
        notes_raw = p.get("notes")
        if isinstance(notes_raw, list):
            notes: List[dict] = []
            for n in notes_raw:
                if not isinstance(n, dict):
                    continue
                text = str(n.get("text") or "").strip()
                if not text:
                    continue
                item = {"text": text, "at": str(n.get("at") or "").strip()[:19]}
                scope = _norm_scope(n.get("scope"))
                if scope:
                    item["scope"] = scope
                m = n.get("mastery")
                if isinstance(m, dict):
                    try:
                        mlv = int(m.get("level"))
                    except (TypeError, ValueError):
                        mlv = 0
                    if mlv in (1, 2, 3):
                        item["mastery"] = {"level": mlv, "at": str(m.get("at") or "").strip()[:19]}
                        if n.get("mAt"):
                            item["mAt"] = str(n.get("mAt")).strip()[:19]
                his_raw = n.get("his")
                if isinstance(his_raw, list):
                    his: List[dict] = []
                    for h in his_raw:
                        if not isinstance(h, dict):
                            continue
                        ht = str(h.get("text") or "").strip()
                        if not ht:
                            continue
                        hs = {"text": ht, "at": str(h.get("at") or "").strip()[:19]}
                        hscope = _norm_scope(h.get("scope"))
                        if hscope:
                            hs["scope"] = hscope
                        hm = h.get("mastery")
                        if isinstance(hm, dict):
                            try:
                                hlv = int(hm.get("level"))
                            except (TypeError, ValueError):
                                hlv = 0
                            if hlv in (1, 2, 3):
                                hs["mastery"] = {"level": hlv, "at": str(hm.get("at") or "").strip()[:19]}
                        his.append(hs)
                    if his:
                        item["his"] = his
                notes.append(item)
            if notes:
                proc_obj["notes"] = notes
        # 掌握程度独立变更轨迹 [{level, at}]（level 0 = 待学习默认态；最新在最后）
        mh_raw = p.get("mHistory")
        if isinstance(mh_raw, list):
            mhist: List[dict] = []
            for h in mh_raw:
                if not isinstance(h, dict):
                    continue
                try:
                    hlv = int(h.get("level"))
                except (TypeError, ValueError):
                    continue
                if hlv in (0, 1, 2, 3):
                    mhist.append({"level": hlv, "at": str(h.get("at") or "").strip()[:19]})
            if mhist:
                proc_obj["mHistory"] = mhist
        # 掌握程度显式设置（头部徽标直接修改，不经过笔记）{level, at}
        mn_raw = p.get("mNote")
        if isinstance(mn_raw, dict):
            try:
                mlv2 = int(mn_raw.get("level"))
            except (TypeError, ValueError):
                mlv2 = -1
            if mlv2 in (0, 1, 2, 3):
                proc_obj["mNote"] = {"level": mlv2, "at": str(mn_raw.get("at") or "").strip()[:19]}
        procs[name] = proc_obj

    edges: List[List[Any]] = []
    seen = set()
    for e in edges_in:
        if not isinstance(e, (list, tuple)) or len(e) < 3:
            continue
        src, dst, art = str(e[0]).strip(), str(e[1]).strip(), str(e[2]).strip()
        if not src or not dst or not art or src == dst:
            repaired.append(f"丢弃非法边 {src}→{dst} ({art})")
            continue
        if src not in procs or dst not in procs:
            repaired.append(f"丢弃悬空边 {src}→{dst} ({art})")
            continue
        kind = str(e[3]).strip() if len(e) > 3 and e[3] else "main"
        if kind not in VALID_EDGE_KINDS:
            kind = "main"
        key = (src, dst, art)
        if key in seen:
            continue
        seen.add(key)
        # 自洽修复:交付物必须同时出现在来源的输出与目标的输入里(核心名互认更新类聚合)
        def _core(x: str) -> str:
            return str(x).replace("（更新）", "").replace("(更新)", "")

        if art not in procs[src]["outs"] and not any(
            _core(x) == _core(art) for x in procs[src]["outsUpd"]
        ):
            procs[src]["outs"].append(art)
            repaired.append(f"{src}: 补记输出「{art}」")
        if art not in procs[dst]["ins"] and not any(
            _core(x) == _core(art) for x in procs[dst]["ins"] + procs[dst]["insGen"]
        ):
            procs[dst]["ins"].append(art)
            repaired.append(f"{dst}: 补记输入「{art}」")
        edges.append([src, dst, art] + ([kind] if kind != "main" else []))

    # 知识领域「定义/作用」：仅在 payload 显式携带 domains 时更新（None = 不动库中现状）
    domains: Optional[Dict[str, dict]] = None
    domains_in = payload.get("domains")
    if isinstance(domains_in, dict):
        domains = {}
        for dname, d in domains_in.items():
            dname = str(dname).strip()
            if not dname or not isinstance(d, dict):
                continue
            domains[dname] = {
                "chapter": str(d.get("chapter") or "").strip(),
                "defn": str(d.get("defn") or "").strip(),
                "role": str(d.get("role") or "").strip(),
            }

    return {"procs": procs, "edges": edges, "domains": domains}, repaired


def _uniq(seq) -> List[str]:
    out, seen = [], set()
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _norm_scope(raw) -> List[str]:
    """笔记应用范围：只保留合法值，按固定顺序去重（综合 → 案例 → 论文）。"""
    if not isinstance(raw, list):
        return []
    chosen = {str(x).strip() for x in raw}
    return [s for s in NOTE_SCOPES if s in chosen]


def _stats(ds: dict) -> dict:
    s = {"procs": len(ds.get("procs", {})), "edges": len(ds.get("edges", []))}
    if ds.get("domains") is not None:
        s["domains"] = len(ds["domains"])
    return s


def _rev(conn: sqlite3.Connection) -> int:
    return int(_get_meta(conn, "rev") or 0)


# --------------------------------------------------------------------------
# 应用
# --------------------------------------------------------------------------
app = FastAPI(title="ITTO Studio API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:4173", "http://127.0.0.1:4173",
        "http://localhost:8000", "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    _init_db()


@app.get("/api/health")
def health() -> dict:
    conn = _connect()
    try:
        return {
            "ok": True,
            "data_file": str(DB_FILE),
            "updated_at": _get_meta(conn, "updated_at") or None,
            "rev": _rev(conn),
        }
    finally:
        conn.close()


@app.get("/api/itto")
def get_itto() -> JSONResponse:
    conn = _connect()
    try:
        ds = _read_dataset(conn)
        return JSONResponse({
            "procs": ds["procs"],
            "edges": ds["edges"],
            "domains": ds.get("domains") or {},
            "meta": {
                "updatedAt": _get_meta(conn, "updated_at") or None,
                "rev": _rev(conn),
                "dataFile": str(DB_FILE),
            },
        })
    finally:
        conn.close()


@app.put("/api/itto")
def put_itto(payload: dict = Body(...)) -> dict:
    clean, repaired = normalize(payload)
    with _LOCK:
        backup = _backup("edit")
        conn = _connect()
        try:
            with conn:
                rev = _rev(conn) + 1
                _write_dataset(conn, clean)
                _set_meta(conn, "updated_at", _now())
                _set_meta(conn, "rev", str(rev))
            return {
                "ok": True,
                "rev": rev,
                "updated_at": _get_meta(conn, "updated_at"),
                **_stats(clean),
                "repaired": repaired,
                "backup": backup,
            }
        finally:
            conn.close()


@app.post("/api/itto/reset")
def reset_itto() -> dict:
    if not SEED_FILE.exists():
        raise HTTPException(status_code=404, detail="缺少种子数据文件")
    with _LOCK:
        backup = _backup("reset")
        seed = _read_json(SEED_FILE)
        # 还原时一并恢复领域「定义/作用」种子（itto.seed.json 里没有 domains 时）
        if not isinstance(seed.get("domains"), dict):
            dseed = _load_domains_seed()
            if dseed:
                seed["domains"] = dseed
        clean, _ = normalize(seed)
        conn = _connect()
        try:
            with conn:
                rev = _rev(conn) + 1
                _write_dataset(conn, clean)
                _set_meta(conn, "updated_at", _now())
                _set_meta(conn, "rev", str(rev))
            return {"ok": True, "rev": rev, "updated_at": _get_meta(conn, "updated_at"),
                    **_stats(clean), "backup": backup}
        finally:
            conn.close()


@app.get("/api/itto/export")
def export_itto() -> FileResponse:
    conn = _connect()
    try:
        ds = _read_dataset(conn)
    finally:
        conn.close()
    _write_json(EXPORT_FILE, ds)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return FileResponse(EXPORT_FILE, media_type="application/json",
                        filename=f"ITTO数据-{stamp}.json")


@app.get("/api/itto/backups")
def list_backups(limit: int = Query(20, ge=1, le=100)) -> dict:
    _ensure_dirs()
    items = []
    for f in sorted(BACKUP_DIR.glob("itto-*.db"), reverse=True)[:limit]:
        items.append({"name": f.name, "size": f.stat().st_size,
                      "mtime": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    return {"items": items}


@app.get("/api/itto/stats")
def dataset_stats() -> dict:
    conn = _connect()
    try:
        ds = _read_dataset(conn)
    finally:
        conn.close()
    procs = ds["procs"]
    edges = ds["edges"]
    by_phase: Dict[str, int] = {}
    for p in procs.values():
        by_phase[p.get("phase", "?")] = by_phase.get(p.get("phase", "?"), 0) + 1
    kinds: Dict[str, int] = {}
    for e in edges:
        k = e[3] if len(e) > 3 else "main"
        kinds[k] = kinds.get(k, 0) + 1
    return {"procs": len(procs), "edges": len(edges), "byPhase": by_phase, "byKind": kinds}


# --------------------------------------------------------------------------
# 生产模式托管前端（npm run build 输出到 backend/static）
# --------------------------------------------------------------------------
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="spa")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)