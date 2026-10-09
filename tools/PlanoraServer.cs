// Planora 独立桌面版本体（v1.1.2）：一个进程干三件事，不依赖 Node，也没有控制台窗口。
//
//   1. 本地静态服务：把同目录的 Planora.html 交给自己窗口里的 WebView2
//   2. 本地数据服务：GET/PUT /api/store，把 data\planora.json 当成数据库（与 1.1.1 完全一致）
//   3. 独立窗口宿主：用 WinForms + WebView2 开一个属于 Planora 自己的窗口，
//      不再拉起系统默认浏览器，也不再出现命令行黑窗；关掉窗口就彻底退出。
//
// 编译（不需要 Visual Studio，Windows 自带 .NET Framework 4 的 csc 即可）：
//   csc /nologo /target:winexe /optimize+ /win32icon:icon.ico /win32manifest:Planora.exe.manifest ^
//       /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll ^
//       /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.WinForms.dll ^
//       /out:Planora.exe PlanoraServer.cs
//   运行时需要把 Microsoft.Web.WebView2.Core.dll、Microsoft.Web.WebView2.WinForms.dll、
//   WebView2Loader.dll 放在 Planora.exe 同目录（发布包已随带）。
//
// 落盘策略：先写 planora.json.tmp，再用 ReplaceFile 原子替换，上一版留成 planora.json.bak。
// 被强杀/断电最多丢「正在写的那一次」，正式文件永远是一个完整的 JSON。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Planora")]
[assembly: AssemblyProduct("Planora")]
[assembly: AssemblyDescription("Planora 独立桌面版：自带窗口 + 内置本地数据服务（无控制台、不依赖浏览器）")]
[assembly: AssemblyCompany("Planora")]
[assembly: AssemblyVersion("1.1.2.0")]
[assembly: AssemblyFileVersion("1.1.2.0")]

internal static class PlanoraServer
{
    private const string AppId = "planora";
    private const string DisplayName = "Planora";
    private const string Version = "1.1.2";
    private const string StoreFormat = "planora-store/v1";
    private const string StoreFileName = "planora.json";
    private const string LogFileName = "planora.log";
    private const string ViewKey = "planora/view/v1";
    private const string SingleInstanceMutex = "Local\\Planora_SingleInstance_1_1_2";
    private const int MaxBodyBytes = 4 * 1024 * 1024;
    private const int MaxHeaderBytes = 16384;
    private static readonly int[] Ports = new int[] { 5173, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5187, 5188, 5189 };

    private static readonly object DataGate = new object();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static string appDir;
    private static string htmlPath;
    private static string iconPath;
    private static string dataDir;
    private static string webviewDir;
    private static string storePath;
    private static string logPath;
    private static int port;
    private static volatile bool serverRunning;   // 服务只在窗口开着时跑；窗口关了就不再接受请求

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Json.MaxJsonLength = MaxBodyBytes;
        appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        htmlPath = Path.Combine(appDir, "Planora.html");
        iconPath = Path.Combine(appDir, "icon.ico");

        if (!File.Exists(htmlPath))
        {
            MessageBox.Show(
                "没有找到 Planora.html。请把 Planora.exe 和 Planora.html 放在同一个文件夹里再运行。",
                DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 2;
        }

        // 单实例：已经有一个 Planora 窗口开着，就把那个窗口叫到前台，本进程直接退出。
        bool createdNew;
        Mutex mutex = new Mutex(true, SingleInstanceMutex, out createdNew);
        if (!createdNew)
        {
            ActivateExistingInstance();
            return 0;
        }

        try
        {
            dataDir = ResolveDataDir();
            storePath = Path.Combine(dataDir, StoreFileName);
            logPath = Path.Combine(dataDir, LogFileName);
            webviewDir = ResolveWebViewDir();
            Log("启动 v" + Version + "  程序目录=" + appDir + "  数据文件=" + storePath + "  WebView2 配置=" + webviewDir);

            // 抢一个空闲端口起本地服务（页面靠它读 data\planora.json，所以服务必须在窗口之前就绪）。
            TcpListener listener = null;
            for (int i = 0; i < Ports.Length; i += 1)
            {
                listener = TryListen(Ports[i]);
                if (listener != null) { port = Ports[i]; break; }
            }
            if (listener == null)
            {
                MessageBox.Show(
                    "端口 5173、5180-5189 都被占用了，Planora 起不来。\n请关掉占用端口的程序后重试。",
                    DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 3;
            }

            serverRunning = true;
            Thread worker = new Thread(delegate () { AcceptLoop(listener); });
            worker.IsBackground = true;
            worker.Start();
            Log("数据服务已就绪 http://localhost:" + port + "/");

            string url = "http://localhost:" + port + "/";
            RunWindow(url);

            // 窗口已关：给页面最后一次「离开前保存」的机会（keepalive PUT），再收摊。
            Thread.Sleep(350);
            serverRunning = false;
            try { listener.Stop(); } catch (Exception) { }
            Log("退出");
            return 0;
        }
        finally
        {
            GC.KeepAlive(mutex);
        }
    }

    /* ---------------- 窗口 ---------------- */

    private static void RunWindow(string url)
    {
        Form form = new Form();
        form.Text = "Planora · 每日计划";
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Width = 1180;
        form.Height = 820;
        form.MinimumSize = new Size(560, 480);
        try
        {
            if (File.Exists(iconPath)) form.Icon = new Icon(iconPath);
        }
        catch (Exception) { }

        WebView2 webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        form.Controls.Add(webView);

        // WebView2 必须在 UI（STA）线程上初始化：换到线程池会报 RPC_E_CHANGED_MODE。
        // form.Shown 已经在 UI 线程上，用 async 就地 await，绝不切线程。
        form.Shown += async delegate
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, webviewDir, null);
                await webView.EnsureCoreWebView2Async(env);
                if (webView.CoreWebView2 != null)
                {
                    webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                    webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                    // 外部链接不在 Planora 窗口里乱跳：交给系统默认程序，本窗口只管应用本身
                    webView.CoreWebView2.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs e)
                    {
                        e.Handled = true;
                        try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch (Exception) { }
                    };
                }
                webView.CoreWebView2.Navigate(url);
                Log("WebView2 窗口已就绪，导航到 " + url);
            }
            catch (Exception ex)
            {
                Log("WebView2 初始化失败：" + ex.Message);
                WebViewFallback(url, ex);
            }
        };

        Application.Run(form);

        // Application.Run 返回 = 窗口已关闭。确保 WebView2 及其浏览器子进程收干净。
        try { webView.Dispose(); } catch (Exception) { }
    }

    // 万一这台机器没装 WebView2 运行时：不让用户卡死，退回系统默认浏览器并说清楚原因。
    private static void WebViewFallback(string url, Exception ex)
    {
        Log("回退到系统浏览器打开 " + url);
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception) { }
        MessageBox.Show(
            "这台电脑缺少 WebView2 运行时，Planora 已改用系统默认浏览器打开：\n" + url +
            "\n\n想要 Planora 的独立窗口，请安装「Microsoft Edge WebView2 Runtime」。\n（" +
            (ex == null ? "未知错误" : ex.Message) + "）",
            DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    /** 把已经在运行的那个 Planora 窗口叫到前台。 */
    private static void ActivateExistingInstance()
    {
        try
        {
            Process self = Process.GetCurrentProcess();
            foreach (Process p in Process.GetProcessesByName(self.ProcessName))
            {
                if (p.Id == self.Id) continue;
                IntPtr hwnd = p.MainWindowHandle;
                if (hwnd != IntPtr.Zero)
                {
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                    Log("已有实例在运行，把窗口 " + p.Id + " 叫到前台");
                    return;
                }
            }
        }
        catch (Exception) { }
    }

    private const int SW_RESTORE = 9;
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    /* ---------------- 数据文件 ---------------- */

    private static string ResolveDataDir()
    {
        string fromEnv = null;
        try { fromEnv = Environment.GetEnvironmentVariable("PLANORA_DATA_DIR"); } catch (Exception) { }
        if (!string.IsNullOrEmpty(fromEnv)) return fromEnv;

        string preferred = Path.Combine(appDir, "data");
        if (EnsureWritable(preferred)) return preferred;

        // 绿色版被放进只读目录（光盘、Program Files 且没权限）时，退到用户目录，程序仍然可用。
        string fallback = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            DisplayName, "data");
        if (EnsureWritable(fallback)) return fallback;
        return preferred;
    }

    // WebView2 的用户配置目录（浏览器 profile / 缓存），跟计划数据无关，绝不放 planora.json。
    // 放在程序目录下的 .webview2；只读目录时退到用户目录。
    private static string ResolveWebViewDir()
    {
        string preferred = Path.Combine(appDir, ".webview2");
        if (EnsureWritable(preferred)) return preferred;
        string fallback = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            DisplayName, "webview2");
        EnsureWritable(fallback);
        return fallback;
    }

    private static bool EnsureWritable(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            string probe = Path.Combine(dir, "__planora_probe__.tmp");
            File.WriteAllText(probe, "ok", new UTF8Encoding(false));
            File.Delete(probe);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static string ReadAllText(string path)
    {
        return File.ReadAllText(path, new UTF8Encoding(false));
    }

    /** 读出全部键值；文件不存在就是空档。损坏时隔离备份，绝不让坏文件把程序卡死。 */
    private static Dictionary<string, string> ReadKeys(out string warning, bool quarantine)
    {
        warning = null;
        Dictionary<string, string> keys = new Dictionary<string, string>();
        lock (DataGate)
        {
            if (!File.Exists(storePath)) return keys;
            string raw;
            try { raw = ReadAllText(storePath); }
            catch (Exception ex) { warning = "数据文件读不出来：" + ex.Message; return keys; }
            if (raw.Trim().Length == 0) return keys;
            try
            {
                Dictionary<string, object> doc = Json.DeserializeObject(raw) as Dictionary<string, object>;
                if (doc == null || !doc.ContainsKey("keys")) throw new Exception("缺少 keys 字段");
                Dictionary<string, object> src = doc["keys"] as Dictionary<string, object>;
                if (src == null) throw new Exception("keys 不是对象");
                foreach (KeyValuePair<string, object> pair in src)
                {
                    string value = pair.Value as string;
                    if (value != null) keys[pair.Key] = value;
                }
                return keys;
            }
            catch (Exception ex)
            {
                if (quarantine)
                {
                    try { File.Move(storePath, storePath + ".corrupt-" + DateTime.Now.ToString("yyyyMMddHHmmss")); }
                    catch (Exception) { }
                    warning = "数据文件损坏，已另存为 .corrupt 备份（" + ex.Message + "）";
                }
                else
                {
                    warning = "数据文件损坏（" + ex.Message + "）";
                }
                return keys;
            }
        }
    }

    /** 写盘：临时文件 -> 原子替换 -> 上一版留成 .bak。 */
    private static void WriteKeys(Dictionary<string, string> keys, out string savedAt, out int bytes)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("{\r\n  \"format\": ").Append(Json.Serialize(StoreFormat));
        sb.Append(",\r\n  \"app\": ").Append(Json.Serialize(AppId));
        sb.Append(",\r\n  \"version\": ").Append(Json.Serialize(Version));
        savedAt = DateTime.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
        sb.Append(",\r\n  \"savedAt\": ").Append(Json.Serialize(savedAt));
        sb.Append(",\r\n  \"keys\": {");
        bool first = true;
        foreach (KeyValuePair<string, string> pair in keys)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append("\r\n    ").Append(Json.Serialize(pair.Key)).Append(": ").Append(Json.Serialize(pair.Value));
        }
        sb.Append("\r\n  }\r\n}\r\n");
        string text = sb.ToString();
        bytes = Encoding.UTF8.GetByteCount(text);
        if (bytes > MaxBodyBytes) throw new Exception("数据超过 " + MaxBodyBytes + " 字节");

        lock (DataGate)
        {
            Directory.CreateDirectory(dataDir);
            string tmp = storePath + ".tmp";
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            if (File.Exists(storePath))
            {
                try
                {
                    File.Replace(tmp, storePath, storePath + ".bak", true);
                }
                catch (Exception)
                {
                    File.Delete(storePath);
                    File.Move(tmp, storePath);
                }
            }
            else
            {
                File.Move(tmp, storePath);
            }
        }
    }

    /* ---------------- 端口 ---------------- */

    private static TcpListener TryListen(int candidate)
    {
        try
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, candidate);
            listener.Start();
            return listener;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(dataDir);
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 64 * 1024) File.Delete(logPath);
            File.AppendAllText(logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + "\r\n",
                new UTF8Encoding(false));
        }
        catch (Exception)
        {
        }
    }

    /* ---------------- HTTP ---------------- */

    private static void AcceptLoop(TcpListener listener)
    {
        while (serverRunning)
        {
            bool hasPending = false;
            try
            {
                hasPending = listener.Pending();
            }
            catch (Exception)
            {
                if (!serverRunning) break;
                Thread.Sleep(200);
                continue;
            }
            if (hasPending)
            {
                TcpClient client = null;
                try { client = listener.AcceptTcpClient(); }
                catch (Exception)
                {
                    if (!serverRunning) break;
                    Thread.Sleep(50);
                    continue;
                }
                ThreadPool.QueueUserWorkItem(delegate (object state) { HandleClient((TcpClient)state); }, client);
                continue;
            }
            Thread.Sleep(120);
        }
    }

    private static void HandleClient(TcpClient client)
    {
        try
        {
            client.ReceiveTimeout = 8000;
            client.SendTimeout = 8000;
            using (NetworkStream stream = client.GetStream())
            {
                string requestLine;
                Dictionary<string, string> headers = ReadHeaders(stream, out requestLine);
                if (requestLine == null) return;

                string[] parts = requestLine.Split(' ');
                string method = parts.Length > 0 ? parts[0].ToUpperInvariant() : "";
                string target = parts.Length > 1 ? parts[1] : "/";
                string path = NormalizePath(target);
                bool isProbe = target.IndexOf("probe=1", StringComparison.Ordinal) >= 0;
                if (!isProbe && path.IndexOf("/api/", StringComparison.Ordinal) != 0) Log(method + " " + path);

                int length = 0;
                string rawLength;
                if (headers.TryGetValue("content-length", out rawLength)) int.TryParse(rawLength, out length);
                if (length < 0 || length > MaxBodyBytes) { WriteText(stream, 413, "请求体过大"); return; }
                byte[] body = length > 0 ? ReadExactly(stream, length) : new byte[0];

                Route(stream, method, path, body);
            }
        }
        catch (Exception)
        {
        }
        finally
        {
            try { client.Close(); } catch (Exception) { }
        }
    }

    private static void Route(NetworkStream stream, string method, string path, byte[] body)
    {
        if (path == "/api/ping") { WriteJson(stream, 200, PingJson()); return; }
        if (path == "/api/bye") { WriteJson(stream, 200, "{\"ok\":true}"); return; }
        if (path == "/api/store")
        {
            if (method == "GET")
            {
                WriteJson(stream, 200, StoreJson());
                return;
            }
            if (method == "PUT" || method == "POST")
            {
                int status;
                string json = SaveJson(body, out status);
                WriteJson(stream, status, json);
                return;
            }
            WriteJson(stream, 405, "{\"ok\":false,\"error\":\"不支持的方法\"}");
            return;
        }
        if (path == "/" || path == "/index.html" || path == "/Planora.html")
        {
            if (!File.Exists(htmlPath)) { WriteText(stream, 404, "404 Not Found"); return; }
            string html = InjectTheme(ReadAllText(htmlPath));
            WriteResponse(stream, 200, "text/html; charset=utf-8", Encoding.UTF8.GetBytes(html));
            return;
        }
        if (path == "/icon.ico" || path == "/favicon.ico")
        {
            if (File.Exists(iconPath)) { WriteResponse(stream, 200, "image/x-icon", File.ReadAllBytes(iconPath)); return; }
        }
        WriteText(stream, 404, "404 Not Found");
    }

    private static string PingJson()
    {
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["ok"] = true;
        payload["app"] = AppId;
        payload["version"] = Version;
        payload["port"] = port;
        payload["dataDir"] = dataDir;
        payload["path"] = storePath;
        payload["host"] = "exe";
        return Json.Serialize(payload);
    }

    private static string StoreJson()
    {
        string warning;
        Dictionary<string, string> keys = ReadKeys(out warning, true);
        string savedAt = null;
        try
        {
            if (File.Exists(storePath))
            {
                Dictionary<string, object> doc = Json.DeserializeObject(ReadAllText(storePath)) as Dictionary<string, object>;
                if (doc != null && doc.ContainsKey("savedAt")) savedAt = doc["savedAt"] as string;
            }
        }
        catch (Exception) { }
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["ok"] = true;
        payload["path"] = storePath;
        payload["dataDir"] = dataDir;
        payload["savedAt"] = savedAt;
        payload["keys"] = keys;
        payload["warning"] = warning;
        return Json.Serialize(payload);
    }

    private static string SaveJson(byte[] body, out int status)
    {
        status = 400;
        string text = Encoding.UTF8.GetString(body);
        Dictionary<string, object> doc;
        try
        {
            doc = Json.DeserializeObject(text) as Dictionary<string, object>;
        }
        catch (Exception ex)
        {
            return ErrorJson("请求体不是合法 JSON：" + ex.Message);
        }
        if (doc == null || !doc.ContainsKey("keys")) return ErrorJson("缺少 keys 对象");
        Dictionary<string, object> src = doc["keys"] as Dictionary<string, object>;
        if (src == null) return ErrorJson("keys 必须是对象");

        Dictionary<string, string> keys = new Dictionary<string, string>();
        foreach (KeyValuePair<string, object> pair in src)
        {
            string value = pair.Value as string;
            if (value == null) return ErrorJson("值必须是字符串：" + pair.Key);
            keys[pair.Key] = value;
        }
        try
        {
            string savedAt;
            int bytes;
            WriteKeys(keys, out savedAt, out bytes);
            status = 200;
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["ok"] = true;
            payload["path"] = storePath;
            payload["savedAt"] = savedAt;
            payload["bytes"] = bytes;
            return Json.Serialize(payload);
        }
        catch (Exception ex)
        {
            Log("写入失败：" + ex.Message);
            status = 500;
            return ErrorJson("写入失败：" + ex.Message);
        }
    }

    private static string ErrorJson(string message)
    {
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["ok"] = false;
        payload["error"] = message;
        return Json.Serialize(payload);
    }

    /** 页面的深浅色偏好存在数据文件里，服务端顺手写进 <html>，省掉一次闪白。 */
    private static string InjectTheme(string html)
    {
        try
        {
            string warning;
            Dictionary<string, string> keys = ReadKeys(out warning, false);
            string rawView;
            if (!keys.TryGetValue(ViewKey, out rawView) || string.IsNullOrEmpty(rawView)) return html;
            Dictionary<string, object> view = Json.DeserializeObject(rawView) as Dictionary<string, object>;
            if (view == null || !view.ContainsKey("theme")) return html;
            string theme = view["theme"] as string;
            if (theme != "day" && theme != "night") return html;   // auto 交给页面按系统偏好判断
            return html.Replace("<html lang=\"zh-CN\" data-theme=\"day\">",
                "<html lang=\"zh-CN\" data-theme=\"" + theme + "\">");
        }
        catch (Exception)
        {
            return html;
        }
    }

    private static string NormalizePath(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "/";
        int query = raw.IndexOf('?');
        if (query >= 0) raw = raw.Substring(0, query);
        try { raw = Uri.UnescapeDataString(raw); } catch (Exception) { }
        if (raw.Length == 0 || raw[0] != '/') raw = "/" + raw;
        return raw;
    }

    private static Dictionary<string, string> ReadHeaders(NetworkStream stream, out string requestLine)
    {
        requestLine = null;
        Dictionary<string, string> headers = new Dictionary<string, string>();
        int total = 0;
        string line = ReadLine(stream, ref total);
        if (line == null) return headers;
        requestLine = line.Trim();
        while (true)
        {
            line = ReadLine(stream, ref total);
            if (line == null || line.Length == 0) break;
            int colon = line.IndexOf(':');
            if (colon > 0)
            {
                string key = line.Substring(0, colon).Trim().ToLowerInvariant();
                string value = line.Substring(colon + 1).Trim();
                headers[key] = value;
            }
        }
        return headers;
    }

    private static string ReadLine(NetworkStream stream, ref int total)
    {
        using (MemoryStream buffer = new MemoryStream())
        {
            int b = -1;
            while ((b = stream.ReadByte()) >= 0)
            {
                total++;
                if (total > MaxHeaderBytes) return null;
                if (b == 10) break;
                if (b != 13) buffer.WriteByte((byte)b);
            }
            if (b < 0 && buffer.Length == 0) return null;
            return Encoding.UTF8.GetString(buffer.ToArray());
        }
    }

    private static byte[] ReadExactly(NetworkStream stream, int length)
    {
        byte[] data = new byte[length];
        int read = 0;
        while (read < length)
        {
            int n = stream.Read(data, read, length - read);
            if (n <= 0) break;
            read += n;
        }
        if (read == length) return data;
        byte[] shorter = new byte[read];
        Array.Copy(data, shorter, read);
        return shorter;
    }

    private static void WriteJson(NetworkStream stream, int status, string json)
    {
        WriteResponse(stream, status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
    }

    private static void WriteText(NetworkStream stream, int status, string text)
    {
        WriteResponse(stream, status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text));
    }

    private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body)
    {
        StringBuilder head = new StringBuilder();
        head.Append("HTTP/1.1 ").Append(status).Append(' ').Append(Reason(status)).Append("\r\n");
        head.Append("Content-Type: ").Append(contentType).Append("\r\n");
        head.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        head.Append("Cache-Control: no-store\r\n");
        head.Append("Connection: close\r\n\r\n");
        byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
        stream.Write(headBytes, 0, headBytes.Length);
        if (body.Length > 0) stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static string Reason(int status)
    {
        switch (status)
        {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 413: return "Payload Too Large";
            case 500: return "Internal Server Error";
            default: return "OK";
        }
    }
}
