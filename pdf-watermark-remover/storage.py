"""Where a session's PDF and findings live.

Locally that is a temp directory. On Vercel it cannot be: a function is frozen
the moment it answers, /tmp is not shared between instances, and a later request
for the same session may land somewhere that has never seen the file. Everything
a session needs therefore lives in object storage under its token, and each
request loads what it needs.

Two backends, one interface:

    LocalStorage      a directory on disk. Used for `python app.py`.
    SupabaseStorage   the bucket this repo already uses for image crops.

Which one is in force is decided once, by whether the Supabase variables are
set -- there is no mode flag to get wrong.

The 4.5 MB body limit on Vercel Functions is the reason `signed_put` and
`signed_get` exist: a 16 MB PDF can never travel through the function itself, so
the browser talks to storage directly and the function only ever handles the
short-lived URLs and the findings.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Protocol

PREFIX = "excise"
SESSION_TTL = 6 * 3600
_HTTP_TIMEOUT = 30


class StorageError(RuntimeError):
    """Storage refused or could not be reached. Always carries what was tried."""


class Storage(Protocol):
    kind: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete_prefix(self, key_prefix: str) -> None: ...
    def signed_put(self, key: str, content_type: str, seconds: int) -> dict: ...
    def signed_get(self, key: str, seconds: int) -> str: ...


# ---------------------------------------------------------------------------
# local disk — what `python app.py` uses
# ---------------------------------------------------------------------------


class LocalStorage:
    kind = "local"

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(tempfile.gettempdir()) / "excise_sessions"
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # keys are built from a hex token and fixed names, but never trust that
        safe = Path(key.replace("\\", "/"))
        if safe.is_absolute() or ".." in safe.parts:
            raise StorageError(f"refusing suspicious key: {key!r}")
        return self.root / safe

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        p = self._path(key)
        if not p.exists():
            raise StorageError(f"no object at {key}")
        return p.read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete_prefix(self, key_prefix: str) -> None:
        shutil.rmtree(self._path(key_prefix), ignore_errors=True)

    def signed_put(self, key: str, content_type: str, seconds: int = 900) -> dict:
        # nothing to sign on a local disk: the browser posts to the app as before
        return {"method": "local", "url": None, "key": key}

    def signed_get(self, key: str, seconds: int = 900) -> str:
        return ""  # the app streams the file itself in local mode

    def sweep(self, ttl: int = SESSION_TTL) -> None:
        cutoff = time.time() - ttl
        if not self.root.exists():
            return
        for d in self.root.glob(f"{PREFIX}/*"):
            try:
                if d.is_dir() and d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Supabase Storage — what the deployment uses
# ---------------------------------------------------------------------------


def _request(method: str, url: str, key: str, body: bytes | None = None,
             content_type: str | None = None) -> bytes:
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("apikey", key)
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise StorageError(f"{method} {urllib.parse.urlparse(url).path} -> {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise StorageError(f"{method} {url}: {e.reason}") from e


class SupabaseStorage:
    """Talks to the Storage REST API directly.

    No SDK: the whole surface used here is four calls, and every megabyte of
    dependency counts against the function bundle.
    """

    kind = "supabase"

    def __init__(self, url: str, service_key: str, bucket: str) -> None:
        self.base = url.rstrip("/")
        self.key = service_key
        self.bucket = bucket

    def _object_url(self, key: str) -> str:
        return f"{self.base}/storage/v1/object/{self.bucket}/{urllib.parse.quote(key)}"

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        # x-upsert so re-analysing a session overwrites rather than 409s
        req = urllib.request.Request(self._object_url(key), data=data, method="POST")
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("apikey", self.key)
        req.add_header("Content-Type", content_type)
        req.add_header("x-upsert", "true")
        try:
            with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
                r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise StorageError(f"upload {key} -> {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise StorageError(f"upload {key}: {e.reason}") from e

    def get(self, key: str) -> bytes:
        return _request("GET", self._object_url(key), self.key)

    def exists(self, key: str) -> bool:
        try:
            _request("GET", f"{self.base}/storage/v1/object/info/{self.bucket}/"
                            f"{urllib.parse.quote(key)}", self.key)
            return True
        except StorageError:
            return False

    def delete_prefix(self, key_prefix: str) -> None:
        body = json.dumps({"prefixes": [key_prefix]}).encode()
        try:
            _request("DELETE", f"{self.base}/storage/v1/object/{self.bucket}",
                     self.key, body, "application/json")
        except StorageError:
            pass  # a failed cleanup must never fail the request that triggered it

    def signed_put(self, key: str, content_type: str, seconds: int = 900) -> dict:
        """A URL the browser can PUT the PDF to, without it passing through us."""
        raw = _request(
            "POST",
            f"{self.base}/storage/v1/object/upload/sign/{self.bucket}/{urllib.parse.quote(key)}",
            self.key, b"{}", "application/json",
        )
        signed = json.loads(raw or b"{}").get("url", "")
        if not signed:
            raise StorageError(f"no signed upload URL came back for {key}")
        return {"method": "PUT", "url": f"{self.base}/storage/v1{signed}", "key": key}

    def signed_get(self, key: str, seconds: int = 900) -> str:
        raw = _request(
            "POST",
            f"{self.base}/storage/v1/object/sign/{self.bucket}/{urllib.parse.quote(key)}",
            self.key, json.dumps({"expiresIn": seconds}).encode(), "application/json",
        )
        signed = json.loads(raw or b"{}").get("signedURL", "")
        if not signed:
            raise StorageError(f"no signed download URL came back for {key}")
        return f"{self.base}/storage/v1{signed}"


# ---------------------------------------------------------------------------
# selection + session helpers
# ---------------------------------------------------------------------------


def make_storage() -> Storage:
    """Supabase when it is configured, local disk otherwise. No mode flag."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    bucket = os.environ.get("SUPABASE_BUCKET", "").strip()
    if url and key and bucket:
        return SupabaseStorage(url, key, bucket)
    if os.environ.get("VERCEL"):
        # Fail loudly. Falling back to /tmp on serverless would appear to work
        # for one request and then lose the session on the next.
        raise StorageError(
            "SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_BUCKET must all be set "
            "when running on Vercel: a function's filesystem does not outlive the request."
        )
    return LocalStorage()


def session_key(token: str, name: str) -> str:
    if not token.isalnum():
        raise StorageError("bad session token")
    return f"{PREFIX}/{token}/{name}"


class SessionStore:
    """The findings for a session, small enough to travel as JSON."""

    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def save(self, token: str, data: dict) -> None:
        self.storage.put(session_key(token, "session.json"),
                         json.dumps(data).encode("utf-8"), "application/json")

    def load(self, token: str) -> dict | None:
        try:
            raw = self.storage.get(session_key(token, "session.json"))
        except StorageError:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def drop(self, token: str) -> None:
        self.storage.delete_prefix(f"{PREFIX}/{token}")
