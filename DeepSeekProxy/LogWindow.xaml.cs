using System;
using System.Windows;

namespace DeepSeekProxy
{
    public partial class LogWindow : Window
    {
        private static LogWindow instance;
        
        public static LogWindow Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new LogWindow();
                    instance.Closed += (s, e) => instance = null; // 窗口关闭时释放实例
                }
                return instance;
            }
        }

        private LogWindow()
        {
            InitializeComponent();
        }

        public void Log(string message)
        {
            Dispatcher.Invoke(() => 
            {
                if (LogTextBox != null) // 添加空引用检查
                {
                    LogTextBox.AppendText(message);
                    LogTextBox.ScrollToEnd();
                }
            });
        }
    }
}