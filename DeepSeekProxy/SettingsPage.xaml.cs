using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives; // 添加这行引用 ToggleButton
using System.Windows.Media; // 添加 System.Windows.Media 命名空间引用
using MediaColor = System.Windows.Media.Color; // 添加别名以避免冲突
using System.Diagnostics;
using System.Collections.Generic;

namespace DeepSeekProxy
{
    public partial class SettingsPage : Page
    {
        private readonly ProxyService proxyService;
        private bool isInitializing = true; // 添加标志，防止初始化时触发保存
        
        public SettingsPage(ProxyService service)
        {
            InitializeComponent();
            proxyService = service;
            
            // 加载当前的 API 密钥
            DeepseekApiKeyTextBox.Text = proxyService.GetApiKey(0);
            AliyunApiKeyTextBox.Text = proxyService.GetApiKey(1);
            SiliconFlowApiKeyTextBox.Text = proxyService.GetApiKey(2);
            
            // 加载当前的路由服务状态
            LoadRouteStatus();
            
            // 设置默认路由按钮为灰色 - 使用更直接的方式
            var disabledBrush = new SolidColorBrush(MediaColor.FromRgb(180, 180, 180));
            DefaultApiRouteCheckBox.Opacity = 0.5; // 降低不透明度使其看起来更灰色
            
            // 如果上面的方法不起作用，可以尝试直接修改样式
            try {
                Style toggleStyle = new Style(typeof(System.Windows.Controls.Primitives.ToggleButton));
                toggleStyle.BasedOn = DefaultApiRouteCheckBox.Style; // 基于当前样式
                toggleStyle.Setters.Add(new Setter(System.Windows.Controls.Primitives.ToggleButton.BackgroundProperty, disabledBrush));
                DefaultApiRouteCheckBox.Style = toggleStyle;
            } catch (Exception) {
                // 如果样式修改失败，不影响程序运行
            }
            
            // 绑定按钮事件
            SaveAllApiKeysButton.Click += SaveAllApiKeysButton_Click;
            GetApiKeyButton.Click += GetApiKeyButton_Click;
            
            // 初始化完成
            isInitializing = false;
        }
        
        // 加载路由状态
        private void LoadRouteStatus()
        {
            Dictionary<string, bool> routeStatus = proxyService.GetAllRouteStatus();
            
            // 默认路由始终保持开启
            DefaultApiRouteCheckBox.IsChecked = true;
            DefaultApiRouteCheckBox.IsEnabled = false; // 禁用切换按钮
            
            if (routeStatus.ContainsKey("/query"))
                QueryRouteCheckBox.IsChecked = routeStatus["/query"];
                
            if (routeStatus.ContainsKey("/courseware"))
                CoursewareRouteCheckBox.IsChecked = routeStatus["/courseware"];
        }
        
        private void SaveAllApiKeysButton_Click(object sender, RoutedEventArgs e)
        {
            // 保存所有 API 密钥
            proxyService.SetApiKey(0, DeepseekApiKeyTextBox.Text.Trim());
            proxyService.SetApiKey(1, AliyunApiKeyTextBox.Text.Trim());
            proxyService.SetApiKey(2, SiliconFlowApiKeyTextBox.Text.Trim());
            proxyService.SaveApiKeysToConfig();
            
            System.Windows.MessageBox.Show("所有 API 密钥已保存", "成功", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        
        // 路由开关状态变化事件处理
        private void RouteToggle_Changed(object sender, RoutedEventArgs e)
        {
            // 如果是初始化阶段，不执行保存操作
            if (isInitializing) return;
            
            // 更新路由状态 - 默认路由始终为 true
            proxyService.SetRouteEnabled("/", true);
            proxyService.SetRouteEnabled("/query", QueryRouteCheckBox.IsChecked ?? true);
            proxyService.SetRouteEnabled("/courseware", CoursewareRouteCheckBox.IsChecked ?? true);
            
            // 保存路由状态到配置文件
            proxyService.SaveRouteStatusToConfig();
            
            // 可以添加一个临时提示，但不使用弹窗以免打扰用户
            Console.WriteLine("路由设置已自动保存");
        }
        
        // 添加获取API密钥按钮点击事件处理程序
        private void GetApiKeyButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                // 使用默认浏览器打开网址
                Process.Start(new ProcessStartInfo
                {
                    FileName = "https://pages.zaizhexue.top/home/GetAPIKey",
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show($"无法打开浏览器: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}