"""Temporary, synthetic, scripted Windows-MCP review of the installed Morrow app.

This is a batch MCP client, not a live autonomous agent or a full test suite.
Its screenshots and machine-readable notes are evidence for human review, not
proof that the app passed every scenario. No real user files or keys are used.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

OUT = Path(os.environ.get("MORROW_QA_OUTPUT", "qa-output")).resolve()
OUT.mkdir(parents=True, exist_ok=True)
TEST_ROOT = Path(os.environ["RUNNER_TEMP"]) / "morrow-040-synthetic-qa"
FIXTURES = TEST_ROOT / "alpha"
FIXTURES.mkdir(parents=True, exist_ok=True)
(FIXTURES / "first.txt").write_text("synthetic aurora one\n", encoding="utf-8")
(FIXTURES / "second.md").write_text("# Synthetic test\naurora two\n", encoding="utf-8")
(FIXTURES / "third.py").write_text("# aurora three\nprint('sample')\n", encoding="utf-8")
SECOND = TEST_ROOT / "beta"
SECOND.mkdir(parents=True, exist_ok=True)
(SECOND / "beta.md").write_text("# Synthetic beta\naurora second root\n", encoding="utf-8")
BETA_BEFORE = (SECOND / "beta.md").read_bytes()
CREATED = SECOND / "created.md"
SAVED = FIXTURES / "mcp-created-note.txt"
SYNTHETIC_TEXT = "Windows MCP candidate synthetic note 0.4.0"
TOOLS = ["App", "Snapshot", "Screenshot", "Click", "Type", "Shortcut", "Clipboard", "DisplayInventory"]
log: dict = {
    "description": "Scripted Windows-MCP test; inspect saved screenshots and trees before drawing conclusions.",
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "windows_mcp_version_requested": "0.8.8",
    "data": "Synthetic local test files only; no AI or external account credentials.",
    "steps": [],
    "observations": [],
}


def flush() -> None:
    (OUT / "observations.json").write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def observe(test: str, status: str, detail: str) -> None:
    entry = {"test": test, "status": status, "detail": detail}
    log["observations"].append(entry)
    print(json.dumps(entry, ensure_ascii=True), flush=True)
    flush()


def extract_text(result) -> str:
    parts = []
    for content in result.content:
        if getattr(content, "type", "") != "text":
            continue
        text = getattr(content, "text", "")
        # FastMCP may serialize Snapshot's one-item list as JSON when vision
        # is off, but return an ordinary text block alongside an image when it
        # is on. Normalize both valid wire representations before parsing UIA.
        try:
            decoded = json.loads(text)
        except (ValueError, TypeError):
            decoded = None
        if isinstance(decoded, list) and all(isinstance(item, str) for item in decoded):
            parts.extend(decoded)
        else:
            parts.append(text)
    return "\n".join(parts)


def find_control(tree: str, needle: str, *, exact: bool = False, kind: str | None = None, reject_close: bool = False):
    """Return fresh UIA-tree coordinates; never reuse them after a layout change."""
    candidates = []
    for line in tree.splitlines():
        match = re.search(r'\((-?\d+),\s*(-?\d+)\)\s+([^\"]+)\"([^\"]*)\"', line)
        if not match:
            continue
        x, y, control, name = int(match[1]), int(match[2]), match[3].strip().lower(), match[4]
        if x < 0 or y < 0:
            continue
        if kind and kind.lower() not in control:
            continue
        if reject_close and name.lower().startswith("close "):
            continue
        if (name.lower() == needle.lower()) if exact else (needle.lower() in name.lower()):
            candidates.append((x, y, control, name, line))
    return candidates[0] if candidates else None


def focused_close(tree: str):
    for line in tree.splitlines():
        if "[focused]" in line.lower() and re.search(r'\"Close (?:welcome\.py|quick-notes\.md)\"', line, re.I):
            return line.strip()
    return None


class Review:
    def __init__(self, session):
        self.session = session
        self.image_count = 0

    async def call(self, name: str, arguments: dict, *, artifact: str | None = None):
        started = time.monotonic()
        result = await self.session.call_tool(name, arguments=arguments)
        text = extract_text(result)
        images = []
        for item in result.content:
            if getattr(item, "type", "") == "image":
                images.append(base64.b64decode(item.data))
        step = {"tool": name, "arguments": arguments, "duration_seconds": round(time.monotonic() - started, 2),
                "is_error": bool(result.is_error), "result_excerpt": text[:900], "image_count": len(images)}
        log["steps"].append(step)
        if artifact:
            (OUT / f"{artifact}.txt").write_text(text, encoding="utf-8")
            for index, image in enumerate(images):
                suffix = "" if index == 0 else f"-{index}"
                (OUT / f"{artifact}{suffix}.png").write_bytes(image)
                self.image_count += 1
        flush()
        print(f"{name} {arguments} -> error={result.is_error}, images={len(images)}, {text[:180]!r}", flush=True)
        if result.is_error:
            raise RuntimeError(f"{name} error: {text[:800]}")
        return text, images

    async def shot(self, label: str):
        await asyncio.sleep(0.7)
        return await self.call("Screenshot", {}, artifact=label)

    async def snap(self, label: str | None = None, *, vision: bool = False):
        text, images = await self.call("Snapshot", {"use_vision": vision, "use_annotation": False}, artifact=label)
        if text.startswith("Error capturing"):
            raise RuntimeError(text)
        return text

    async def key(self, shortcut: str):
        await self.call("Shortcut", {"shortcut": shortcut})
        await asyncio.sleep(0.2)

    async def click_name(self, tree: str, name: str, *, exact: bool = False, kind: str | None = None, reject_close: bool = False):
        target = find_control(tree, name, exact=exact, kind=kind, reject_close=reject_close)
        if not target:
            return False
        await self.call("Click", {"loc": [target[0], target[1]]})
        await asyncio.sleep(0.6)
        return True

    async def text_at(self, target, text: str, *, clear: bool = False, enter: bool = False):
        await self.call("Type", {"loc": [target[0], target[1]], "text": text, "clear": clear, "press_enter": enter})
        await asyncio.sleep(0.6)

    async def paste_focused(self, text: str):
        await self.call("Clipboard", {"mode": "set", "text": text})
        await self.key("ctrl+a")
        await self.key("ctrl+v")


async def keyboard_close(qa: Review):
    # Only synthetic example tabs are touched. Make quick-notes active first;
    # with the sidebar hidden, the inactive welcome close button is in the
    # keyboard order after the header controls. UIA may flatten the nested
    # close button into the tab; the before/after screenshots are decisive.
    tree = await qa.snap()
    if not await qa.click_name(tree, "quick-notes.md", reject_close=True):
        observe("keyboard-tab-close", "not-run", "Could not activate the example Markdown tab via Windows UIA.")
        return
    await qa.key("ctrl+b")
    tree = await qa.snap("02-sidebar-hidden-tree")
    if not await qa.click_name(tree, "File", exact=True):
        observe("keyboard-tab-close", "not-run", "Could not locate the File menu via the captured Windows UIA tree.")
        await qa.key("ctrl+b")
        return
    await qa.key("esc")
    for _ in range(8):
        await qa.key("tab")
    tree = await qa.snap("03-keyboard-focus-tree", vision=True)
    await qa.shot("03-keyboard-focus")
    await qa.key("enter")
    await qa.snap("04-after-keyboard-close-tree", vision=True)
    await qa.shot("04-after-keyboard-close")
    observe("keyboard-tab-close", "captured", "Pressed eight Tabs from File with the sidebar hidden and quick-notes active, then Enter. Inspect focus outline and before/after tab count manually; no automated assertion.")
    await qa.key("esc")
    await qa.key("ctrl+b")


async def preview_and_settings(qa: Review):
    tree = await qa.snap()
    if await qa.click_name(tree, "quick-notes.md", reject_close=True):
        tree = await qa.snap()
        if await qa.click_name(tree, "Toggle Markdown preview", exact=True):
            await qa.snap("05-markdown-preview-tree", vision=True)
            await qa.shot("05-markdown-preview")
            observe("markdown-preview", "captured", "Opened example Markdown and requested preview; inspect screenshots.")
        else:
            observe("markdown-preview", "not-run", "Preview control not found in the Windows UIA tree.")
    else:
        observe("markdown-preview", "not-run", "Example Markdown tab not found in the Windows UIA tree.")
    tree = await qa.snap()
    if await qa.click_name(tree, "Settings", exact=True):
        await qa.snap("06-settings-tree", vision=True)
        await qa.shot("06-settings")
        observe("settings", "captured", "Opened Settings; inspect UIA names and screenshot manually.")
        await qa.key("esc")
    else:
        observe("settings", "not-run", "Settings control not found in the Windows UIA tree.")
    tree = await qa.snap()
    if await qa.click_name(tree, "AI suggestions settings", exact=True):
        await qa.snap("07-ai-panel-tree", vision=True)
        await qa.shot("07-ai-panel")
        observe("ai-panel", "captured", "Opened AI panel only; no model, endpoint or credentials were used.")
        await qa.key("esc")
        tree = await qa.snap()
        if find_control(tree, "Close AI", exact=False):
            await qa.click_name(tree, "Close AI")
    else:
        observe("ai-panel", "not-run", "AI settings button not found in the Windows UIA tree.")


async def create_and_save(qa: Review):
    await qa.key("ctrl+n")
    tree = await qa.snap("08-new-note-tree")
    target = find_control(tree, "Document text", exact=True)
    if not target:
        observe("new-and-save", "not-run", "The editor's Document text control was not located in Windows UIA.")
        await qa.shot("08-new-note")
        return
    await qa.text_at(target, SYNTHETIC_TEXT)
    await qa.shot("09-synthetic-note-typed")
    await qa.key("ctrl+s")
    await asyncio.sleep(1)
    tree = await qa.snap("10-save-dialog-tree", vision=True)
    await qa.shot("10-save-dialog")
    if not any(part in tree.lower() for part in ["save file as", "save as", "file name"]):
        observe("new-and-save", "inconclusive", "No recognizable native Save As dialog in the UIA tree; no path was entered.")
        return
    field = find_control(tree, "File name", kind="edit")
    if field:
        await qa.text_at(field, str(SAVED), clear=True)
    else:
        await qa.key("alt+n")
        await qa.paste_focused(str(SAVED))
    # Capture the entered filename before submitting, and capture any short-
    # lived toast immediately after Enter. Do not interpret a missing file as
    # an application defect unless this evidence shows what actually happened.
    await qa.shot("10b-save-filename-entered")
    await qa.key("enter")
    await qa.shot("10c-immediately-after-save")
    await asyncio.sleep(1)
    await qa.snap("11-after-save-tree", vision=True)
    await qa.shot("11-after-save")
    if SAVED.is_file():
        actual = SAVED.read_bytes()
        passed = actual == SYNTHETIC_TEXT.encode("utf-8")
        observe("new-and-save", "pass" if passed else "mismatch", f"Saved synthetic file exact byte match: {passed}; length={len(actual)}.")
        if passed:
            tree = await qa.snap(); editor = find_control(tree, "Document text", exact=True)
            if editor:
                await qa.text_at(editor, " local draft")
                SAVED.write_bytes(b"external disk edit")
                await qa.key("ctrl+s"); await asyncio.sleep(1)
                tree = await qa.snap("11b-external-conflict-tree", vision=True); await qa.shot("11b-external-conflict")
                untouched = SAVED.read_bytes() == b"external disk edit"
                shown = bool(find_control(tree, "Save a copy", exact=True) and find_control(tree, "Overwrite", exact=True))
                observe("external-save-conflict", "pass" if untouched and shown else "inconclusive", f"External bytes preserved: {untouched}; conflict actions shown: {shown}.")
                await qa.key("esc")
    else:
        observe("new-and-save", "inconclusive", "Expected synthetic file was not found; inspect Save As evidence.")
        await qa.key("esc")


async def folder_and_narrow(qa: Review):
    tree = await qa.snap()
    if not await qa.click_name(tree, "Open a folder", exact=False):
        observe("folder", "not-run", "Open folder button was not found via Windows UIA.")
        return
    tree = await qa.snap("12-folder-consent-tree", vision=True)
    await qa.shot("12-folder-consent")
    if not await qa.click_name(tree, "Choose folder", exact=True):
        observe("folder", "not-run", "Folder access confirmation button was not found.")
        await qa.key("esc")
        return
    await asyncio.sleep(1)
    tree = await qa.snap("13-folder-picker-tree", vision=True)
    await qa.shot("13-folder-picker")
    if not any(part in tree.lower() for part in ["open a folder in morrow", "select folder"]):
        observe("folder", "inconclusive", "Did not recognize native folder picker; no path was entered.")
        await qa.key("esc")
        return
    await qa.key("alt+d")
    await qa.paste_focused(str(FIXTURES))
    await qa.key("enter")
    await asyncio.sleep(1)
    tree = await qa.snap("14-folder-location-tree", vision=True)
    if not await qa.click_name(tree, "Select Folder", exact=True):
        observe("folder", "inconclusive", "Could not find Select Folder in the native picker.")
        await qa.shot("14-folder-location")
        await qa.key("esc")
        return
    await asyncio.sleep(1)
    tree = await qa.snap("15-folder-open-tree", vision=True)
    await qa.shot("15-folder-open")
    # The UIA tree may split a heading into individual words; look for a
    # known synthetic fixture's actionable entry, not the whole heading text.
    if not find_control(tree, "Open first.txt", exact=True):
        observe("folder", "inconclusive", "The expected first synthetic file was absent from the UIA tree; inspect screenshot.")
        return
    observe("folder", "captured", "Selected the synthetic folder and found its first.txt entry in Windows UIA.")
    await qa.key("ctrl+shift+f")
    tree = await qa.snap("16-folder-search-dialog-tree", vision=True)
    query = find_control(tree, "Folder search query")
    if query:
        await qa.text_at(query, "aurora", clear=True)
        tree = await qa.snap()
        if await qa.click_name(tree, "Search folder", exact=True):
            await asyncio.sleep(1)
            await qa.snap("16-folder-search-results-tree", vision=True)
            await qa.shot("16-folder-search-results")
            observe("folder-search", "captured", "Searched the synthetic folder for aurora; inspect result count and screenshot.")
        else:
            observe("folder-search", "inconclusive", "Search button was not found after entering the query.")
    else:
        observe("folder-search", "not-run", "Folder search query control was not found in Windows UIA.")
    await qa.key("esc")
    await add_second_root_and_create(qa)
    await arena_panel(qa)
    for _ in range(3):
        await qa.key("ctrl+n")
    await qa.call("App", {"mode": "resize", "name": "Morrow", "window_loc": [0, 0], "window_size": [720, 500]})
    await asyncio.sleep(1)
    tree = await qa.snap("17-small-window-tree", vision=True)
    await qa.shot("17-small-window")
    settings = find_control(tree, "Settings", exact=True, kind="button")
    in_bounds = bool(settings and settings[0] < 690)
    observe("small-window", "pass" if in_bounds else "inconclusive", f"At requested 720x500 outer size, Settings center x is {settings[0] if settings else 'missing'} (must be below 690); inspect screenshot.")
    if settings and in_bounds:
        await qa.click_name(tree, "Settings", exact=True, kind="button")
        tree = await qa.snap("17b-small-settings-tree", vision=True); await qa.shot("17b-small-settings")
        shown = bool(find_control(tree, "Close settings", exact=True))
        observe("small-settings", "pass" if shown else "inconclusive", f"Settings opened from the small window: {shown}.")
        await qa.key("esc")



async def add_second_root_and_create(qa: Review):
    tree = await qa.snap()
    if not await qa.click_name(tree, "Add folder to workspace", exact=True):
        observe("second-root", "not-run", "Add-folder control was not found."); return
    tree = await qa.snap("18-add-root-consent-tree", vision=True)
    if not await qa.click_name(tree, "Choose folder", exact=True):
        observe("second-root", "not-run", "Add-folder consent action was not found."); return
    await asyncio.sleep(1)
    tree = await qa.snap("19-add-root-picker-tree", vision=True)
    if not any(word in tree.lower() for word in ["open a folder in morrow", "select folder"]):
        observe("second-root", "inconclusive", "Native folder picker was not recognized."); await qa.key("esc"); return
    await qa.key("alt+d"); await qa.paste_focused(str(SECOND)); await qa.key("enter"); await asyncio.sleep(1)
    tree = await qa.snap("20-add-root-location-tree")
    if not await qa.click_name(tree, "Select Folder", exact=True):
        observe("second-root", "inconclusive", "Select Folder was not found."); await qa.key("esc"); return
    await asyncio.sleep(1); tree = await qa.snap("21-two-roots-tree", vision=True); await qa.shot("21-two-roots")
    both = "first.txt" in tree.lower() and "beta.md" in tree.lower()
    observe("second-root", "pass" if both else "inconclusive", f"Both synthetic roots show their files in UIA: {both}.")
    await qa.key("ctrl+shift+f"); tree = await qa.snap("22-multi-search-dialog-tree", vision=True)
    query = find_control(tree, "Folder search query")
    if query:
        await qa.text_at(query, "aurora", clear=True); tree = await qa.snap()
        if await qa.click_name(tree, "Search folder", exact=True):
            await asyncio.sleep(1); tree = await qa.snap("23-multi-search-results-tree", vision=True); await qa.shot("23-multi-search-results")
            both = "first.txt" in tree.lower() and "beta.md" in tree.lower()
            observe("multi-root-search", "pass" if both else "inconclusive", f"Search displays names from each root: {both}.")
    await qa.key("esc")
    tree = await qa.snap()
    if not await qa.click_name(tree, "Create a file or folder in beta", exact=True):
        observe("native-create", "not-run", "Create action for beta root not found."); return
    tree = await qa.snap("24-create-dialog-tree", vision=True)
    field = find_control(tree, "Name", exact=True, kind="edit")
    if not field:
        observe("native-create", "inconclusive", "New-item name field was not found."); await qa.shot("24-create-dialog"); return
    await qa.text_at(field, "created.md", clear=True)
    tree = await qa.snap()
    if not await qa.click_name(tree, "Create", exact=True, kind="button"):
        observe("native-create", "inconclusive", "New-item Create button was not found."); return
    await asyncio.sleep(1); tree = await qa.snap("25-created-tree", vision=True); await qa.shot("25-created")
    if not CREATED.is_file() or CREATED.read_bytes() != b"":
        observe("native-create", "fail", "Expected empty file was not created."); return
    editor = find_control(tree, "Document text", exact=True)
    if not editor:
        observe("native-create", "inconclusive", "Empty file exists but editor was not found."); return
    await qa.text_at(editor, "Created on Windows"); await qa.key("ctrl+s"); await asyncio.sleep(1)
    ok = CREATED.read_bytes() == b"Created on Windows"
    observe("native-create", "pass" if ok else "fail", f"Created file saved with exact bytes: {ok}.")
    tree = await qa.snap()
    if await qa.click_name(tree, "Create a file or folder in beta", exact=True):
        tree = await qa.snap(); field = find_control(tree, "Name", exact=True, kind="edit")
        if field:
            await qa.text_at(field, "beta.md", clear=True); tree = await qa.snap()
            if await qa.click_name(tree, "Create", exact=True, kind="button"):
                await asyncio.sleep(1); tree = await qa.snap("26-collision-tree", vision=True); await qa.shot("26-collision")
                protected = (SECOND / "beta.md").read_bytes() == BETA_BEFORE
                shown = 'word "already"' in tree.lower() and 'word "exists"' in tree.lower()
                observe("create-collision", "pass" if protected and shown else "inconclusive", f"Original preserved: {protected}; collision reported in UIA: {shown}.")
                await qa.key("esc")

async def arena_panel(qa: Review):
    # Select only a synthetic editor buffer; never open Arena or transmit text.
    tree = await qa.snap()
    editor = find_control(tree, "Document text", exact=True)
    if editor:
        await qa.call("Click", {"loc": [editor[0], editor[1]]})
        await qa.key("ctrl+a")
    tree = await qa.snap()
    if await qa.click_name(tree, "Open Arena assistant", exact=True):
        await qa.snap("27-arena-panel-tree", vision=True); await qa.shot("27-arena-panel")
        observe("arena-panel", "captured", "Opened browser-first Arena panel only; no API key or website request was used.")
        # Keyboard focus scrolls the dialog naturally on the small hosted display.
        for _ in range(5):
            await qa.key("tab")
        tree = await qa.snap("28-arena-capture-tree", vision=True)
        if await qa.click_name(tree, "Capture selection", exact=True, kind="button"):
            tree = await qa.snap("29-arena-prepared-tree", vision=True); await qa.shot("29-arena-prepared")
            ready = "characters" in tree.lower() and "prepared" in tree.lower()
            observe("arena-capture", "pass" if ready else "inconclusive", f"Captured a synthetic selection for review: {ready}; inspect screenshot and tree.")
        else:
            observe("arena-capture", "inconclusive", "Capture selection control not found in UIA; inspect screenshots.")
        await qa.key("esc")
    else:
        observe("arena-panel", "not-run", "Arena button not found.")

def capture_geometry():
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    class RECT(ctypes.Structure):
        _fields_ = [(name, wintypes.LONG) for name in ("left", "top", "right", "bottom")]
    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", wintypes.DWORD)]
    handles = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _):
        title = ctypes.create_unicode_buffer(512); user32.GetWindowTextW(hwnd, title, len(title))
        if user32.IsWindowVisible(hwnd) and title.value.endswith("— Morrow"): handles.append((hwnd, title.value))
        return True
    user32.EnumWindows(callback_type(callback), 0)
    if not handles:
        observe("initial-geometry", "inconclusive", "Could not identify a visible Morrow HWND."); return
    hwnd, title = handles[0]; rect = RECT(); info = MONITORINFO(); info.cbSize = ctypes.sizeof(info)
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HANDLE
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
    monitor = user32.MonitorFromWindow(hwnd, 2)
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)) or not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
        observe("initial-geometry", "inconclusive", "Win32 geometry query failed."); return
    d = lambda r: {"left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom}
    fit = rect.left >= info.rcWork.left and rect.top >= info.rcWork.top and rect.right <= info.rcWork.right and rect.bottom <= info.rcWork.bottom
    detail = {"title": title, "window": d(rect), "work_area": d(info.rcWork), "fully_in_work_area": fit}
    (OUT / "initial-geometry.json").write_text(json.dumps(detail, indent=2), encoding="utf-8")
    observe("initial-geometry", "pass" if fit else "fail", json.dumps(detail))

async def run():
    # Give the MCP subprocess only ordinary Windows runtime variables, not the
    # GitHub Actions context or credentials. The installed app inherits these.
    names = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH", "PATH", "COMSPEC", "PROGRAMFILES", "PROGRAMFILES(X86)", "ALLUSERSPROFILE", "PUBLIC", "USERNAME", "USERDOMAIN", "PATHEXT", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS", "SESSIONNAME"}
    env = {k: v for k, v in os.environ.items() if k.upper() in names}
    env.update({"ANONYMIZED_TELEMETRY": "false", "WINDOWS_MCP_DISABLE_FLASH": "1", "PYTHONIOENCODING": "utf-8",
                "WINDOWS_MCP_EXCLUDE_PROCESSES": "hosted-compute-agent.exe,conhost.exe"})
    params = StdioServerParameters(command=sys.executable, args=["-m", "windows_mcp", "serve", "--tools", ",".join(TOOLS)], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write, read_timeout_seconds=120.0) as session:
            init = await session.initialize()
            available = sorted(t.name for t in (await session.list_tools()).tools)
            log["mcp_server"] = str(init.server_info)
            log["available_tools"] = available
            flush()
            # Windows-MCP always exposes its read-only ControlStatus tool even
            # with an explicit allowlist; no shell/filesystem/registry tools.
            if set(available) != set(TOOLS) | {"ControlStatus"}:
                raise RuntimeError(f"Unexpected MCP tool set: {available}")
            qa = Review(session)
            await qa.call("DisplayInventory", {}, artifact="00-display")
            await qa.call("App", {"mode": "launch_executable", "executable": os.environ["MORROW_QA_EXE"]})
            await asyncio.sleep(12)
            await qa.shot("01-windows-initial")
            initial = await qa.snap("01-windows-initial-tree", vision=True)
            if "morrow" not in initial.lower():
                observe("launch", "inconclusive", "Morrow did not appear in the Windows-MCP Snapshot; inspect screenshot and tree.")
                raise RuntimeError("Could not verify Morrow window before sending input")
            observe("launch", "captured", "Windows-MCP Snapshot identified Morrow after launching the installed executable.")
            try:
                capture_geometry()
            except Exception as exc:
                observe("initial-geometry", "inconclusive", f"Could not query Win32 work area: {exc}")
            try:
                await qa.call("App", {"mode": "switch", "name": "Morrow"})
                await qa.call("App", {"mode": "resize", "name": "Morrow", "window_loc": [0, 0], "window_size": [960, 680]})
            except Exception as exc:
                observe("window-setup", "inconclusive", f"Could not switch/resize by MCP: {exc}")
            phases = [("keyboard", keyboard_close), ("preview-settings-ai", preview_and_settings), ("create-save", create_and_save), ("folder-narrow", folder_and_narrow)]
            if os.environ.get("MORROW_QA_TARGETED") == "1":
                phases = [("create-save", create_and_save), ("folder-narrow", folder_and_narrow)]
            log["selected_phases"] = [label for label, _ in phases]
            flush()
            for label, phase in phases:
                try:
                    await phase(qa)
                except Exception as exc:
                    observe(label, "error", f"{type(exc).__name__}: {exc}")
                    (OUT / f"error-{label}.txt").write_text(traceback.format_exc(), encoding="utf-8")
                    try:
                        await qa.shot(f"error-{label}")
                    except Exception:
                        pass
            observe("harness", "complete", f"MCP script finished; saved {qa.image_count} image(s). Outcomes require evidence review.")
            save_result = next((entry for entry in log["observations"] if entry["test"] == "new-and-save"), None)
            if not save_result or save_result["status"] != "pass":
                raise RuntimeError("The installed candidate did not prove the critical new-file save case.")


if __name__ == "__main__":
    flush()
    try:
        asyncio.run(run())
    except BaseException as exc:
        observe("harness", "failed", f"{type(exc).__name__}: {exc}")
        (OUT / "fatal-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        raise
