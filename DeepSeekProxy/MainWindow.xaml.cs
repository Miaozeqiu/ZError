using System;
using System.Windows;
using System.Windows.Controls;
using System.Drawing; // 用于托盘图标
using System.Windows.Forms; // 用于 NotifyIcon
using System.Windows.Interop; // 用于窗口句柄

namespace DeepSeekProxy
{
    public partial class MainWindow : Window
    {
        private NotifyIcon notifyIcon;
        private ProxyService proxyService; // 添加 ProxyService 变量声明
        private HomePage homePage; // 添加 HomePage 变量声明
        private SettingsPage settingsPage; // 添加 SettingsPage 变量声明

        public MainWindow()
        {
            InitializeComponent();
            
            // 初始化代理服务
            proxyService = new ProxyService();
            
            // 初始化页面
            homePage = new HomePage(proxyService);
            settingsPage = new SettingsPage(proxyService);
            
            // 设置默认页面
            MainFrame.Content = homePage;
            
            // 初始化托盘图标
            InitializeNotifyIcon();
            
            // 添加窗口关闭事件处理程序
            this.Closing += MainWindow_Closing;
            
            // 添加导航按钮点击事件
            HomeButton.Click += HomeButton_Click;
            SettingsButton.Click += SettingsButton_Click;
        }
        
        // 添加首页按钮点击事件处理方法
        private void HomeButton_Click(object sender, RoutedEventArgs e)
        {
            MainFrame.Content = homePage;
        }
        
        // 添加设置按钮点击事件处理方法
        private void SettingsButton_Click(object sender, RoutedEventArgs e)
        {
            MainFrame.Content = settingsPage;
        }
        
        private void InitializeNotifyIcon()
        {
            notifyIcon = new NotifyIcon();
            
            // 设置托盘图标
            // 注意：需要在项目中添加一个图标文件，并确保其属性设置为"内容"且"复制到输出目录"设为"如果较新则复制"
            notifyIcon.Icon = new Icon(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "app.ico"));
            notifyIcon.Visible = true;
            notifyIcon.Text = "在浙学网课增强助手";
            
            // 创建托盘图标的上下文菜单
            ContextMenuStrip contextMenu = new ContextMenuStrip();
            
            // 添加"显示窗口"菜单项
            ToolStripMenuItem showMenuItem = new ToolStripMenuItem("显示窗口");
            showMenuItem.Click += ShowMenuItem_Click;
            contextMenu.Items.Add(showMenuItem);
            
            // 添加分隔线
            contextMenu.Items.Add(new ToolStripSeparator());
            
            // 添加"退出"菜单项
            ToolStripMenuItem exitMenuItem = new ToolStripMenuItem("退出");
            exitMenuItem.Click += ExitMenuItem_Click;
            contextMenu.Items.Add(exitMenuItem);
            
            // 设置托盘图标的上下文菜单
            notifyIcon.ContextMenuStrip = contextMenu;
            
            // 双击托盘图标显示窗口
            notifyIcon.DoubleClick += NotifyIcon_DoubleClick;
        }
        
        private void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // 窗口加载完成后的处理
        }
        
        // 合并两个 MainWindow_Closing 方法的功能
        private void MainWindow_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
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
            // 显示窗口
            this.Show();
            this.WindowState = WindowState.Normal;
            this.Activate();
        }
        
        private void ExitMenuItem_Click(object sender, EventArgs e)
        {
            // 保存当前选择的API
            proxyService.SaveLastSelectedApi();
            // 保存 API 密钥
            proxyService.SaveApiKeysToConfig();
            
            // 退出应用程序
            notifyIcon.Dispose();
            System.Windows.Application.Current.Shutdown();
        }
        
        private void NotifyIcon_DoubleClick(object sender, EventArgs e)
        {
            // 双击托盘图标显示窗口
            ShowMenuItem_Click(sender, e);
        }
    }
}