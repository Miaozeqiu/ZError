using System;
using System.Windows;
using Application = System.Windows.Application;

namespace DeepSeekProxy
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            
            // 重定向控制台输出
            Console.SetOut(new LogWriter());
            
            // 显示日志窗口
            //LogWindow.Instance.Show();
        }
    }
}
