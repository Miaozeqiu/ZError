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
                }
                return instance;
            }
        }

        private LogWindow()
        {
            InitializeComponent();
            
            // 窗口关闭时只隐藏不销毁
            this.Closing += (s, e) =>
            {
                e.Cancel = true;
                this.Hide();
            };
        }

        public void Log(string message)
        {
            // 确保在UI线程上执行
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.Invoke(() => Log(message));
                return;
            }

            LogTextBox.AppendText($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} - {message}\n");
            LogTextBox.ScrollToEnd();
        }
    }
}