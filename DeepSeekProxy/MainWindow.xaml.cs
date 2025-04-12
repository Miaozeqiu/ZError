using System;
using System.Windows;
using System.Windows.Controls;
using DrawingColor = System.Drawing.Color; // 使用别名
using System.Windows.Forms; // 用于 NotifyIcon
using System.Windows.Interop; // 用于窗口句柄
using System.Windows.Media; // 用于颜色

namespace DeepSeekProxy
{
    public partial class MainWindow : Window
    {
        private NotifyIcon notifyIcon;
        private ProxyService proxyService; // 添加 ProxyService 变量声明
        private HomePage homePage; // 添加 HomePage 变量声明
        private SettingsPage settingsPage; // 添加 SettingsPage 变量声明

        // 添加导航按钮高亮颜色 - 修复 Color 引用不明确的问题
        private SolidColorBrush activeButtonBrush = new SolidColorBrush(System.Windows.Media.Color.FromRgb(255, 255, 255));
        private SolidColorBrush inactiveButtonBrush = new SolidColorBrush(System.Windows.Media.Colors.Transparent);
        private SolidColorBrush activeBorderBrush = new SolidColorBrush(System.Windows.Media.Color.FromRgb(241, 241, 241));

        public MainWindow()
        {
            InitializeComponent();

            // 初始化日志窗口（但不显示）
            var logWindow = LogWindow.Instance;
            // logWindow.Hide();

            // 初始化 ProxyService
            proxyService = new ProxyService();

            // 初始化页面
            homePage = new HomePage(proxyService);
            settingsPage = new SettingsPage(proxyService);

            // 设置默认页面
            MainFrame.Content = homePage;


            // 添加窗口关闭事件处理程序
            this.Closing += MainWindow_Closing;

            // 添加导航按钮点击事件
            HomeButton.Click += HomeButton_Click;
            SettingsButton.Click += SettingsButton_Click;
            QuestionsButton.Click += QuestionsButton_Click; // 添加这行

            // 设置初始高亮状态
            SetActiveButton(HomeButtonBorder);
        }

        // 添加首页按钮点击事件处理方法
        private void HomeButton_Click(object sender, RoutedEventArgs e)
        {
            MainFrame.Content = homePage;
            SetActiveButton(HomeButtonBorder);
        }

        // 添加设置按钮点击事件处理方法
        private void SettingsButton_Click(object sender, RoutedEventArgs e)
        {
            MainFrame.Content = settingsPage;
            SetActiveButton(SettingsButtonBorder);
        }

        // 设置活动按钮高亮
        private void SetActiveButton(Border activeButton)
        {
            // 重置所有按钮
            HomeButtonBorder.Background = inactiveButtonBrush;
            HomeButtonBorder.BorderThickness = new Thickness(0);
            SettingsButtonBorder.Background = inactiveButtonBrush;
            SettingsButtonBorder.BorderThickness = new Thickness(0);
            QuestionsButtonBorder.Background = inactiveButtonBrush;
            QuestionsButtonBorder.BorderThickness = new Thickness(0);

            // 设置活动按钮
            activeButton.Background = activeButtonBrush;
            activeButton.BorderBrush = activeBorderBrush;
            activeButton.BorderThickness = new Thickness(2);
        }

        private void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // 窗口加载完成后的处理
        }

        // 合并两个 MainWindow_Closing 方法的功能
        private void MainWindow_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            Console.WriteLine("MainWindow closing, hiding to tray...");
            // 保存当前选择的 API 类型
            proxyService.SaveLastSelectedApi();
            // 保存 API 密钥
            proxyService.SaveApiKeysToConfig();

            // 取消关闭操作，改为最小化到托盘
            e.Cancel = true;
            this.Hide();
        }

        private void ShowMenuItem_Click(object sender, EventArgs e)
        {
            // 显示主窗口
            this.Show();
            this.WindowState = WindowState.Normal;
            this.Activate();

            // 显示日志窗口
            var logWindow = LogWindow.Instance;
            if (!logWindow.IsVisible)
            {
                logWindow.Show();
                logWindow.Topmost = true;  // 确保窗口在最前
                logWindow.Topmost = false;  // 然后取消最前状态，使其行为正常
            }
        }

        private void ExitMenuItem_Click(object sender, EventArgs e)
        {
            // 保存当前选择的API
            proxyService.SaveLastSelectedApi();
            // 保存 API 密钥
            proxyService.SaveApiKeysToConfig();

            // 退出应用程序
            notifyIcon.Dispose();
            System.Windows.Application.Current.Shutdown(); // 使用完全限定名
        }

        private void NotifyIcon_DoubleClick(object sender, EventArgs e)
        {
            // 双击托盘图标显示窗口
            ShowMenuItem_Click(sender, e);
        }

        // 添加题库管理按钮点击事件
        private void QuestionsButton_Click(object sender, RoutedEventArgs e)
        {
            MainFrame.Navigate(new QuestionsPage());
            SetActiveButton(QuestionsButtonBorder); // 添加这行
        }

        public static void Log(string message)
        {
            System.Windows.Application.Current.Dispatcher.Invoke(() => 
            {
                try
                {
                    var logWindow = LogWindow.Instance;
                    if (!logWindow.IsVisible)
                    {
                        logWindow.Show();
                    }
                    logWindow.Log(message);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"记录日志失败: {ex.Message}");
                }
            });
        }
    }
}
