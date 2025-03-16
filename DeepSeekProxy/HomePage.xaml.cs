using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DeepSeekProxy
{
    public partial class HomePage : Page
    {
        private ProxyService proxyService;
        
        public HomePage(ProxyService proxyService)
        {
            InitializeComponent();
            this.proxyService = proxyService;
            
            // 设置ComboBox选择变更事件
            ApiProviderComboBox.SelectionChanged += ApiProviderComboBox_SelectionChanged;
            
            // 根据当前API类型设置ComboBox的选中项
            SetComboBoxSelectionByApiType();
            
            // 设置按钮事件
            StartButton.Click += StartButton_Click;
            StopButton.Click += StopButton_Click;
            
            // 根据服务状态设置按钮状态
            UpdateButtonStates();
        }
        
        // 添加一个方法来根据当前API类型设置ComboBox的选中项
        private void SetComboBoxSelectionByApiType()
        {
            int apiType = proxyService.GetApiType();
            if (ApiProviderComboBox.Items.Count > apiType)
            {
                ApiProviderComboBox.SelectedIndex = apiType;
            }
        }
        
        private void UpdateButtonStates()
        {
            if (proxyService.IsRunning)
            {
                StatusText.Text = "服务已启动";
                StatusText.Foreground = System.Windows.Application.Current.Resources["SuccessBrush"] as System.Windows.Media.Brush;
                StartButton.IsEnabled = false;
                StopButton.IsEnabled = true;
            }
            else
            {
                StatusText.Text = "服务未启动";
                StatusText.Foreground = System.Windows.Application.Current.Resources["DangerBrush"] as System.Windows.Media.Brush;
                StartButton.IsEnabled = true;
                StopButton.IsEnabled = false;
            }
        }

        private void StartButton_Click(object sender, RoutedEventArgs e)
        {
            // 启动服务的逻辑
            string result = proxyService.Start();
            
            if (result == "服务已成功启动" || result == "服务已在运行中")
            {
                // 更新状态文本，显示当前使用的API
                UpdateStatusText();
                
                // 禁用启动按钮，启用停止按钮
                StartButton.IsEnabled = false;
                StopButton.IsEnabled = true;
            }
            else
            {
                StatusText.Text = result;
                StatusText.Foreground = System.Windows.Application.Current.Resources["DangerBrush"] as System.Windows.Media.Brush;
            }
        }

        private void StopButton_Click(object sender, RoutedEventArgs e)
        {
            // 停止服务的逻辑
            string result = proxyService.Stop();
            StatusText.Text = result;
            StatusText.Foreground = System.Windows.Application.Current.Resources["DangerBrush"] as System.Windows.Media.Brush;
            
            // 启用启动按钮，禁用停止按钮
            StartButton.IsEnabled = true;
            StopButton.IsEnabled = false;
        }

        private void ApiProviderComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // 获取选中的API提供商
            ComboBoxItem selectedItem = ApiProviderComboBox.SelectedItem as ComboBoxItem;
            if (selectedItem != null)
            {
                string selectedApi = selectedItem.Content.ToString();
                // 根据选择的API执行相应的逻辑
                switch (selectedApi)
                {
                    case "DeepSeek 官方 API":
                        proxyService.SetApiType(0);
                        break;
                    case "阿里云百炼 API":
                        proxyService.SetApiType(1);
                        break;
                    case "硅基流动 API":
                        proxyService.SetApiType(2);
                        break;
                }
                
                // 如果服务正在运行，更新状态文本显示当前使用的API
                if (proxyService.IsRunning)
                {
                    UpdateStatusText();
                }
            }
        }
        
        // 更新状态文本，显示当前使用的API
        private void UpdateStatusText()
        {
            string apiName = "未知";
            switch (proxyService.GetApiType())
            {
                case 0:
                    apiName = "DeepSeek 官方";
                    break;
                case 1:
                    apiName = "阿里云百炼";
                    break;
                case 2:
                    apiName = "硅基流动";
                    break;
            }
            
            StatusText.Text = $"服务已启动，当前使用 {apiName} API";
            StatusText.Foreground = System.Windows.Application.Current.Resources["SuccessBrush"] as System.Windows.Media.Brush;
        }
    }
}