using System.Configuration;
using System.Data;
using System.Windows;
using System.Windows.Media.Imaging;

namespace DeepSeekProxy
{
    /// <summary>
    /// Interaction logic for App.xaml
    /// </summary>
    public partial class App : System.Windows.Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            
            // 设置任务栏图标
            var iconUri = new System.Uri("pack://application:,,,/Resources/app.ico");
            this.Resources.Add("AppIcon", BitmapFrame.Create(iconUri));
        }
    }
}
