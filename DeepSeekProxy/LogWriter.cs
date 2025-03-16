using System;
using System.IO;
using System.Text;

namespace DeepSeekProxy
{
    public class LogWriter : TextWriter
    {
        private readonly LogWindow logWindow;
        
        public LogWriter()
        {
            logWindow = LogWindow.Instance;
        }

        public override void WriteLine(string value)
        {
            logWindow.Log(value);
            base.WriteLine(value);
        }

        public override Encoding Encoding => Encoding.UTF8;
    }
}