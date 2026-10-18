using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
class WindowProbe {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO m);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int count);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize;public RECT monitor;public RECT work;public uint flags; }
  static void Main() {
    SetProcessDPIAware();
    bool previousFull=false,previousDown=false;
    while(true) {
      var h=GetForegroundWindow();RECT r;var m=new MONITORINFO();m.cbSize=Marshal.SizeOf(m);
      var name=new StringBuilder(256);GetClassName(h,name,256);var shell=name.ToString();
      bool full=shell!="Progman"&&shell!="WorkerW"&&shell!="Shell_TrayWnd"&&GetWindowRect(h,out r)&&GetMonitorInfo(MonitorFromWindow(h,2),ref m)&&r.Left<=m.monitor.Left&&r.Top<=m.monitor.Top&&r.Right>=m.monitor.Right&&r.Bottom>=m.monitor.Bottom;
      bool down=(GetAsyncKeyState(1)&0x8000)!=0;
      if(full!=previousFull||down!=previousDown){Console.WriteLine((full?"1":"0")+","+(down?"1":"0"));Console.Out.Flush();previousFull=full;previousDown=down;}
      Thread.Sleep(25);
    }
  }
}
