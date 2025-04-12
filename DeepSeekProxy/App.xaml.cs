using System;
using System.Windows;
using System.Windows.Forms;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Diagnostics; // 添加Debug命名空间
using Newtonsoft.Json.Linq; // 需要安装Newtonsoft.Json包
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox; // 使用WPF的MessageBox替代WinMessageBox

namespace DeepSeekProxy
{
    public partial class App : Application
    {
        private NotifyIcon notifyIcon;
        private const string UpdateCheckUrl = "https://zerror.netlify.app/latest_version.json"; // 替换为您的API地址

        protected override async void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            
            // 初始化托盘图标
            InitializeNotifyIcon();
            
            // 异步检查更新
            _ = CheckForUpdatesAsync();
        }

        private async Task CheckForUpdatesAsync()
        {
            try
            {
                using (var client = new HttpClient())
                {
                    var response = await client.GetStringAsync(UpdateCheckUrl);
                    var versionInfo = JObject.Parse(response);
                    var latestVersion = new Version(versionInfo["version"].ToString());
                    
                    var currentVersion = Assembly.GetExecutingAssembly().GetName().Version;
                    
                    if (latestVersion > currentVersion)
                    {
                        Application.Current.Dispatcher.Invoke(() => 
                        {
                            var result = MessageBox.Show(
                                $"发现新版本 v{latestVersion}\n\n更新内容:\n{versionInfo["changelog"]}\n\n是否立即下载更新?",
                                "发现更新",
                                MessageBoxButton.YesNo,
                                MessageBoxImage.Information);
                            
                            if (result == MessageBoxResult.Yes)
                            {
                                // 使用ProcessStartInfo确保在默认浏览器中打开
                                var psi = new ProcessStartInfo
                                {
                                    FileName = versionInfo["downloadUrl"].ToString(),
                                    UseShellExecute = true // 使用系统默认程序打开
                                };
                                System.Diagnostics.Process.Start(psi);
                            }
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"检查更新失败: {ex.Message}");
            }
        }
                private void InitializeNotifyIcon()
        {
            notifyIcon = new NotifyIcon();
            
            // 设置图标
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "app.ico");
            if (File.Exists(iconPath))
            {
                notifyIcon.Icon = new Icon(iconPath);
            }
            else
            {
                notifyIcon.Icon = System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);
            }
            
            notifyIcon.Text = "DeepSeek题库管理";
            notifyIcon.Visible = true;
            
            // 创建上下文菜单
            ContextMenuStrip contextMenu = new ContextMenuStrip();
            
            ToolStripMenuItem showItem = new ToolStripMenuItem("显示主窗口");
            showItem.Click += (s, ev) => 
            {
                MainWindow.WindowState = WindowState.Normal;
                MainWindow.Activate();
            };
            
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出");
            exitItem.Click += (s, ev) => Shutdown();
            
            contextMenu.Items.Add(showItem);
            contextMenu.Items.Add(new ToolStripSeparator());
            contextMenu.Items.Add(exitItem);
            
            notifyIcon.ContextMenuStrip = contextMenu;
            
            // 双击托盘图标显示主窗口
            notifyIcon.DoubleClick += (s, ev) => 
            {
                MainWindow.WindowState = WindowState.Normal;
                MainWindow.Activate();
            };
        }

        protected override void OnExit(ExitEventArgs e)
        {
            // 退出时释放托盘图标资源
            notifyIcon?.Dispose();
            base.OnExit(e);
        }
    }
}
