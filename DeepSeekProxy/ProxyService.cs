using System.Net;
using System.Text;
using System.Net.Http;
using System.IO;  // 添加此行
using System;
using System.Threading.Tasks;
using System.Text.Json; // 添加 JSON 处理
using ZJOOCHelper; // 添加对 ZJOOCHelper 的引用
using System.IO;
using System.Configuration;
using System.Web; // 添加对 System.Web 的引用



namespace DeepSeekProxy
{
    public class ProxyService
    {
        private readonly HttpListener listener;
        private readonly string deepseekUrl = "https://api.deepseek.com/v1/chat/completions";
        private readonly string aliyunUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
        private readonly string siliconFlowUrl = "https://api.siliconflow.cn/v1/chat/completions";
        private bool isRunning;
        private int apiType = 0; // 0: DeepSeek 官方, 1: 阿里云, 2: 硅基流动

        // 添加 CurrentApiType 属性
        public string CurrentApiType { get; set; } = "deepseek";

        // 添加 API 密钥存储
        private string deepseekApiKey = "";
        private string aliyunApiKey = "";
        private string siliconFlowApiKey = "";
        // 在类的成员变量部分
        private Dictionary<string, bool> routeEnabledStatus = new Dictionary<string, bool>();

        // 在构造函数中
        public ProxyService()
        {
            // 初始化路由状态
            InitRouteStatus();

            // 加载上次选择的 API 类型
            LoadLastSelectedApi();

            // 加载保存的 API 密钥
            LoadApiKeysFromConfig();
            listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:5233/");
        }

        // 初始化路由状态
        private void InitRouteStatus()
        {
            // 默认所有路由都启用
            routeEnabledStatus["/"] = true;        // 默认API路由
            routeEnabledStatus["/query"] = true;   // 查询路由
            routeEnabledStatus["/courseware"] = true; // 课件路由

            // 尝试从配置文件加载路由状态
            LoadRouteStatusFromConfig();
        }

        // 从配置文件加载路由状态
        private void LoadRouteStatusFromConfig()
        {
            try
            {
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "routestatus.json");
                if (File.Exists(configPath))
                {
                    string json = File.ReadAllText(configPath);
                    var loadedStatus = JsonSerializer.Deserialize<Dictionary<string, bool>>(json);
                    if (loadedStatus != null)
                    {
                        foreach (var kvp in loadedStatus)
                        {
                            routeEnabledStatus[kvp.Key] = kvp.Value;
                        }
                        Console.WriteLine("成功加载路由状态配置");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"加载路由状态配置失败: {ex.Message}");
            }
        }

        // 添加加载上次选择的 API 的方法
        public void LoadLastSelectedApi()
        {
            try
            {
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "apiconfig.json");
                if (File.Exists(configPath))
                {
                    string json = File.ReadAllText(configPath);
                    using var document = JsonDocument.Parse(json);
                    if (document.RootElement.TryGetProperty("lastApiType", out var lastApiType))
                    {
                        CurrentApiType = lastApiType.GetString() ?? "deepseek";

                        // 同时更新 apiType 整数值
                        switch (CurrentApiType.ToLower())
                        {
                            case "aliyun":
                                apiType = 1;
                                break;
                            case "siliconflow":
                                apiType = 2;
                                break;
                            default:
                                apiType = 0;
                                break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"加载上次选择的 API 失败: {ex.Message}");
                // 默认使用 DeepSeek API
                CurrentApiType = "deepseek";
                apiType = 0;
            }
        }

        // 添加保存当前选择的 API 的方法
        public void SaveLastSelectedApi()
        {
            try
            {
                // 根据当前 apiType 更新 CurrentApiType
                switch (apiType)
                {
                    case 1:
                        CurrentApiType = "aliyun";
                        break;
                    case 2:
                        CurrentApiType = "siliconflow";
                        break;
                    default:
                        CurrentApiType = "deepseek";
                        break;
                }

                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "apiconfig.json");
                var config = new { lastApiType = CurrentApiType };
                string json = JsonSerializer.Serialize(config);
                File.WriteAllText(configPath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"保存当前选择的 API 失败: {ex.Message}");
            }
        }

        // 获取当前 API 密钥
        public string GetCurrentApiKey()
        {
            switch (apiType)
            {
                case 1:
                    return aliyunApiKey;
                case 2:
                    return siliconFlowApiKey;
                default:
                    return deepseekApiKey;
            }
        }

        // 设置 API 密钥
        public void SetApiKey(int type, string apiKey)
        {
            switch (type)
            {
                case 1:
                    aliyunApiKey = apiKey;
                    break;
                case 2:
                    siliconFlowApiKey = apiKey;
                    break;
                default:
                    deepseekApiKey = apiKey;
                    break;
            }
        }

        // 获取指定类型的 API 密钥
        public string GetApiKey(int type)
        {
            switch (type)
            {
                case 1:
                    return aliyunApiKey;
                case 2:
                    return siliconFlowApiKey;
                default:
                    return deepseekApiKey;
            }
        }

        // 设置 API 类型的方法
        public void SetApiType(int type)
        {
            apiType = type;
        }

        // 获取当前使用的 API 类型
        public int GetApiType()
        {
            return apiType;
        }

        // 兼容旧代码的方法
        public void SetUseAliyunApi(bool useAliyun)
        {
            apiType = useAliyun ? 1 : 0;
        }

        public bool IsUsingAliyunApi()
        {
            return apiType == 1;
        }

        // 保存 API 密钥到配置文件
        public void SaveApiKeysToConfig()
        {
            try
            {
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "apikeys.config");
                File.WriteAllText(configPath,
                    $"{deepseekApiKey}\n{aliyunApiKey}\n{siliconFlowApiKey}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"保存 API 密钥失败: {ex.Message}");
            }
        }

        // 从配置文件加载 API 密钥
        public void LoadApiKeysFromConfig()
        {
            try
            {
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "apikeys.config");
                if (File.Exists(configPath))
                {
                    string[] lines = File.ReadAllLines(configPath);
                    if (lines.Length >= 3)
                    {
                        deepseekApiKey = lines[0];
                        aliyunApiKey = lines[1];
                        siliconFlowApiKey = lines[2];

                        // 添加日志以便调试
                        Console.WriteLine("成功加载 API 密钥");
                    }
                }
                else
                {
                    Console.WriteLine("API 密钥配置文件不存在");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"加载 API 密钥失败: {ex.Message}");
            }
        }

        public bool IsRunning => isRunning; // 添加属性以便外部检查服务状态


        public string Start()
        {
            if (!isRunning)
            {
                try
                {
                    listener.Start();
                    isRunning = true;
                    Task.Run(HandleRequests);
                    Console.WriteLine("服务已成功启动，监听地址: http://localhost:5233/");
                    return "服务已成功启动";
                }
                catch (HttpListenerException ex)
                {
                    string errorMessage = "";
                    if (ex.ErrorCode == 5)
                    {
                        errorMessage = "启动失败：权限不足。请尝试以管理员身份运行应用程序。";
                    }
                    else if (ex.ErrorCode == 183)
                    {
                        errorMessage = "启动失败：端口5233已被占用。请关闭占用该端口的应用后重试。";
                    }
                    else
                    {
                        errorMessage = $"启动失败：{ex.Message} (错误代码: {ex.ErrorCode})";
                    }
                    Console.WriteLine(errorMessage);
                    return errorMessage;
                }
                catch (Exception ex)
                {
                    string errorMessage = $"启动失败：{ex.Message}";
                    Console.WriteLine(errorMessage);
                    return errorMessage;
                }
            }
            return "服务已在运行中";
        }

        public string Stop()
        {
            if (isRunning)
            {
                try
                {
                    isRunning = false;
                    listener.Stop();
                    Console.WriteLine("服务已停止");
                    return "服务已停止";
                }
                catch (Exception ex)
                {
                    string errorMessage = $"停止服务失败：{ex.Message}";
                    Console.WriteLine(errorMessage);
                    return errorMessage;
                }
            }
            return "服务未在运行";
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

                // 处理 /query 路由
                if (context.Request.Url?.AbsolutePath?.Equals("/query", StringComparison.OrdinalIgnoreCase) == true)
                {
                    await QueryHandler.HandleRequest(context);
                    return;
                }

                // 处理 /courseware 路由
                if (context.Request.Url?.AbsolutePath?.Equals("/courseware", StringComparison.OrdinalIgnoreCase) == true)
                {
                    await CoursewareHandler.HandleRequest(context);
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
                        string modelName;
                        switch (apiType)
                        {
                            case 1: // 阿里云
                                modelName = "deepseek-v3";
                                break;
                            case 2: // 硅基流动
                                modelName = "deepseek-ai/DeepSeek-V3";
                                break;
                            default: // DeepSeek 官方
                                modelName = "deepseek-chat";
                                break;
                        }

                        var jsonObj = new
                        {
                            model = modelName,
                            messages = root.GetProperty("messages"),
                            stream = true
                        };
                        requestBody = System.Text.Json.JsonSerializer.Serialize(jsonObj);
                    }
                    else
                    {
                        // 根据 API 类型选择模型名称
                        string modelName;
                        switch (apiType)
                        {
                            case 1: // 阿里云
                                modelName = "deepseek-v3";
                                break;
                            case 2: // 硅基流动
                                modelName = "deepseek-ai/DeepSeek-V3";
                                break;
                            default: // DeepSeek 官方
                                modelName = "deepseek-chat";
                                break;
                        }

                        // 如果存在 model 字段，根据 API 类型强制更新
                        var jsonObj = new
                        {
                            model = modelName,
                            messages = root.GetProperty("messages"),
                            stream = root.TryGetProperty("stream", out var streamValue) ? streamValue.GetBoolean() : true
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
                    // 根据设置选择使用的 API 接口
                    string currentApiUrl;
                    switch (apiType)
                    {
                        case 1:
                            currentApiUrl = aliyunUrl;
                            break;
                        case 2:
                            currentApiUrl = siliconFlowUrl;
                            break;
                        default:
                            currentApiUrl = deepseekUrl;
                            break;
                    }
                    var request = new HttpRequestMessage(HttpMethod.Post, currentApiUrl)
                    {
                        Content = new StringContent(requestBody, Encoding.UTF8, "application/json")
                    };

                    // 复制请求头并确保设置流式传输
                    foreach (string headerName in context.Request.Headers.Keys)
                    {
                        if (headerName.ToLower() != "host" && headerName.ToLower() != "authorization")
                        {
                            request.Headers.TryAddWithoutValidation(headerName, context.Request.Headers[headerName]);
                        }
                    }

                    // 使用保存的 API 密钥
                    string apiKey = GetCurrentApiKey();
                    if (!string.IsNullOrEmpty(apiKey))
                    {
                        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
                    }
                    else if (context.Request.Headers["Authorization"] != null)
                    {
                        // 如果没有保存的密钥，则使用原始请求中的 Authorization
                        request.Headers.TryAddWithoutValidation("Authorization", context.Request.Headers["Authorization"]);
                    }
                    context.Response.ContentType = "text/event-stream";
                    context.Response.Headers.Add("Cache-Control", "no-cache");
                    context.Response.Headers.Add("Connection", "keep-alive");

                    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                    context.Response.StatusCode = (int)response.StatusCode;

                    using var stream = await response.Content.ReadAsStreamAsync();
                    using var reader = new StreamReader(stream);

                    StringBuilder responseBuilder = new StringBuilder();
                    string? line;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        if (!string.IsNullOrEmpty(line))
                        {
                            // 记录AI响应
                            if (line.StartsWith("data: {"))
                            {
                                try
                                {
                                    var json = line.Substring(6); // 去掉"data: "前缀
                                    using var doc = JsonDocument.Parse(json);
                                    if (doc.RootElement.TryGetProperty("choices", out var choices) && 
                                        choices.GetArrayLength() > 0)
                                    {
                                        var choice = choices[0];
                                        if (choice.TryGetProperty("delta", out var delta) && 
                                            delta.TryGetProperty("content", out var content))
                                        {
                                            var contentText = content.GetString();
                                            if (!string.IsNullOrEmpty(contentText))
                                            {
                                                responseBuilder.Append(contentText);
                                                // 更新日志窗口
                                                MainWindow.Log(contentText);
                                            }
                                        }
                                    }}
                                    catch (Exception ex)
                                    {
                                        Console.WriteLine($"解析AI响应失败: {ex.Message}");
                                    }
                                }

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
        } // 确保这里有大括号闭合

        // 保存路由状态到配置文件
        public void SaveRouteStatusToConfig()
        {
            try
            {
                string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "routestatus.json");
                string json = JsonSerializer.Serialize(routeEnabledStatus);
                File.WriteAllText(configPath, json);
                Console.WriteLine("成功保存路由状态配置");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"保存路由状态配置失败: {ex.Message}");
            }
        }
        // 获取所有路由状态
        public Dictionary<string, bool> GetAllRouteStatus()
        {
            // 返回路由状态字典的副本
            return new Dictionary<string, bool>(routeEnabledStatus);
        }

        // 设置路由启用状态
        public void SetRouteEnabled(string route, bool enabled)
        {
            if (routeEnabledStatus.ContainsKey(route))
            {
                routeEnabledStatus[route] = enabled;
            }
            else
            {
                routeEnabledStatus.Add(route, enabled);
            }
        }

    }
}

