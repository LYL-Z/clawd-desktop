using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Local, read-only foreground metadata probe. It does not inject into other
// processes, inspect pixels, or read process memory.
class WindowProbe {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT monitor; public RECT work; public uint flags; }
  sealed class Rule { public string Id; public string Match; public string Name; public string Path; }
  static readonly object ruleLock=new object();
  static List<Rule> rules=new List<Rule>();

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint processId);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h,ref MONITORINFO m);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int count);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll",EntryPoint="SetProcessDpiAwarenessContext",SetLastError=true)] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll",EntryPoint="SetProcessDPIAware",SetLastError=true)] static extern bool SetProcessDPIAware();

  const uint PROCESS_QUERY_LIMITED_INFORMATION=0x1000;
  static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2=new IntPtr(-4);

  static string Decode(string value) { return Encoding.UTF8.GetString(Convert.FromBase64String(value)); }
  static List<Rule> ParseRules(string encoded) {
    var result=new List<Rule>();
    string decoded;
    try { decoded=Decode(encoded); } catch { return result; }
    foreach(string line in decoded.Split(new[]{'\n'},StringSplitOptions.RemoveEmptyEntries)) {
      string[] parts=line.Split('|');
      if(parts.Length!=4||parts[0].Length==0||parts[0].Length>64) continue;
      if(parts[1]!="path"&&parts[1]!="name") continue;
      if(parts[2].Length==0||parts[2].Length>260||parts[3].Length>32760) continue;
      result.Add(new Rule{Id=parts[0],Match=parts[1],Name=parts[2],Path=parts[3]});
      if(result.Count>=64) break;
    }
    return result;
  }

  static void ReadRuleUpdates() {
    try {
      string line;
      while((line=Console.ReadLine())!=null) {
        if(!line.StartsWith("rules:",StringComparison.Ordinal)||line.Length>180000) continue;
        List<Rule> replacement=ParseRules(line.Substring(6));
        lock(ruleLock) rules=replacement;
      }
    } catch { /* Stdin closure is normal when the parent exits. */ }
  }

  static string ImagePath(uint processId) {
    if(processId==0) return null;
    IntPtr process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,processId);
    if(process==IntPtr.Zero) return null;
    try {
      var buffer=new StringBuilder(32768);uint size=(uint)buffer.Capacity;
      return QueryFullProcessImageName(process,0,buffer,ref size)?buffer.ToString():null;
    } finally { CloseHandle(process); }
  }

  static bool IsFullscreen(IntPtr window,string className) {
    if(window==IntPtr.Zero||className=="Progman"||className=="WorkerW"||className=="Shell_TrayWnd"||className=="Shell_SecondaryTrayWnd") return false;
    RECT rect;var monitor=new MONITORINFO();monitor.cbSize=Marshal.SizeOf(typeof(MONITORINFO));
    if(!GetWindowRect(window,out rect)) return false;
    IntPtr monitorHandle=MonitorFromWindow(window,2);
    if(monitorHandle==IntPtr.Zero||!GetMonitorInfo(monitorHandle,ref monitor)) return false;
    // One physical pixel of tolerance accommodates DWM's invisible resize border.
    return rect.Left<=monitor.monitor.Left+1&&rect.Top<=monitor.monitor.Top+1&&rect.Right>=monitor.monitor.Right-1&&rect.Bottom>=monitor.monitor.Bottom-1;
  }

  static HashSet<string> RunningRules(List<Rule> rules) {
    var result=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach(Rule rule in rules) {
      string processName=System.IO.Path.GetFileNameWithoutExtension(rule.Name);
      if(processName.Length==0) continue;
      Process[] processes;
      try { processes=Process.GetProcessesByName(processName); } catch { continue; }
      foreach(Process process in processes) {
        try {
          if(rule.Match=="name") { result.Add(rule.Id); break; }
          // Reuse the low-privilege image-path query used for the foreground
          // window; Process.MainModule can fail when VM_READ access is denied.
          string image=ImagePath((uint)process.Id);
          if(!String.IsNullOrEmpty(image)&&String.Equals(System.IO.Path.GetFullPath(image),System.IO.Path.GetFullPath(rule.Path),StringComparison.OrdinalIgnoreCase)) { result.Add(rule.Id); break; }
        } catch { /* Access denied or a process that exited is an unknown, non-match. */ }
        finally { process.Dispose(); }
      }
    }
    return result;
  }

  static string Escape(string value) {
    if(value==null) return "null";
    var result=new StringBuilder(value.Length+2);result.Append('"');
    foreach(char ch in value) {
      switch(ch) {
        case '"': result.Append("\\\"");break;
        case '\\': result.Append("\\\\");break;
        case '\b': result.Append("\\b");break;
        case '\f': result.Append("\\f");break;
        case '\n': result.Append("\\n");break;
        case '\r': result.Append("\\r");break;
        case '\t': result.Append("\\t");break;
        default: if(ch<32) result.Append("\\u").Append(((int)ch).ToString("x4"));else result.Append(ch);break;
      }
    }
    return result.Append('"').ToString();
  }

  static void Main(string[] args) {
    bool dpiSet=false;
    try { dpiSet=SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
    catch { }
    if(!dpiSet) try { SetProcessDPIAware(); } catch { }
    var configThread=new Thread(ReadRuleUpdates);configThread.IsBackground=true;configThread.Start();
    var running=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long lastProcessScan=0;long sequence=0;
    int ownPid=Process.GetCurrentProcess().Id;
    while(true) {
      try {
        long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        IntPtr window=GetForegroundWindow();uint pid;GetWindowThreadProcessId(window,out pid);
        var classBuffer=new StringBuilder(256);GetClassName(window,classBuffer,classBuffer.Capacity);string className=classBuffer.ToString();
        string image=pid==(uint)ownPid?null:ImagePath(pid);string name=String.IsNullOrEmpty(image)?null:System.IO.Path.GetFileName(image);
        if(now-lastProcessScan>=1000) { List<Rule> currentRules;lock(ruleLock)currentRules=new List<Rule>(rules);running=RunningRules(currentRules);lastProcessScan=now; }
        bool down=(GetAsyncKeyState(1)&0x8000)!=0,full=IsFullscreen(window,className);
        sequence++;
        var ids=new List<string>(running);ids.Sort(StringComparer.Ordinal);
        Console.Write("{{\"schemaVersion\":1,\"type\":\"sample\",\"sequence\":{0},\"timestamp\":{1},\"foregroundPid\":{2},\"foregroundName\":{3},\"foregroundPath\":{4},\"fullscreen\":{5},\"mouseDown\":{6},\"runningRuleIds\":[",
          sequence,now,pid==0?"null":pid.ToString(),Escape(name),Escape(image),full?"true":"false",down?"true":"false");
        for(int i=0;i<ids.Count;i++) { if(i>0)Console.Write(",");Console.Write(Escape(ids[i])); }
        Console.WriteLine("]}");Console.Out.Flush();
      } catch(Exception error) { Console.Error.WriteLine("probe-sample-error:"+error.GetType().Name); }
      Thread.Sleep(250);
    }
  }
}
