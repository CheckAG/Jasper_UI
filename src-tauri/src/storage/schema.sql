-- JASPER SQLite schema
-- All BLOBs are Float32Array stored as raw little-endian bytes.

CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT    PRIMARY KEY,
    name             TEXT    NOT NULL,
    operator         TEXT,
    device           TEXT,
    method_id        TEXT,
    created_at       INTEGER NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'active',
    signed_at        INTEGER,
    signed_by        TEXT,
    signature_hash   TEXT,
    params_json      TEXT,
    calibration_json TEXT,
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS captures (
    id          TEXT    PRIMARY KEY,
    session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    label       TEXT,
    timestamp   INTEGER NOT NULL,
    tag         TEXT    DEFAULT '',
    params_json TEXT    NOT NULL,
    xs          BLOB    NOT NULL,
    ys          BLOB    NOT NULL,
    color       TEXT,
    position    INTEGER
);

CREATE TABLE IF NOT EXISTS pipeline_nodes (
    id          TEXT    PRIMARY KEY,
    session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    name        TEXT,
    code        TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    params_json TEXT,
    position    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS methods (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    params_json   TEXT,
    pipeline_json TEXT,
    created_at    INTEGER,
    created_by    TEXT
);

CREATE TABLE IF NOT EXISTS models (
    id                 TEXT    PRIMARY KEY,
    name               TEXT    NOT NULL,
    algorithm          TEXT    NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    file_path          TEXT    NOT NULL,
    created_at         INTEGER NOT NULL,
    created_by         TEXT,
    applies_to_method  TEXT,
    metrics_json       TEXT,
    feature_range_json TEXT
);

CREATE TABLE IF NOT EXISTS audit (
    id         TEXT    PRIMARY KEY,
    session_id TEXT    REFERENCES sessions(id),
    action     TEXT    NOT NULL,
    actor      TEXT    NOT NULL,
    timestamp  INTEGER NOT NULL,
    detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);
CREATE INDEX IF NOT EXISTS idx_captures_ts      ON captures(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_session    ON audit(session_id, timestamp);
