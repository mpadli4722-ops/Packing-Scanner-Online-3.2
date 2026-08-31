import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { 
  Database, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Clock, 
  Server,
  Layers,
  Terminal,
  Check,
  Copy
} from "lucide-react";

interface LogEntry {
  id?: string | number;
  user_name?: string;
  userName?: string;
  action?: string;
  created_at?: string;
  createdAt?: string;
  details?: string;
  [key: string]: any;
}

export default function SupabaseTester() {
  const [selectedTable, setSelectedTable] = useState<string>("activity_log");
  const [activeTableFound, setActiveTableFound] = useState<string>("activity_log");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastTestedAt, setLastTestedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [testInsertLoading, setTestInsertLoading] = useState(false);
  const [insertSuccessMsg, setInsertSuccessMsg] = useState<string | null>(null);

  const candidateTables = ["activity_log", "activity_logs", "logs", "users", "scans", "login_history", "expedisi", "layanan"];

  const testSupabaseConnection = async (targetTable = selectedTable) => {
    setStatus("loading");
    setErrorMessage(null);
    setInsertSuccessMsg(null);
    const startTime = performance.now();

    // Table fallback list
    const fallbackList = targetTable === "activity_log" || targetTable === "activity_logs" || targetTable === "logs"
      ? [targetTable, "activity_log", "activity_logs", "logs"]
      : [targetTable];

    let lastErr: any = null;
    let foundData: any[] | null = null;
    let successfulTable = targetTable;

    for (const tbl of Array.from(new Set(fallbackList))) {
      try {
        const { data, error } = await supabase
          .from(tbl)
          .select("*")
          .limit(10);

        if (!error) {
          foundData = data || [];
          successfulTable = tbl;
          lastErr = null;
          break;
        } else {
          lastErr = error;
          if (!error.message?.includes("Could not find the table") && !error.message?.includes("schema cache")) {
            break;
          }
        }
      } catch (err: any) {
        lastErr = err;
      }
    }

    const endTime = performance.now();
    setLatencyMs(Math.round(endTime - startTime));
    setLastTestedAt(new Date());

    if (foundData !== null) {
      setStatus("success");
      setActiveTableFound(successfulTable);
      setLogs(foundData);
    } else {
      setStatus("error");
      setErrorMessage(
        lastErr
          ? `[${lastErr.code || "DB_ERROR"}] ${lastErr.message} (Tabel: ${targetTable})`
          : "Gagal menghubungi instance Supabase"
      );
      setLogs([]);
    }
  };

  const handleTestInsert = async () => {
    setTestInsertLoading(true);
    setInsertSuccessMsg(null);
    try {
      const timestamp = new Date().toISOString();
      const targetTable = activeTableFound || selectedTable;
      
      const payload: any = {
        action: `Ping koneksi Supabase Tester (${timestamp})`,
        waktu: timestamp
      };

      if (targetTable.includes("user")) {
        payload.username = `test_${Date.now()}`;
        payload.name = "Tester User";
        payload.role = "user";
        payload.status = "Aktif";
      } else {
        payload.user_name = "System Tester";
        payload.userName = "System Tester";
      }

      const { error } = await supabase
        .from(targetTable)
        .insert([payload])
        .select();

      if (error) {
        throw new Error(error.message);
      }

      setInsertSuccessMsg(`Data log uji coba berhasil di-insert ke tabel '${targetTable}' Supabase!`);
      // Refresh list
      await testSupabaseConnection(targetTable);
    } catch (err: any) {
      setErrorMessage(`Gagal write/insert ke ${activeTableFound}: ${err.message}`);
    } finally {
      setTestInsertLoading(false);
    }
  };

  // Run test automatically on component mount
  useEffect(() => {
    testSupabaseConnection(selectedTable);
  }, [selectedTable]);

  const copyEndpoint = () => {
    const url = (supabase as any)?.supabaseUrl || "https://enfhcycilaambdkhdnjy.supabase.co";
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="supabase-tester-container" className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
              <Database className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Supabase Tester</h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  PostgreSQL Client
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Utilitas diagnosis untuk memvalidasi konektivitas Supabase PostgreSQL, latensi respon, serta query tabel live.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {candidateTables.map((t) => (
                <option key={t} value={t}>
                  Tabel: {t}
                </option>
              ))}
            </select>

            <button
              id="supabase-refresh-test-btn"
              onClick={() => testSupabaseConnection(selectedTable)}
              disabled={status === "loading"}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
              <span>{status === "loading" ? "Memeriksa..." : "Uji Ulang"}</span>
            </button>

            <button
              id="supabase-test-insert-btn"
              onClick={handleTestInsert}
              disabled={testInsertLoading || status === "loading"}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{testInsertLoading ? "Menyimpan..." : "Test Insert"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Connection Overview Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status Koneksi</span>
            {status === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
            {status === "error" && <AlertCircle className="w-5 h-5 text-rose-500" />}
            {status === "loading" && <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />}
            {status === "idle" && <Activity className="w-5 h-5 text-slate-400" />}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-black ${
              status === "success" ? "text-emerald-600" :
              status === "error" ? "text-rose-600" :
              status === "loading" ? "text-blue-600" : "text-slate-600"
            }`}>
              {status === "success" ? "Connected" :
               status === "error" ? "Connection Error" :
               status === "loading" ? "Connecting..." : "Idle"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">
            {status === "success" ? "Query tabel logs berhasil" :
             status === "error" ? "Gagal mengeksekusi query" : "Memeriksa status..."}
          </p>
        </div>

        {/* Latency Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Latensi Query</span>
            <Clock className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">
              {latencyMs !== null ? `${latencyMs}` : "—"}
            </span>
            <span className="text-xs font-bold text-slate-500">ms</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Waktu roundtrip HTTP/REST</p>
        </div>

        {/* Fetched Rows Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Record Ditemukan</span>
            <Layers className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">{logs.length}</span>
            <span className="text-xs font-bold text-slate-500">baris</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Limit 10 entri terbaru</p>
        </div>

        {/* Database Endpoint Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Endpoint Host</span>
            <Server className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono font-bold text-slate-700 truncate">
              enfhcycilaambdkhdnjy...
            </span>
            <button
              onClick={copyEndpoint}
              title="Salin URL Supabase"
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Supabase Cloud PostgreSQL</p>
        </div>
      </div>

      {/* Notification Alert / Error banner */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-rose-900">Kesalahan Eksekusi Query Supabase</h4>
            <p className="text-xs text-rose-700 font-mono break-all">{errorMessage}</p>
          </div>
        </div>
      )}

      {insertSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-emerald-900">Operasi Berhasil</h4>
            <p className="text-xs text-emerald-700">{insertSuccessMsg}</p>
          </div>
        </div>
      )}

      {/* Query Results Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Data Query Tabel: <code className="text-emerald-600 font-mono">public.{activeTableFound}</code></h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Query: <span className="font-mono text-slate-700">supabase.from(&apos;{activeTableFound}&apos;).select(&apos;*&apos;).limit(10)</span>
            </p>
          </div>
          {lastTestedAt && (
            <span className="text-[11px] text-slate-400 font-mono self-start sm:self-auto">
              Terakhir diperbarui: {lastTestedAt.toLocaleTimeString("id-ID")}
            </span>
          )}
        </div>

        {status === "loading" && logs.length === 0 ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-xs font-bold text-slate-700">Mengambil data dari Supabase...</p>
            <p className="text-[11px] text-slate-400 mt-1">Mengirim query ke REST API Supabase</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <Database className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-xs font-bold text-slate-700">Belum ada baris log dalam tabel</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Klik tombol &quot;Test Insert Log&quot; di atas untuk menulis data pengujian ke Supabase.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/60 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Aktivitas / Pesan</th>
                  <th className="py-3 px-4">Waktu (created_at)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log, index) => {
                  const id = log.id ?? index + 1;
                  const userName = log.user_name || log.userName || "System";
                  const action = log.action || log.message || log.details || JSON.stringify(log);
                  const createdAt = log.created_at || log.createdAt || "-";

                  return (
                    <tr key={String(id)} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-500 font-medium">
                        #{String(id).slice(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold font-mono text-[11px]">
                          {userName}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-800 font-medium max-w-md truncate">
                        {action}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {createdAt}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
