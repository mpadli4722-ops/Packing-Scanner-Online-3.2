-- ==========================================================
-- SUPABASE POSTGRESQL SCHEMA INITIALIZATION
-- Sistem Manajemen Scan Logistik & Presensi
-- ==========================================================

-- 1. Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABEL USERS (Master Data Pengguna)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'Packing',
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL EXPEDISI (Master Data Mitra Ekspedisi)
CREATE TABLE IF NOT EXISTS expedisi (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABEL LAYANAN (Master Data Jenis Layanan Pengiriman)
CREATE TABLE IF NOT EXISTS layanan (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABEL SCANS (Transaksi Scan Barcode/Resi Paket)
CREATE TABLE IF NOT EXISTS scans (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50),
    user_name VARCHAR(255),
    "userId" VARCHAR(50),
    "userName" VARCHAR(255),
    resi VARCHAR(100) UNIQUE NOT NULL,
    waktu VARCHAR(100) NOT NULL,
    layanan VARCHAR(100) NOT NULL,
    expedisi VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABEL LOGIN_HISTORY (Audit Log Masuk/Keluar)
CREATE TABLE IF NOT EXISTS login_history (
    id VARCHAR(50) PRIMARY KEY,
    user_name VARCHAR(255) NOT NULL,
    "userName" VARCHAR(255),
    ip VARCHAR(100),
    browser VARCHAR(255),
    waktu VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABEL ACTIVITY_LOG (Audit Jejak Aktivitas Operasional)
CREATE TABLE IF NOT EXISTS activity_log (
    id VARCHAR(50) PRIMARY KEY,
    user_name VARCHAR(255) NOT NULL,
    "userName" VARCHAR(255),
    waktu VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABEL DELETED_ITEMS (Tracking Deleted Entities for Synchronization)
CREATE TABLE IF NOT EXISTS deleted_items (
    item_type VARCHAR(50) NOT NULL,
    item_id VARCHAR(50) NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (item_type, item_id)
);

-- ==========================================================
-- INDEXING OPTIMIZATION
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_scans_resi_lower ON scans (LOWER(resi));
CREATE INDEX IF NOT EXISTS idx_scans_waktu ON scans (waktu DESC);
CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans (user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_waktu ON login_history (waktu DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_waktu ON activity_log (waktu DESC);

-- ==========================================================
-- ENABLE REALTIME ON SUPABASE (Optional / Recommended)
-- ==========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE scans;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE expedisi;
ALTER PUBLICATION supabase_realtime ADD TABLE layanan;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
ALTER PUBLICATION supabase_realtime ADD TABLE login_history;
