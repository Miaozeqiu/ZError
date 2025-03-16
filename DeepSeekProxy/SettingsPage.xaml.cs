using System;
using System.Windows;
using System.Windows.Controls;
using System.Diagnostics; // 添加此引用用于启动浏览器

namespace DeepSeekProxy
{
    public partial class SettingsPage : Page
    {
        private readonly ProxyService proxyService;
        
        public SettingsPage(ProxyService service)
        {
            InitializeComponent();
            proxyService = service;
            
            // 加载当前的 API 密钥
            DeepseekApiKeyTextBox.Text = proxyService.GetApiKey(0);
            AliyunApiKeyTextBox.Text = proxyService.GetApiKey(1);
            SiliconFlowApiKeyTextBox.Text = proxyService.GetApiKey(2);
            
            // 绑定按钮事件
            SaveAllApiKeysButton.Click += SaveAllApiKeysButton_Click;
            GetApiKeyButton.Click += GetApiKeyButton_Click; // 添加新按钮事件
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