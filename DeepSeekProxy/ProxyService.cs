using System.Net;
using System.Text;
using System.Net.Http;
using System.IO;  // 添加此行

namespace DeepSeekProxy
{
    public class ProxyService
    {
        private readonly HttpListener listener;
        private readonly string proxyUrl = "https://api.deepseek.com/v1/chat/completions";
        private bool isRunning;
        
        public ProxyService()
        {
            listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:5233/");
        }

        public void Start()
        {
            if (!isRunning)
            {
                listener.Start();
                isRunning = true;
                Task.Run(HandleRequests);
            }
        }

        public void Stop()
        {
            if (isRunning)
            {
                isRunning = false;
                listener.Stop();
            }
        }

        private async Task HandleRequests()
        {
            while (isRunning)
            {
                try
                {
                    var context = await listener.GetContextAsync();
                    _ = ProcessRequestAsync(context);
                }
                catch (HttpListenerException)
                {
                    if (isRunning) throw;
                }
            }
        }

        private async Task ProcessRequestAsync(HttpListenerContext context)
        {
            try
            {
                // Add CORS headers
                context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");
                context.Response.Headers.Add("Access-Control-Max-Age", "86400");

                // Handle OPTIONS
                if (context.Request.HttpMethod.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.StatusCode = 200;
                    context.Response.Close();
                    return;
                }

                // Read request body
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream))
                {
                    requestBody = await reader.ReadToEndAsync();
                }

                // Validate request body
                if (string.IsNullOrEmpty(requestBody))
                {
                    throw new Exception("Request body is empty");
                }

                // Ensure messages field exists
                try
                {
                    using var document = System.Text.Json.JsonDocument.Parse(requestBody);
                    var root = document.RootElement;
                    
                    // Check if model field exists, if not create new JSON with model field
                    if (!root.TryGetProperty("model", out _))
                    {
                        var jsonObj = new
                        {
                            model = "deepseek-chat",
                            messages = root.GetProperty("messages"),
                            stream = true
                        };
                        requestBody = System.Text.Json.JsonSerializer.Serialize(jsonObj);
                    }
                }
                catch (System.Text.Json.JsonException)
                {
                    throw new Exception("Invalid JSON format in request body");
                }
                
                Console.WriteLine($"Modified Request Body: {requestBody}"); // Log modified request
                Console.WriteLine($"Request Body: {requestBody}"); // Log request

                using (var client = new HttpClient())
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, proxyUrl)
                    {
                        Content = new StringContent(requestBody, Encoding.UTF8, "application/json")
                    };
                    
                    // 复制请求头并确保设置流式传输
                    foreach (string headerName in context.Request.Headers.Keys)
                    {
                        if (headerName.ToLower() != "host")
                        {
                            request.Headers.TryAddWithoutValidation(headerName, context.Request.Headers[headerName]);
                        }
                    }
                    
                    context.Response.ContentType = "text/event-stream";
                    context.Response.Headers.Add("Cache-Control", "no-cache");
                    context.Response.Headers.Add("Connection", "keep-alive");

                    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                    context.Response.StatusCode = (int)response.StatusCode;
                    
                    using var stream = await response.Content.ReadAsStreamAsync();
                    using var reader = new StreamReader(stream);
                    
                    string? line;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        if (!string.IsNullOrEmpty(line))
                        {
                            // 确保每条消息都有正确的 SSE 格式
                            if (!line.StartsWith("data: "))
                            {
                                line = "data: " + line;
                            }
                            var bytes = Encoding.UTF8.GetBytes(line + "\n\n");
                            await context.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
                            await context.Response.OutputStream.FlushAsync();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}"); // Log error
                context.Response.StatusCode = 500;
                var buffer = Encoding.UTF8.GetBytes($"{{\"error\": \"{ex.Message}\"}}");
                await context.Response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
            }
            finally
            {
                context.Response.Close();
            }
        }
    }
}