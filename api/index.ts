import { Request, Response, NextFunction } from "express";
import express from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import path from "path";
import os from "os";

const app = express();

// Comprehensive Debug Request Logger for Forensic Auditing
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    let dbMode = "Supabase PostgreSQL";
    try {
      dbMode = getPool().mode;
    } catch {
      dbMode = "Error";
    }
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    const hostname = os.hostname();
    const deployment = process.env.VERCEL_URL || process.env.VERCEL_REGION || process.env.K_REVISION || "CloudRun/Container";

    console.log(`[DEBUG LOG]
Endpoint:   ${req.method} ${req.originalUrl || req.path}
Status:     ${res.statusCode} (${duration}ms)
Database:   ${dbMode}
Host:       ${hostname}
Process ID: ${pid}
Deployment: ${deployment}
Timestamp:  ${timestamp}`);
  });
  next();
});

// Enable JSON bodies and CORS + Anti-caching headers
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.header("Pragma", "no-cache");
  res.header("Expires", "0");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Interfaces
export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  role: "Administrator" | "Supervisor" | "Packing";
  status: "Active" | "Inactive";
}

export interface Expedisi {
  id: string;
  name: string;
  status: "Active" | "Inactive";
}

export interface Layanan {
  id: string;
  name: string;
  status: "Active" | "Inactive";
}

export interface ScanRecord {
  id: string;
  userId: string;
  userName: string;
  resi: string;
  waktu: string;
  layanan: string;
  expedisi: string;
}

export interface LoginHistory {
  id: string;
  userName: string;
  ip: string;
  browser: string;
  waktu: string;
  action: "Login" | "Logout";
}

export interface ActivityLog {
  id: string;
  userName: string;
  waktu: string;
  action: string;
}

export interface DbSchema {
  users: User[];
  expedisi: Expedisi[];
  layanan: Layanan[];
  scans: ScanRecord[];
  loginHistory: LoginHistory[];
  activityLog: ActivityLog[];
  deletedUsers?: string[];
  deletedExpedisi?: string[];
  deletedLayanan?: string[];
  deletedScans?: string[];
}

// ---------------- 100% SUPABASE POSTGRESQL AUTHORITATIVE DATABASE ENGINE ----------------
export interface DbDriver {
  query: (sql: string, params?: any[]) => Promise<[any, any]>;
  mode: "Supabase PostgreSQL";
  isHealthy: () => boolean;
  supabaseClient?: SupabaseClient | null;
}

interface DbQueryErrorLog {
  timestamp: string;
  sql: string;
  params?: any;
  error: string;
}

const recentQueryErrors: DbQueryErrorLog[] = [];

export function recordQueryError(sql: string, params: any, err: any) {
  const errorMessage = err?.message || String(err);
  const info = getWIBDateTimeString();
  recentQueryErrors.unshift({
    timestamp: info.full,
    sql,
    params,
    error: errorMessage,
  });
  if (recentQueryErrors.length > 25) {
    recentQueryErrors.pop();
  }
}

// ---------------- SUPABASE POSTGRESQL DRIVER ----------------
let supabaseClientInstance: SupabaseClient | null = null;
let globalDbDriver: DbDriver | null = null;

// Helper to normalize rows returned from Supabase
function normalizeRow(row: any): any {
  if (!row || typeof row !== "object") return row;
  const copy = { ...row };
  // Normalize userId / user_id
  if (copy.user_id && !copy.userId) copy.userId = copy.user_id;
  if (copy.userId && !copy.user_id) copy.user_id = copy.userId;
  // Normalize userName / user_name
  if (copy.user_name && !copy.userName) copy.userName = copy.user_name;
  if (copy.userName && !copy.user_name) copy.user_name = copy.userName;
  return copy;
}

class SupabaseDriver implements DbDriver {
  public mode: "Supabase PostgreSQL" = "Supabase PostgreSQL";
  public supabaseClient: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.supabaseClient = client;
  }

  public isHealthy(): boolean {
    return !!this.supabaseClient;
  }

  public async query(sql: string, params: any[] = []): Promise<[any, any]> {
    const cleanSql = sql.trim();

    // 1. Health check ping
    if (cleanSql === "SELECT 1") {
      const { error } = await this.supabaseClient.from("users").select("id").limit(1);
      if (error) {
        console.error(`[DB PING ERROR] users health check failed: ${error.message}`);
        throw new Error(`[Supabase Ping Error] ${error.message}`);
      }
      return [[{ 1: 1 }], []];
    }

    const lowerSql = cleanSql.toLowerCase();

    // 2. SELECT COUNT(*)
    if (lowerSql.startsWith("select count(*)")) {
      const tableMatch = lowerSql.match(/from\s+([a-z_]+)/i);
      const tableName = tableMatch ? tableMatch[1].toLowerCase() : "users";
      
      let query = this.supabaseClient.from(tableName).select("*", { count: "exact", head: true });
      
      if (lowerSql.includes("where waktu like ?") && params[0]) {
        const prefix = String(params[0]).replace(/%/g, "");
        query = query.ilike("waktu", `${prefix}%`);
      } else if (lowerSql.includes("where id = ?") && params[0]) {
        query = query.eq("id", params[0]);
      }

      const { count, error } = await query;
      if (error) {
        console.error(`[DB ERROR] table=${tableName} action=COUNT error=${error.message}`);
        throw new Error(`[Supabase Error] ${error.message}`);
      }
      const finalCount = count ?? 0;
      console.log(`[DB READ] table=${tableName} count=${finalCount} status=SUCCESS`);
      return [[{ count: finalCount, c: finalCount, "COUNT(*)": finalCount }], []];
    }

    // 3. SELECT 1 FROM table WHERE ...
    if (lowerSql.startsWith("select 1 from")) {
      const tableMatch = lowerSql.match(/from\s+([a-z_]+)/i);
      const tableName = tableMatch ? tableMatch[1].toLowerCase() : "users";

      let query = this.supabaseClient.from(tableName).select("id").limit(1);
      
      if (lowerSql.includes("lower(username) = lower(?) or lower(email) = lower(?)") && params.length >= 2) {
        query = this.supabaseClient.from(tableName)
          .select("id")
          .or(`username.ilike.${params[0]},email.ilike.${params[1]}`)
          .limit(1);
      } else if (lowerSql.includes("where id = ?") && params[0]) {
        query = query.eq("id", params[0]);
      } else if (lowerSql.includes("lower(resi) = lower(?)") && params[0]) {
        query = query.ilike("resi", params[0]);
      } else if (lowerSql.includes("lower(username) = lower(?)") && params[0]) {
        query = query.ilike("username", params[0]);
      }

      const { data, error } = await query;
      if (error) {
        console.error(`[DB ERROR] table=${tableName} action=SELECT_1 error=${error.message}`);
        throw new Error(`[Supabase Error] ${error.message}`);
      }
      console.log(`[DB READ] table=${tableName} exists=${(data && data.length > 0)} status=SUCCESS`);
      return [data || [], []];
    }

    // 4. SELECT ... FROM table
    if (lowerSql.startsWith("select")) {
      const tableMatch = lowerSql.match(/from\s+([a-z_]+)/i);
      const tableName = tableMatch ? tableMatch[1].toLowerCase() : "users";

      let query = this.supabaseClient.from(tableName).select("*");

      // Handle WHERE
      if (lowerSql.includes("where id = ?") && params[0]) {
        query = query.eq("id", params[0]).limit(1);
      } else if (lowerSql.includes("where lower(username) = lower(?) or lower(email) = lower(?)") && params.length >= 2) {
        query = query.or(`username.ilike.${params[0]},email.ilike.${params[1]}`).limit(1);
      } else if (lowerSql.includes("where lower(id) = lower(?) or lower(username) = lower(?) or lower(name) = lower(?)") && params.length >= 3) {
        query = query.or(`id.ilike.${params[0]},username.ilike.${params[1]},name.ilike.${params[2]}`).limit(1);
      } else if (lowerSql.includes("where item_type = 'user'")) {
        query = query.eq("item_type", "user");
      } else if (lowerSql.includes("where item_type = 'expedisi'")) {
        query = query.eq("item_type", "expedisi");
      } else if (lowerSql.includes("where item_type = 'layanan'")) {
        query = query.eq("item_type", "layanan");
      } else if (lowerSql.includes("where item_type = 'scan'")) {
        query = query.eq("item_type", "scan");
      } else if (lowerSql.includes("where waktu like ?") && params[0]) {
        const prefix = String(params[0]).replace(/%/g, "");
        query = query.ilike("waktu", `${prefix}%`);
      }

      // Handle ORDER BY
      if (lowerSql.includes("order by waktu desc")) {
        query = query.order("waktu", { ascending: false });
      } else if (lowerSql.includes("order by waktu asc")) {
        query = query.order("waktu", { ascending: true });
      } else if (lowerSql.includes("order by created_at desc")) {
        query = query.order("created_at", { ascending: false });
      }

      // Handle LIMIT
      if (lowerSql.includes("limit 500")) {
        query = query.limit(500);
      } else if (lowerSql.includes("limit 10")) {
        query = query.limit(10);
      } else if (lowerSql.includes("limit 1")) {
        query = query.limit(1);
      }

      const { data, error } = await query;
      if (error) {
        console.error(`[DB ERROR] table=${tableName} action=SELECT error=${error.message}`);
        throw new Error(`[Supabase Error] ${error.message}`);
      }
      const normalized = (data || []).map(normalizeRow);
      console.log(`[DB READ] table=${tableName} resultCount=${normalized.length} status=SUCCESS`);
      return [normalized, []];
    }

    // 5. INSERT INTO table
    if (lowerSql.startsWith("insert into") || lowerSql.startsWith("insert ignore into") || lowerSql.startsWith("replace into")) {
      const tableMatch = cleanSql.match(/(?:insert\s+(?:ignore\s+)?into|replace\s+into)\s+([a-z_]+)\s*\(([^)]+)\)\s*values\s*\((.+)\)/is);
      if (!tableMatch) {
        throw new Error(`[Supabase Driver] Malformed INSERT SQL: ${cleanSql}`);
      }

      const tableName = tableMatch[1].toLowerCase();
      const rawCols = tableMatch[2].split(",").map(c => c.trim().replace(/['"`]/g, ""));
      
      const rawValsStr = tableMatch[3].trim();
      const rawVals: string[] = [];
      let currentToken = "";
      let inQuote = false;
      let quoteChar = "";

      for (let i = 0; i < rawValsStr.length; i++) {
        const char = rawValsStr[i];
        if ((char === "'" || char === '"') && (i === 0 || rawValsStr[i - 1] !== "\\")) {
          if (inQuote && char === quoteChar) {
            inQuote = false;
          } else if (!inQuote) {
            inQuote = true;
            quoteChar = char;
          }
        }
        if (char === "," && !inQuote) {
          rawVals.push(currentToken.trim());
          currentToken = "";
        } else {
          currentToken += char;
        }
      }
      if (currentToken.trim().length > 0) {
        rawVals.push(currentToken.trim());
      }

      const rowObj: any = {};
      let pIdx = 0;

      rawCols.forEach((col, idx) => {
        const valExpr = rawVals[idx];
        if (valExpr === "?" || valExpr === undefined) {
          rowObj[col] = params[pIdx++] ?? null;
        } else if ((valExpr.startsWith("'") && valExpr.endsWith("'")) || (valExpr.startsWith('"') && valExpr.endsWith('"'))) {
          rowObj[col] = valExpr.slice(1, -1).replace(/''/g, "'");
        } else if (valExpr.toLowerCase() === "null" || valExpr === "undefined") {
          rowObj[col] = null;
        } else if (!isNaN(Number(valExpr))) {
          rowObj[col] = Number(valExpr);
        } else if (valExpr.toLowerCase() === "true") {
          rowObj[col] = true;
        } else if (valExpr.toLowerCase() === "false") {
          rowObj[col] = false;
        } else {
          rowObj[col] = params[pIdx++] ?? valExpr ?? null;
        }

        // Dual camelCase & snake_case support for scans/logs/users
        if (col === "userId") rowObj["user_id"] = rowObj[col];
        if (col === "userName") rowObj["user_name"] = rowObj[col];
      });

      // If table is deleted_items, ensure item_id and item_type are set
      if (tableName === "deleted_items") {
        if (rowObj.item_id === undefined && rowObj.itemId !== undefined) rowObj.item_id = rowObj.itemId;
        if (rowObj.item_type === undefined && rowObj.itemType !== undefined) rowObj.item_type = rowObj.itemType;
      }

      const { error } = await this.supabaseClient
        .from(tableName)
        .upsert(rowObj, { onConflict: tableName === "deleted_items" ? "item_type,item_id" : "id" })
        .select();

      if (error) {
        // Fallback to direct insert if onConflict target doesn't match schema index
        const insertRes = await this.supabaseClient.from(tableName).insert(rowObj).select();
        if (insertRes.error) {
          if (insertRes.error.code === "23505" || insertRes.error.message.includes("duplicate")) {
            console.log(`[DB WRITE] table=${tableName} action=INSERT status=DUPLICATE_IGNORED`);
            return [{ affectedRows: 1, insertId: rowObj.id }, []];
          }
          console.error(`[DB ERROR] Failed insert into ${tableName}:`, insertRes.error.message);
          throw new Error(`[Supabase Insert Error] ${insertRes.error.message}`);
        }
      }

      console.log(`[DB WRITE] table=${tableName} action=INSERT status=SUCCESS`);
      return [{ affectedRows: 1, insertId: rowObj.id }, []];
    }

    // 6. UPDATE table SET ... WHERE id = ?
    if (lowerSql.startsWith("update")) {
      const tableMatch = cleanSql.match(/update\s+([a-z_]+)\s+set\s+(.+?)\s+where\s+id\s*=\s*\?/i);
      if (!tableMatch) {
        throw new Error(`[Supabase Driver] Malformed UPDATE SQL: ${cleanSql}`);
      }

      const tableName = tableMatch[1].toLowerCase();
      const setClauses = tableMatch[2].split(",").map(s => s.trim());
      const idVal = params[params.length - 1];

      const updateObj: any = {};
      setClauses.forEach((clause, idx) => {
        const colName = clause.split("=")[0].trim().replace(/['"`]/g, "");
        updateObj[colName] = params[idx];
        if (colName === "userId") updateObj["user_id"] = params[idx];
        if (colName === "userName") updateObj["user_name"] = params[idx];
      });

      const { error } = await this.supabaseClient
        .from(tableName)
        .update(updateObj)
        .eq("id", idVal)
        .select();

      if (error) {
        console.error(`[DB ERROR] table=${tableName} action=UPDATE error=${error.message}`);
        throw new Error(`[Supabase Update Error] ${error.message}`);
      }
      console.log(`[DB WRITE] table=${tableName} action=UPDATE id=${idVal} status=SUCCESS`);
      return [{ affectedRows: 1 }, []];
    }

    // 7. DELETE FROM table WHERE id = ?
    if (lowerSql.startsWith("delete from")) {
      const tableMatch = cleanSql.match(/delete\s+from\s+([a-z_]+)\s+where\s+id\s*=\s*\?/i);
      if (!tableMatch) {
        throw new Error(`[Supabase Driver] Malformed DELETE SQL: ${cleanSql}`);
      }

      const tableName = tableMatch[1].toLowerCase();
      const idVal = params[0];

      const { error } = await this.supabaseClient.from(tableName).delete().eq("id", idVal);
      if (error) {
        console.error(`[DB ERROR] table=${tableName} action=DELETE error=${error.message}`);
        throw new Error(`[Supabase Delete Error] ${error.message}`);
      }
      console.log(`[DB WRITE] table=${tableName} action=DELETE id=${idVal} status=SUCCESS`);
      return [{ affectedRows: 1 }, []];
    }

    // Query tidak dikenal harus melempar error, bukan mengembalikan array kosong!
    throw new Error(`[Supabase Driver] Unsupported SQL statement format: "${cleanSql}"`);
  }
}

// Global function to access the active database driver (100% Supabase PostgreSQL Only)
export function getPool(): DbDriver {
  if (globalDbDriver && globalDbDriver.isHealthy()) {
    return globalDbDriver;
  }

  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "https://enfhcycilaambdkhdnjy.supabase.co"
  ).trim();

  const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZmhjeWNpbGFhbWJka2hkbmp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTM3NTksImV4cCI6MjEwMzMyOTc1OX0.tDod26wLTqQAshq_6kIQv1myQKNTAUz2gS38Umppl_8"
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("[DATABASE ERROR] Supabase URL dan Key tidak dikonfigurasi. Tidak ada fallback database yang diizinkan.");
  }

  try {
    supabaseClientInstance = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    globalDbDriver = new SupabaseDriver(supabaseClientInstance);
    console.log(`[SUPABASE DB] 100% Supabase PostgreSQL Mode Initialized for ${supabaseUrl}`);
    return globalDbDriver;
  } catch (err: any) {
    console.error("[SUPABASE DB FATAL ERROR] Gagal menginisialisasi client Supabase:", err?.message || err);
    recordQueryError("createClient", [], err);
    throw new Error(`[SUPABASE DB FATAL] Gagal tersambung ke database Supabase: ${err?.message || err}`);
  }
}

// Database Check Middleware
function checkDbConnection(req: Request, res: Response, next: NextFunction) {
  try {
    const p = getPool();
    if (!p) {
      return res.status(500).json({ message: "Konfigurasi Database Utama tidak ditemukan atau tidak tersedia." });
    }
    next();
  } catch (err: any) {
    return res.status(500).json({ message: `Database Utama tidak dapat diakses: ${err.message}` });
  }
}

app.use("/api", checkDbConnection);

// WIB DateTime Helper
export function getWIBDateTimeString(dateObj: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(dateObj);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));

  const ymd = `${map.year}-${map.month}-${map.day}`;
  const full = `${ymd} ${map.hour === "24" ? "00" : map.hour}:${map.minute}:${map.second}`;
  const dateKey = `${map.year}${map.month}${map.day}`;
  const ym = `${map.year}-${map.month}`;

  return { ymd, full, dateKey, ym };
}

function pad3(num: number) {
  return num.toString().padStart(3, "0");
}
function pad4(num: number) {
  return num.toString().padStart(4, "0");
}

export function resolveScanUserName(
  s: any,
  userMap: Record<string, string>,
  defaultFullName: string = "UserName"
): string {
  if (!s) return defaultFullName;

  // 1. Check scannedBy / userId / createdBy / username in userMap
  const uidKey = s.scannedBy || s.userId || s.user_id || s.createdBy || s.username;
  if (uidKey) {
    const uidStr = String(uidKey).trim();
    const uidLower = uidStr.toLowerCase();
    const cleanUid = uidLower.startsWith("u-") ? uidLower.substring(2) : uidLower;

    if (userMap[uidStr]) return userMap[uidStr];
    if (userMap[uidLower]) return userMap[uidLower];
    if (cleanUid && userMap[cleanUid]) return userMap[cleanUid];
  }

  // 2. Check if explicit name field is a valid name
  const explicitName = s.fullName || s.userName || s.user_name || s.name;
  if (explicitName && typeof explicitName === "string" && explicitName.trim()) {
    const trimmed = explicitName.trim();
    const lower = trimmed.toLowerCase();
    if (
      lower !== "null" && 
      lower !== "undefined" && 
      lower !== "user" && 
      lower !== "packer logistik" &&
      lower !== "packer admin"
    ) {
      if (userMap[trimmed]) return userMap[trimmed];
      if (userMap[lower]) return userMap[lower];
      return trimmed;
    }
  }

  // 3. Fallback to s.userId if valid, else defaultFullName
  if (s.userId && typeof s.userId === "string") {
    const ulower = s.userId.trim().toLowerCase();
    if (ulower !== "user" && ulower !== "null" && ulower !== "undefined" && ulower !== "u001") {
      return s.userId.trim();
    }
  }

  return defaultFullName;
}

// Activity Logger Helper
async function logActivity(userName: string, action: string): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    const info = getWIBDateTimeString();
    const id = `AL${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await p.query(
      "INSERT INTO activity_log (id, userName, waktu, action) VALUES (?, ?, ?, ?)",
      [id, userName || "", info.full, action || ""]
    );
  } catch (err) {
    console.error("[DB ERROR] Failed logging activity:", err);
  }
}

// ---------------------- ENDPOINTS ----------------------

// 0a. GET /api/debug/db-health
app.get(["/api/debug/db-health", "/api/debug/db-health/"], async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const isSupabase = p.mode === "Supabase PostgreSQL";
    
    let dbConnected = false;
    let testError: string | null = null;

    try {
      const [rows]: any = await p.query("SELECT 1");
      dbConnected = Array.isArray(rows) && rows.length > 0;
    } catch (err: any) {
      dbConnected = false;
      testError = err?.message || String(err);
      recordQueryError("SELECT 1 (db-health check)", [], err);
    }

    const poolState = {
      mode: p.mode,
      isSupabaseConfigured: isSupabase,
      supabaseUrl: process.env.SUPABASE_URL || "Not Set",
      supabaseKeyConfigured: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
      testQueryError: testError,
    };

    const healthResponse = {
      dbConnected,
      status: dbConnected ? "OK" : "ERROR",
      timestamp: getWIBDateTimeString().full,
      poolState,
      recentErrors: recentQueryErrors,
    };

    return res.status(dbConnected ? 200 : 500).json(healthResponse);
  } catch (err: any) {
    console.error("[DB HEALTH ERROR]", err);
    return res.status(500).json({
      dbConnected: false,
      status: "ERROR",
      error: err?.message || String(err),
      recentErrors: recentQueryErrors,
    });
  }
});

// 0b. GET /api/diagnostic and GET /api/health
app.get(["/api/diagnostic", "/api/health"], async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const mode = p.mode;
    
    // Check connection with a ping query
    let testResult = false;
    let dbError = null;
    try {
      const [ping]: any = await p.query("SELECT 1");
      testResult = !!ping;
    } catch (err: any) {
      dbError = err.message || String(err);
    }

    // Gather table counts
    let tableCounts: Record<string, number> = {};
    if (testResult) {
      try {
        const [uCount]: any = await p.query("SELECT COUNT(*) as c FROM users");
        const [eCount]: any = await p.query("SELECT COUNT(*) as c FROM expedisi");
        const [lCount]: any = await p.query("SELECT COUNT(*) as c FROM layanan");
        const [sCount]: any = await p.query("SELECT COUNT(*) as c FROM scans");
        const [lhCount]: any = await p.query("SELECT COUNT(*) as c FROM login_history");
        const [alCount]: any = await p.query("SELECT COUNT(*) as c FROM activity_log");

        tableCounts = {
          users: uCount[0]?.c ?? uCount[0]?.count ?? 0,
          expedisi: eCount[0]?.c ?? eCount[0]?.count ?? 0,
          layanan: lCount[0]?.c ?? lCount[0]?.count ?? 0,
          scans: sCount[0]?.c ?? sCount[0]?.count ?? 0,
          loginHistory: lhCount[0]?.c ?? lhCount[0]?.count ?? 0,
          activityLog: alCount[0]?.c ?? alCount[0]?.count ?? 0,
        };
      } catch (err: any) {
        console.error("[DIAGNOSTIC ERROR] Failed gathering table counts:", err);
      }
    }

    const diagnosticData = {
      status: testResult ? "OK" : "ERROR",
      timestamp: getWIBDateTimeString().full,
      dbMode: mode,
      dbConnected: testResult,
      dbError,
      envConfigured: {
        SUPABASE_URL: process.env.SUPABASE_URL ? "Configured" : "Not Set",
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? "Configured" : "Not Set",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "Configured" : "Not Set",
      },
      tableCounts
    };

    return res.status(testResult ? 200 : 500).json(diagnosticData);
  } catch (err: any) {
    console.error("[DIAGNOSTIC ERROR] Diagnostic handler error:", err);
    return res.status(500).json({ status: "ERROR", error: err.message || String(err) });
  }
});

// 1. POST /api/auth/login
app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const rawIdentifier = (req.body.usernameOrEmail || req.body.username || req.body.email || "").toString().trim();
    const rawPassword = (req.body.password || "").toString().trim();

    if (!rawIdentifier || !rawPassword) {
      return res.status(400).json({ message: "Username/Email dan Password wajib diisi!" });
    }

    const p = getPool();
    // Query user by username or email
    const [rows]: any = await p.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
      [rawIdentifier, rawIdentifier]
    );

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(401).json({ message: "Username/Email atau Password salah!" });
    }

    const user: User = rows[0];

    // Check password
    if (user.password !== rawPassword && user.password !== req.body.password) {
      return res.status(401).json({ message: "Username/Email atau Password salah!" });
    }

    if (user.status === "Inactive") {
      return res.status(403).json({ message: "Akun Anda dinonaktifkan. Silakan hubungi Administrator!" });
    }

    const info = getWIBDateTimeString();
    const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";

    const newHistoryId = `LH${Date.now()}`;
    const displayName = user.name || user.username || "";
    await p.query(
      "INSERT INTO login_history (id, userName, ip, browser, waktu, action) VALUES (?, ?, ?, ?, ?, ?)",
      [
        newHistoryId,
        displayName,
        ip || "",
        (req.headers["user-agent"] as string) || "Browser",
        info.full,
        "Login"
      ]
    );

    await logActivity(displayName, "Berhasil Login ke sistem");

    return res.json({
      message: "Login Berhasil",
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (err: any) {
    console.error("[DB ERROR] Error in login endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 2. POST /api/auth/register
app.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { name, username, email, password, confirmPassword } = req.body;

    if (!name || !username || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Semua kolom wajib diisi!" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Konfirmasi password tidak cocok!" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password minimal harus 8 karakter!" });
    }

    const p = getPool();
    const [existRows]: any = await p.query(
      "SELECT username, email FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
      [username, email]
    );

    if (existRows && existRows.length > 0) {
      if (existRows[0].username && existRows[0].username.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ message: "Username sudah digunakan!" });
      }
      return res.status(400).json({ message: "Email sudah digunakan!" });
    }

    const [countRows]: any = await p.query("SELECT COUNT(*) as count FROM users");
    let userSeq = (countRows[0]?.count || countRows[0]?.c || 0) + 1;
    let newId = `U${pad3(userSeq)}`;
    while (true) {
      const [chk]: any = await p.query("SELECT 1 FROM users WHERE id = ? LIMIT 1", [newId]);
      if (!chk || chk.length === 0) break;
      userSeq++;
      newId = `U${pad3(userSeq)}`;
    }

    const newUser: User = {
      id: newId,
      name,
      username,
      email,
      password,
      role: "Packing",
      status: "Active"
    };

    await p.query(
      "INSERT INTO users (id, name, username, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newUser.id, newUser.name || "", newUser.username || "", newUser.email || "", newUser.password || "", newUser.role || "Packing", newUser.status || "Active"]
    );

    await logActivity(username, `Mendaftar akun baru dengan Username: ${username}`);

    return res.status(201).json({ message: "Registrasi Berhasil! Silakan login." });
  } catch (err: any) {
    console.error("[DB ERROR] Error in register endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 3. POST & GET /api/db/sync - Read-only canonical sync from Server DB
app.all(["/api/db/sync", "/api/db/sync/"], async (req: Request, res: Response) => {
  try {
    const p = getPool();

    // Read full canonical server DB from Supabase
    const [users]: any = await p.query("SELECT * FROM users");
    const [expedisi]: any = await p.query("SELECT * FROM expedisi");
    const [layanan]: any = await p.query("SELECT * FROM layanan");
    const [scans]: any = await p.query("SELECT * FROM scans ORDER BY waktu ASC");
    const [loginHistory]: any = await p.query("SELECT * FROM login_history ORDER BY waktu DESC");
    const [activityLog]: any = await p.query("SELECT * FROM activity_log ORDER BY waktu DESC");

    const userMapSync: { [id: string]: string } = {};
    if (Array.isArray(users)) {
      (users as any[]).forEach(u => {
        const displayName = u.name || u.username;
        if (displayName) {
          if (u.id) userMapSync[u.id] = displayName;
          if (u.id) userMapSync[String(u.id).toLowerCase()] = displayName;
          if (u.username) userMapSync[String(u.username).toLowerCase()] = displayName;
          if (u.name) userMapSync[String(u.name).toLowerCase()] = displayName;
        }
      });
    }

    const processedScans = ((scans as ScanRecord[]) || []).map(s => ({
      ...s,
      userName: resolveScanUserName(s, userMapSync)
    }));

    const [delUsersRows]: any = await p.query("SELECT item_id FROM deleted_items WHERE item_type = 'user'");
    const [delExpRows]: any = await p.query("SELECT item_id FROM deleted_items WHERE item_type = 'expedisi'");
    const [delLayRows]: any = await p.query("SELECT item_id FROM deleted_items WHERE item_type = 'layanan'");
    const [delScansRows]: any = await p.query("SELECT item_id FROM deleted_items WHERE item_type = 'scan'");

    const serverDb: DbSchema = {
      users: (users as User[]) || [],
      expedisi: (expedisi as Expedisi[]) || [],
      layanan: (layanan as Layanan[]) || [],
      scans: processedScans || [],
      loginHistory: (loginHistory as LoginHistory[]) || [],
      activityLog: (activityLog as ActivityLog[]) || [],
      deletedUsers: Array.isArray(delUsersRows) ? delUsersRows.map((r: any) => r.item_id) : [],
      deletedExpedisi: Array.isArray(delExpRows) ? delExpRows.map((r: any) => r.item_id) : [],
      deletedLayanan: Array.isArray(delLayRows) ? delLayRows.map((r: any) => r.item_id) : [],
      deletedScans: Array.isArray(delScansRows) ? delScansRows.map((r: any) => r.item_id) : []
    };

    return res.json({ db: serverDb });
  } catch (err: any) {
    console.error("[DB ERROR] Error in sync endpoint:", err?.message || err);
    return res.status(500).json({ message: "Internal Server Error: Gagal sinkronisasi data Supabase", error: err?.message });
  }
});

// 4. GET /api/dashboard/stats
app.get("/api/dashboard/stats", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const info = getWIBDateTimeString();
    const todayYMD = info.ymd;
    const thisMonthYM = info.ym;
    const currentYear = todayYMD.substring(0, 4);

    // 1. Fetch data for stats from Supabase
    const [allScans]: any = await p.query("SELECT * FROM scans");
    const [allUsers]: any = await p.query("SELECT id, name, username, email FROM users");
    const [allExpedisi]: any = await p.query("SELECT id, name FROM expedisi");

    const scansArr: any[] = Array.isArray(allScans) ? allScans : [];
    const usersArr: any[] = Array.isArray(allUsers) ? allUsers : [];
    const expArr: any[] = Array.isArray(allExpedisi) ? allExpedisi : [];

    const todayScans = scansArr.filter(s => s && s.waktu && String(s.waktu).startsWith(todayYMD));
    const monthScans = scansArr.filter(s => s && s.waktu && String(s.waktu).startsWith(thisMonthYM));

    const totalScanHariIni = todayScans.length;
    const totalScanBulanIni = monthScans.length;
    const totalUser = usersArr.length;
    const totalExpedisi = expArr.length;

    let scansInstanHariIni = 0;
    let scansRegulerHariIni = 0;
    todayScans.forEach((s: any) => {
      const lay = (s.layanan || "").toString().toLowerCase().trim();
      if (lay === "instan") {
        scansInstanHariIni++;
      } else if (lay === "regular" || lay === "reguler") {
        scansRegulerHariIni++;
      }
    });

    // 2. User lookup map for display names
    const userMapStats: { [key: string]: string } = {};
    if (usersArr.length > 0) {
      usersArr.forEach((u: any) => {
        const displayName = u.name || u.username;
        if (displayName) {
          if (u.id) userMapStats[u.id] = displayName;
          if (u.id) userMapStats[String(u.id).toLowerCase()] = displayName;
          if (u.username) userMapStats[String(u.username).toLowerCase()] = displayName;
          if (u.name) userMapStats[String(u.name).toLowerCase()] = displayName;
        }
      });
    }

    // 3. User-specific points for today
    const targetUserId = (req.query.userId as string || "").trim().toLowerCase();
    const targetUsername = (req.query.username as string || "").trim().toLowerCase();
    const targetName = (req.query.name as string || "").trim().toLowerCase();
    const targetEmail = (req.query.email as string || "").trim().toLowerCase();

    const loggedKeys = new Set<string>();
    if (targetUserId) {
      loggedKeys.add(targetUserId);
      if (!targetUserId.startsWith("u-")) loggedKeys.add(`u-${targetUserId}`);
    }
    if (targetUsername) {
      loggedKeys.add(targetUsername);
      if (!targetUsername.startsWith("u-")) loggedKeys.add(`u-${targetUsername}`);
    }
    if (targetName) loggedKeys.add(targetName);
    if (targetEmail) loggedKeys.add(targetEmail);

    const matchedUserObj = usersArr.find((u: any) => {
      if (!u) return false;
      const uId = String(u.id || "").toLowerCase();
      const uUsername = String(u.username || "").toLowerCase();
      const uName = String(u.name || "").toLowerCase();
      const uEmail = String(u.email || "").toLowerCase();

      return (
        (targetUserId && (uId === targetUserId || `u-${uId}` === targetUserId)) ||
        (targetUsername && (uUsername === targetUsername || uId === targetUsername)) ||
        (targetName && uName === targetName) ||
        (targetEmail && uEmail === targetEmail)
      );
    });

    if (matchedUserObj) {
      if (matchedUserObj.id) {
        const uidStr = String(matchedUserObj.id).toLowerCase();
        loggedKeys.add(uidStr);
        loggedKeys.add(`u-${uidStr}`);
      }
      if (matchedUserObj.username) {
        const uNameStr = String(matchedUserObj.username).toLowerCase();
        loggedKeys.add(uNameStr);
        loggedKeys.add(`u-${uNameStr}`);
      }
      if (matchedUserObj.name) loggedKeys.add(String(matchedUserObj.name).toLowerCase());
      if (matchedUserObj.email) loggedKeys.add(String(matchedUserObj.email).toLowerCase());
    }

    const userTodayScans = todayScans.filter((s: any) => {
      if (loggedKeys.size === 0) return false;

      const sUserId = String(s.userId || s.user_id || "").trim().toLowerCase();
      const sUserName = String(s.userName || s.user_name || "").trim().toLowerCase();
      const sUsername = String(s.username || "").trim().toLowerCase();
      const sScannedBy = String(s.scannedBy || "").trim().toLowerCase();
      const sCreatedBy = String(s.createdBy || "").trim().toLowerCase();

      if (sUserId && loggedKeys.has(sUserId)) return true;
      if (sUserName && loggedKeys.has(sUserName)) return true;
      if (sUsername && loggedKeys.has(sUsername)) return true;
      if (sScannedBy && loggedKeys.has(sScannedBy)) return true;
      if (sCreatedBy && loggedKeys.has(sCreatedBy)) return true;

      const resolvedName = resolveScanUserName(s, userMapStats, "").toLowerCase();
      if (resolvedName && loggedKeys.has(resolvedName)) return true;

      return false;
    });

    const userScansInstanHariIni = userTodayScans.filter(s => {
      const lay = (s.layanan || "").toString().toLowerCase().trim();
      return lay === "instan";
    }).length;

    const userScansRegulerHariIni = userTodayScans.filter(s => {
      const lay = (s.layanan || "").toString().toLowerCase().trim();
      return lay === "regular" || lay === "reguler";
    }).length;

    const pointInstanHariIni = Math.floor(userScansInstanHariIni / 3) + (userScansInstanHariIni % 3 === 2 ? 1 : 0);
    const pointRegulerHariIni = userScansRegulerHariIni * 1;

    // 4. Scan Per Hari (last 7 days)
    const todayObj = new Date();
    const last7DaysMap: { [key: string]: number } = {};
    for (let i = 6; i >= 0; i--) {
      const wibDay = new Date(todayObj.getTime() - (i * 24 * 60 * 60 * 1000));
      const dayInfo = getWIBDateTimeString(wibDay);
      last7DaysMap[dayInfo.ymd] = 0;
    }

    scansArr.forEach(s => {
      if (s && s.waktu) {
        const dateStr = String(s.waktu).substring(0, 10);
        if (last7DaysMap[dateStr] !== undefined) {
          last7DaysMap[dateStr]++;
        }
      }
    });

    const chartScanPerHari = Object.keys(last7DaysMap).map(k => ({
      tanggal: k.substring(5), // MM-DD
      total: last7DaysMap[k]
    }));

    // 5. Scan Per Bulan (current year)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const scanPerBulanMap: { [key: string]: number } = {
      "01": 0, "02": 0, "03": 0, "04": 0, "05": 0, "06": 0, "07": 0, "08": 0, "09": 0, "10": 0, "11": 0, "12": 0
    };

    scansArr.forEach(s => {
      if (s && s.waktu && String(s.waktu).startsWith(currentYear)) {
        const monthStr = String(s.waktu).substring(5, 7);
        if (scanPerBulanMap[monthStr] !== undefined) {
          scanPerBulanMap[monthStr]++;
        }
      }
    });

    const chartScanPerBulan = Object.keys(scanPerBulanMap).map(k => ({
      bulan: monthNames[parseInt(k, 10) - 1],
      total: scanPerBulanMap[k]
    }));

    // 6. Top Expedisi & Layanan
    const expCountMap: { [key: string]: number } = {};
    const layCountMap: { [key: string]: number } = {};

    scansArr.forEach(s => {
      if (s && s.expedisi && String(s.expedisi).trim() && String(s.expedisi).trim() !== "-") {
        const expName = String(s.expedisi).trim();
        expCountMap[expName] = (expCountMap[expName] || 0) + 1;
      }
      if (s && s.layanan && String(s.layanan).trim()) {
        const layName = String(s.layanan).trim();
        layCountMap[layName] = (layCountMap[layName] || 0) + 1;
      }
    });

    const chartExpedisi = Object.keys(expCountMap)
      .map(k => ({ name: k, total: expCountMap[k] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const chartLayanan = Object.keys(layCountMap)
      .map(k => ({ name: k, total: layCountMap[k] }))
      .sort((a, b) => b.total - a.total);

    // 7. Live Feed
    const sortedScans = [...scansArr].sort((a, b) => {
      const timeA = String(a.waktu || "");
      const timeB = String(b.waktu || "");
      return timeB.localeCompare(timeA);
    }).slice(0, 10);

    const processedLiveFeed = sortedScans.map((s: any) => ({
      id: s.id,
      userId: s.userId || s.user_id,
      userName: resolveScanUserName(s, userMapStats),
      resi: s.resi,
      waktu: s.waktu,
      layanan: s.layanan,
      expedisi: s.expedisi
    }));

    return res.json({
      totalScanHariIni,
      totalScanBulanIni,
      totalUser,
      totalExpedisi,
      scansInstanHariIni,
      scansRegulerHariIni,
      pointInstanHariIni,
      pointRegulerHariIni,
      charts: {
        scanPerHari: chartScanPerHari,
        scanPerBulan: chartScanPerBulan,
        expedisi: chartExpedisi,
        layanan: chartLayanan
      },
      liveFeed: processedLiveFeed
    });
  } catch (err: any) {
    console.error("[DB ERROR] Error in dashboard stats endpoint:", err?.message || err);
    return res.status(500).json({ message: "Internal Server Error: Gagal memuat statistik database Supabase", error: err?.message });
  }
});

// 5. GET /api/scans
app.get("/api/scans", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const id = (req.query.id || req.params.id) as string | undefined;

    if (id) {
      const [rows]: any = await p.query("SELECT * FROM scans WHERE id = ? LIMIT 1", [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: "Data scan tidak ditemukan!" });
      }
      return res.json(rows[0]);
    }

    const { range, username } = req.query;
    let sql = "SELECT * FROM scans WHERE 1=1";
    const params: any[] = [];

    if (username) {
      const target = (username as string).trim().toLowerCase();
      sql += " AND (LOWER(userName) = ? OR userId IN (SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(name) = ?))";
      params.push(target, target, target);
    }

    sql += " ORDER BY waktu DESC, id DESC";
    const [rows]: any = await p.query(sql, params);

    // FILTER MANUAL UNTUK 24 JAM TERBARU (Akurat)
    let finalRows = rows || [];
    if (range === "latest24h") {
      const info = getWIBDateTimeString();
      finalRows = finalRows.filter((s: any) => s && s.waktu && String(s.waktu).startsWith(info.ymd));
    }

    // Build user map to resolve missing user names
    const userMap: { [key: string]: string } = {};
    const [allUsers]: any = await p.query("SELECT id, name, username FROM users");

    if (Array.isArray(allUsers)) {
      allUsers.forEach((u: any) => {
        const displayName = u.name || u.username;
        if (displayName) {
          if (u.id) userMap[u.id] = displayName;
          if (u.id) userMap[String(u.id).toLowerCase()] = displayName;
          if (u.username) userMap[String(u.username).toLowerCase()] = displayName;
          if (u.name) userMap[String(u.name).toLowerCase()] = displayName;
        }
      });
    }

    const processedRows = finalRows.map((s: any) => ({
      ...s,
      userName: resolveScanUserName(s, userMap)
    }));

    return res.json(processedRows);

  } catch (err: any) {
    console.error("[DB ERROR] Error in get scans endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 6. POST /api/scans
app.post("/api/scans", async (req: Request, res: Response) => {
  try {
    const { resi, layanan, expedisi, userName, username, name, user: userField, userId: reqUserId } = req.body;
    const finalExpedisi = (layanan === "Instan") ? (expedisi || "-") : (expedisi || "");
    const rawUserName = (userName || name || userField || "").trim();
    const rawUsername = (username || "").trim();
    const inputUserId = (reqUserId || "").trim();

    if (!resi || !layanan || !finalExpedisi) {
      return res.status(400).json({ message: "Resi, Layanan, dan Expedisi wajib diisi!" });
    }

    const p = getPool();
    const trimmedResi = resi.trim();

    // Validate duplicate resi
    const [dupRows]: any = await p.query(
      "SELECT 1 FROM scans WHERE LOWER(resi) = LOWER(?) LIMIT 1",
      [trimmedResi]
    );
    if (dupRows && dupRows.length > 0) {
      return res.status(400).json({ message: `Gagal! No Resi [${trimmedResi}] sudah pernah digunakan/discan sebelumnya!` });
    }

    // Lookup user ID & Name
    let userId = inputUserId;
    let resolvedUserName = rawUserName || rawUsername;

    // Search candidates in users DB table by ID, username, or name
    const searchCandidates = [inputUserId, rawUsername, rawUserName].filter(Boolean);
    let matchedUserFromDb = null;
    if (searchCandidates.length > 0) {
      for (const term of searchCandidates) {
        const [userRows]: any = await p.query(
          "SELECT id, name, username FROM users WHERE LOWER(id) = LOWER(?) OR LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?) LIMIT 1",
          [term, term, term]
        );
        if (userRows && userRows.length > 0) {
          matchedUserFromDb = userRows[0];
          break;
        }
      }
    }

    if (matchedUserFromDb) {
      if (matchedUserFromDb.id) userId = matchedUserFromDb.id;
      resolvedUserName = matchedUserFromDb.name || matchedUserFromDb.username || rawUserName || rawUsername;
    } else {
      if (rawUserName && rawUserName.toLowerCase() !== "user") {
        resolvedUserName = rawUserName;
      } else if (rawUsername) {
        resolvedUserName = rawUsername;
      } else {
        resolvedUserName = "User";
      }
      if (!userId) {
        userId = rawUsername ? `U-${rawUsername}` : (inputUserId || `U-${Date.now()}`);
      }
    }

    // Serial ID Generator: LOG-YYYYMMDD-XXXX
    const info = getWIBDateTimeString();
    const dateKey = info.dateKey;
    const todayYMD = info.ymd;

    const [scansCountRows]: any = await p.query(
      "SELECT COUNT(*) as count FROM scans WHERE waktu LIKE ?",
      [`${todayYMD}%`]
    );
    let dailySeq = (scansCountRows[0]?.count || scansCountRows[0]?.c || 0) + 1;
    let serialId = `LOG-${dateKey}-${pad4(dailySeq)}`;
    while (true) {
      const [chk]: any = await p.query("SELECT 1 FROM scans WHERE id = ? LIMIT 1", [serialId]);
      if (!chk || chk.length === 0) break;
      dailySeq++;
      serialId = `LOG-${dateKey}-${pad4(dailySeq)}`;
    }

    const newScan: ScanRecord = {
      id: serialId,
      userId,
      userName: resolvedUserName,
      resi: trimmedResi.toUpperCase(),
      waktu: info.full,
      layanan,
      expedisi: finalExpedisi
    };

    await p.query(
      "INSERT INTO scans (id, userId, userName, resi, waktu, layanan, expedisi) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newScan.id, newScan.userId || "", newScan.userName || "", newScan.resi || "", newScan.waktu || "", newScan.layanan || "", newScan.expedisi || ""]
    );

    await logActivity(resolvedUserName, `Berhasil scan resi logistik [${newScan.resi}] via Web Scanner`);

    const [totalCountRows]: any = await p.query("SELECT COUNT(*) as count FROM scans");
    const totalScansCount = Number(totalCountRows[0]?.count || totalCountRows[0]?.c || totalCountRows[0]?.['COUNT(*)'] || 1);

    return res.status(201).json({
      message: "Scan Berhasil",
      scan: newScan,
      totalScansCount
    });
  } catch (err: any) {
    console.error("[DB ERROR] Error in post scans endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 7. DELETE /api/scans/:id
app.delete("/api/scans/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID scan wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT resi, id FROM scans WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Data scan tidak ditemukan!" });
    }

    const scan = rows[0];
    await p.query("DELETE FROM scans WHERE id = ?", [id]);
    await p.query("INSERT INTO deleted_items (item_type, item_id) VALUES (?, ?)", ["scan", id]);

    await logActivity("admin", `Menghapus data scan resi: ${scan.resi} (Serial ID: ${scan.id})`);

    return res.json({ message: "Data scan berhasil dihapus!" });
  } catch (err: any) {
    console.error("[DB ERROR] Error in delete scan endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 8. GET /api/users
app.get("/api/users", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const id = (req.query.id || req.params.id) as string | undefined;

    if (id) {
      const [rows]: any = await p.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: "User tidak ditemukan!" });
      }
      return res.json(rows[0]);
    }

    const [rows]: any = await p.query("SELECT * FROM users");
    return res.json(rows || []);
  } catch (err: any) {
    console.error("[DB ERROR] Error in get users endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 9. POST /api/users
app.post("/api/users", async (req: Request, res: Response) => {
  try {
    const { name, username, email, password, role, status } = req.body;
    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ message: "Nama, Username, Email, Password, dan Role wajib diisi!" });
    }

    const p = getPool();
    const [existRows]: any = await p.query(
      "SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
      [username, email]
    );
    if (existRows && existRows.length > 0) {
      return res.status(400).json({ message: "Username atau Email sudah digunakan!" });
    }

    const [countRows]: any = await p.query("SELECT COUNT(*) as count FROM users");
    let userSeq = (countRows[0]?.count || countRows[0]?.c || 0) + 1;
    let newId = `U${pad3(userSeq)}`;
    while (true) {
      const [chk]: any = await p.query("SELECT 1 FROM users WHERE id = ? LIMIT 1", [newId]);
      if (!chk || chk.length === 0) break;
      userSeq++;
      newId = `U${pad3(userSeq)}`;
    }

    const newUser: User = {
      id: newId,
      name,
      username,
      email,
      password,
      role,
      status: status || "Active"
    };

    await p.query(
      "INSERT INTO users (id, name, username, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newUser.id, newUser.name || "", newUser.username || "", newUser.email || "", newUser.password || "", newUser.role || "Packing", newUser.status || "Active"]
    );

    await logActivity("admin", `Membuat user baru: ${username} (${role})`);

    return res.status(201).json(newUser);
  } catch (err: any) {
    console.error("[DB ERROR] Error in post users endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 10. PUT /api/users/:id
app.put("/api/users/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID User wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan!" });
    }

    const oldUser: User = rows[0];
    const { name, username, email, password, role, status } = req.body;

    const updatedUser: User = {
      id: oldUser.id,
      name: name ?? oldUser.name,
      username: username ?? oldUser.username,
      email: email ?? oldUser.email,
      password: password ?? oldUser.password,
      role: role ?? oldUser.role,
      status: status ?? oldUser.status
    };

    await p.query(
      "UPDATE users SET name = ?, username = ?, email = ?, password = ?, role = ?, status = ? WHERE id = ?",
      [updatedUser.name || "", updatedUser.username || "", updatedUser.email || "", updatedUser.password || "", updatedUser.role || "Packing", updatedUser.status || "Active", id]
    );

    await logActivity("admin", `Mengupdate profil/status user: ${updatedUser.username}`);

    return res.json(updatedUser);
  } catch (err: any) {
    console.error("[DB ERROR] Error in put user endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 11. DELETE /api/users/:id
app.delete("/api/users/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID User wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT username FROM users WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan!" });
    }

    const username = rows[0].username;
    await p.query("DELETE FROM users WHERE id = ?", [id]);
    await p.query("INSERT INTO deleted_items (item_type, item_id) VALUES (?, ?)", ["user", id]);

    await logActivity("admin", `Menghapus user: ${username}`);

    return res.json({ message: "User berhasil dihapus!" });
  } catch (err: any) {
    console.error("[DB ERROR] Error in delete user endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 12. GET /api/expedisi
app.get("/api/expedisi", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const id = (req.query.id || req.params.id) as string | undefined;

    if (id) {
      const [rows]: any = await p.query("SELECT * FROM expedisi WHERE id = ? LIMIT 1", [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: "Expedisi tidak ditemukan!" });
      }
      return res.json(rows[0]);
    }

    const [rows]: any = await p.query("SELECT * FROM expedisi");
    return res.json(rows || []);
  } catch (err: any) {
    console.error("[DB ERROR] Error in get expedisi endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 13. POST /api/expedisi
app.post("/api/expedisi", async (req: Request, res: Response) => {
  try {
    const { name, status } = req.body;
    if (!name) return res.status(400).json({ message: "Nama expedisi wajib diisi!" });

    const p = getPool();
    const [countRows]: any = await p.query("SELECT COUNT(*) as count FROM expedisi");
    let expSeq = (countRows[0]?.count || countRows[0]?.c || 0) + 1;
    let newId = `E${pad3(expSeq)}`;
    while (true) {
      const [chk]: any = await p.query("SELECT 1 FROM expedisi WHERE id = ? LIMIT 1", [newId]);
      if (!chk || chk.length === 0) break;
      expSeq++;
      newId = `E${pad3(expSeq)}`;
    }

    const newExp: Expedisi = {
      id: newId,
      name,
      status: status || "Active"
    };

    await p.query("INSERT INTO expedisi (id, name, status) VALUES (?, ?, ?)", [newExp.id, newExp.name || "", newExp.status || "Active"]);
    await logActivity("admin", `Membuat expedisi baru: ${name}`);

    return res.status(201).json(newExp);
  } catch (err: any) {
    console.error("[DB ERROR] Error in post expedisi endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 14. PUT /api/expedisi/:id
app.put("/api/expedisi/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID Expedisi wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT * FROM expedisi WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Expedisi tidak ditemukan!" });
    }

    const oldExp: Expedisi = rows[0];
    const { name, status } = req.body;

    const updatedExp: Expedisi = {
      id: oldExp.id,
      name: name ?? oldExp.name,
      status: status ?? oldExp.status
    };

    await p.query("UPDATE expedisi SET name = ?, status = ? WHERE id = ?", [updatedExp.name || "", updatedExp.status || "Active", id]);
    await logActivity("admin", `Mengupdate expedisi: ${updatedExp.name}`);

    return res.json(updatedExp);
  } catch (err: any) {
    console.error("[DB ERROR] Error in put expedisi endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 15. DELETE /api/expedisi/:id
app.delete("/api/expedisi/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID Expedisi wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT name FROM expedisi WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Expedisi tidak ditemukan!" });
    }

    const name = rows[0].name;
    await p.query("DELETE FROM expedisi WHERE id = ?", [id]);
    await p.query("INSERT INTO deleted_items (item_type, item_id) VALUES (?, ?)", ["expedisi", id]);

    await logActivity("admin", `Menghapus expedisi: ${name}`);

    return res.json({ message: "Expedisi berhasil dihapus" });
  } catch (err: any) {
    console.error("[DB ERROR] Error in delete expedisi endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 16. GET /api/layanan
app.get("/api/layanan", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const id = (req.query.id || req.params.id) as string | undefined;

    if (id) {
      const [rows]: any = await p.query("SELECT * FROM layanan WHERE id = ? LIMIT 1", [id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: "Layanan tidak ditemukan!" });
      }
      return res.json(rows[0]);
    }

    const [rows]: any = await p.query("SELECT * FROM layanan");
    return res.json(rows || []);
  } catch (err: any) {
    console.error("[DB ERROR] Error in get layanan endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 17. POST /api/layanan
app.post("/api/layanan", async (req: Request, res: Response) => {
  try {
    const { name, status } = req.body;
    if (!name) return res.status(400).json({ message: "Nama layanan wajib diisi!" });

    const p = getPool();
    const [countRows]: any = await p.query("SELECT COUNT(*) as count FROM layanan");
    let laySeq = (countRows[0]?.count || countRows[0]?.c || 0) + 1;
    let newId = `L${pad3(laySeq)}`;
    while (true) {
      const [chk]: any = await p.query("SELECT 1 FROM layanan WHERE id = ? LIMIT 1", [newId]);
      if (!chk || chk.length === 0) break;
      laySeq++;
      newId = `L${pad3(laySeq)}`;
    }

    const newLay: Layanan = {
      id: newId,
      name,
      status: status || "Active"
    };

    await p.query("INSERT INTO layanan (id, name, status) VALUES (?, ?, ?)", [newLay.id, newLay.name || "", newLay.status || "Active"]);
    await logActivity("admin", `Membuat layanan baru: ${name}`);

    return res.status(201).json(newLay);
  } catch (err: any) {
    console.error("[DB ERROR] Error in post layanan endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 18. PUT /api/layanan/:id
app.put("/api/layanan/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID Layanan wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT * FROM layanan WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Layanan tidak ditemukan!" });
    }

    const oldLay: Layanan = rows[0];
    const { name, status } = req.body;

    const updatedLay: Layanan = {
      id: oldLay.id,
      name: name ?? oldLay.name,
      status: status ?? oldLay.status
    };

    await p.query("UPDATE layanan SET name = ?, status = ? WHERE id = ?", [updatedLay.name || "", updatedLay.status || "Active", id]);
    await logActivity("admin", `Mengupdate jenis layanan: ${updatedLay.name}`);

    return res.json(updatedLay);
  } catch (err: any) {
    console.error("[DB ERROR] Error in put layanan endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 19. DELETE /api/layanan/:id
app.delete("/api/layanan/:id?", async (req: Request, res: Response) => {
  try {
    const id = (req.query.id || req.params.id) as string | undefined;
    if (!id) return res.status(400).json({ message: "ID Layanan wajib diisi!" });

    const p = getPool();
    const [rows]: any = await p.query("SELECT name FROM layanan WHERE id = ? LIMIT 1", [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Layanan tidak ditemukan!" });
    }

    const name = rows[0].name;
    await p.query("DELETE FROM layanan WHERE id = ?", [id]);
    await p.query("INSERT INTO deleted_items (item_type, item_id) VALUES (?, ?)", ["layanan", id]);

    await logActivity("admin", `Menghapus jenis layanan: ${name}`);

    return res.json({ message: "Layanan berhasil dihapus" });
  } catch (err: any) {
    console.error("[DB ERROR] Error in delete layanan endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// 20. GET /api/logs/login_history
app.get("/api/logs/login_history", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const [rows]: any = await p.query("SELECT * FROM login_history ORDER BY waktu DESC LIMIT 500");
    return res.json(rows || []);
  } catch (err: any) {
    console.error("[DB ERROR] Error in login_history endpoint:", err?.message || err);
    return res.status(500).json({ message: "Internal Server Error: Gagal mengambil login history", error: err?.message });
  }
});

// 21. GET /api/logs/activity_log
app.get("/api/logs/activity_log", async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const [rows]: any = await p.query("SELECT * FROM activity_log ORDER BY waktu DESC LIMIT 500");
    return res.json(rows || []);
  } catch (err: any) {
    console.error("[DB ERROR] Error in activity_log endpoint:", err?.message || err);
    return res.status(500).json({ message: "Internal Server Error: Gagal mengambil activity log", error: err?.message });
  }
});

// 22. POST /api/logs/activity
app.post("/api/logs/activity", async (req: Request, res: Response) => {
  try {
    const { userName, action } = req.body;
    if (!userName || !action) {
      return res.status(400).json({ message: "Username dan Action wajib diisi" });
    }
    await logActivity(userName, action);
    return res.json({ status: "success" });
  } catch (err: any) {
    console.error("[DB ERROR] Error in activity endpoint:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// Global Fallback/Unmatched routes for API
app.all("/api/*", (req: Request, res: Response) => {
  res.status(404).json({ message: `Path ${req.method} ${req.path} tidak ditemukan di Monolith API.` });
});

export default app;
