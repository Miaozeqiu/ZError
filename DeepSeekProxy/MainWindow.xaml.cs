using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Navigation;
using System.Windows.Shapes;
using System.Drawing;
using Forms = System.Windows.Forms;
using System.IO; // 添加此行

namespace DeepSeekProxy
{
    public partial class MainWindow : Window
    {
        private readonly Forms.NotifyIcon notifyIcon;
        private readonly ProxyService proxyService;
        private bool isServiceRunning = false;

        public MainWindow()
        {
            InitializeComponent();
            
            proxyService = new ProxyService();
            
            // 绑定按钮事件
            StartButton.Click += StartButton_Click;
            StopButton.Click += StopButton_Click;
            
            // 自动启动服务
            try
            {
                proxyService.Start();
                isServiceRunning = true;
                StatusText.Text = "服务正在运行 - 监听地址: http://localhost:5233/";
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show($"启动服务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            
            // 初始化按钮状态
            UpdateButtonStates();
            
            // 初始化托盘图标
            notifyIcon = new Forms.NotifyIcon
            {
                Icon = new Icon(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "app.ico")),
                Text = "DeepSeek Proxy",
                Visible = true
            };

            // 双击托盘图标显示窗口
            notifyIcon.DoubleClick += (s, e) => 
            {
                this.Show();
                this.WindowState = WindowState.Normal;
                this.Activate();
            };

            // 创建右键菜单
            var contextMenu = new Forms.ContextMenuStrip();
            
            // 添加"显示窗口"选项
            var showItem = new Forms.ToolStripMenuItem("显示窗口");
            showItem.Click += (s, e) =>
            {
                this.Show();
                this.WindowState = WindowState.Normal;
                this.Activate();
            };
            contextMenu.Items.Add(showItem);
            
            // 添加分隔线
            contextMenu.Items.Add(new Forms.ToolStripSeparator());
            
            // 添加"退出"选项
            var exitItem = new Forms.ToolStripMenuItem("退出");
            exitItem.Click += (s, e) => 
            {
                proxyService.Stop();
                notifyIcon.Dispose();
                System.Windows.Application.Current.Shutdown();
            };
            contextMenu.Items.Add(exitItem);
            notifyIcon.ContextMenuStrip = contextMenu;
        }

        protected override void OnStateChanged(EventArgs e)
        {
            if (WindowState == WindowState.Minimized)
            {
                this.Hide();
            }
            base.OnStateChanged(e);
        }

        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            e.Cancel = true;
            this.Hide();
        }

        private void StartButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                proxyService.Start();
                isServiceRunning = true;
                StatusText.Text = "服务正在运行 - 监听地址: http://localhost:5233/";
                UpdateButtonStates();
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show($"启动服务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void StopButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                proxyService.Stop();
                isServiceRunning = false;
                StatusText.Text = "服务已停止";
                UpdateButtonStates();
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show($"停止服务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void UpdateButtonStates()
        {
            StartButton.IsEnabled = !isServiceRunning;
            StopButton.IsEnabled = isServiceRunning;
        }
    }
}