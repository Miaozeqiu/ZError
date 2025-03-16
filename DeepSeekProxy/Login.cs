using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace DeepSeekProxy
{
    public class Login
    {
        // 请求头
        private static readonly Dictionary<string, string> Headers = new Dictionary<string, string>
        {
            { "Accept", "application/json, text/javascript, */*; q=0.01" },
            { "SignCheck", "935465b771e207fd0f22f5c49ec70381" },
            { "TimeDate", "1694747726000" },
            { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36" }
        };

        // OCR服务地址
        private const string OCR_HOST = "https://app.zaizhexue.top";

        // 获取应用程序的基础路径
        private static string GetBasePath()
        {
            return AppDomain.CurrentDomain.BaseDirectory;
        }

        // 会话存储文件路径
        private static string GetSessionsFile()
        {
            return Path.Combine(GetBasePath(), "sessions.json");
        }

        // 加载会话信息
        private static Dictionary<string, Dictionary<string, string>> LoadSessions()
        {
            string sessionsFile = GetSessionsFile();
            if (File.Exists(sessionsFile))
            {
                try
                {
                    string json = File.ReadAllText(sessionsFile, Encoding.UTF8);
                    return JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(json);
                }
                catch (Exception e)
                {
                    Console.WriteLine($"加载会话文件失败: {e.Message}");
                }
            }
            return new Dictionary<string, Dictionary<string, string>>();
        }

        // 保存会话信息
        private static bool SaveSession(string username, Dictionary<string, string> cookiesDict)
        {
            var sessions = LoadSessions();
            sessions[username] = cookiesDict;

            try
            {
                string json = JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(GetSessionsFile(), json, Encoding.UTF8);
                Console.WriteLine($"会话信息已保存到 {GetSessionsFile()}");
                return true;
            }
            catch (Exception e)
            {
                Console.WriteLine($"保存会话信息失败: {e.Message}");
                return false;
            }
        }

        // 获取验证码信息
        private static async Task<Dictionary<string, object>> GetCaptchaAsync()
        {
            using (HttpClient client = new HttpClient(new HttpClientHandler { ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true }))
            {
                client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36");
                
                HttpResponseMessage response = await client.GetAsync("https://centro.zjlll.net/ajax?&service=/centro/api/authcode/create&params=");
                string content = await response.Content.ReadAsStringAsync();
                
                var result = JsonSerializer.Deserialize<Dictionary<string, object>>(content);
                return JsonSerializer.Deserialize<Dictionary<string, object>>(result["data"].ToString());
            }
        }

        // 识别验证码
        private static async Task<string> RecognizeCaptchaAsync(byte[] imageData)
        {
            try
            {
                using (HttpClient client = new HttpClient())
                {
                    string apiUrl = $"{OCR_HOST}/recognize_captcha";
                    var requestData = new
                    {
                        image_base64 = Convert.ToBase64String(imageData)
                    };

                    string jsonContent = JsonSerializer.Serialize(requestData);
                    var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");
                    
                    HttpResponseMessage response = await client.PostAsync(apiUrl, content);
                    
                    if (response.IsSuccessStatusCode)
                    {
                        string responseContent = await response.Content.ReadAsStringAsync();
                        var result = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(responseContent);
                        
                        if (result != null && 
                            result.ContainsKey("code") && 
                            result["code"].TryGetInt32(out int code) && 
                            code == 0)
                        {
                            string captchaCode = result["captcha_code"].GetString();
                            // 将字母o替换为数字0
                            captchaCode = captchaCode?.Replace('o', '0').Replace('O', '0');
                            Console.WriteLine($"OCR服务识别结果: {captchaCode}");
                            return captchaCode;
                        }
                        else
                        {
                            string message = "未知错误";
                            if (result != null && result.ContainsKey("message"))
                            {
                                message = result["message"].GetString() ?? message;
                            }
                            Console.WriteLine($"OCR服务返回错误: {message}");
                            return null;
                        }
                    }
                    else
                    {
                        Console.WriteLine($"OCR服务返回错误状态码: {response.StatusCode}, {await response.Content.ReadAsStringAsync()}");
                        return null;
                    }
                }
            }
            catch (Exception e)
            {
                Console.WriteLine($"调用OCR服务失败: {e.Message}");
                return null;
            }
        }

        // 检查会话是否有效
        private static async Task<bool> CheckSessionValidAsync(Dictionary<string, string> cookiesDict)
        {
            try
            {
                var handler = new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true,
                    CookieContainer = new CookieContainer()
                };

                using (var client = new HttpClient(handler))
                {
                    // 添加cookies
                    var baseUri = new Uri("https://www.zjooc.cn");
                    
                    foreach (var cookie in cookiesDict)
                    {
                        handler.CookieContainer.Add(baseUri, new Cookie(cookie.Key, cookie.Value));
                    }

                    // 添加请求头
                    foreach (var header in Headers)
                    {
                        client.DefaultRequestHeaders.Add(header.Key, header.Value);
                    }

                    // 尝试获取用户信息
                    string url = "https://www.zjooc.cn/ajax?service=/centro/api/user/getProfile&params[withDetail]=True";
                    HttpResponseMessage response = await client.GetAsync(url);
                    string content = await response.Content.ReadAsStringAsync();
                    
                    var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(content);
                    // 修改这里，使用GetInt32()方法而不是Convert.ToInt32()
                    return data.ContainsKey("resultCode") && data["resultCode"].GetInt32() == 0 && data.ContainsKey("data");
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        // 登录并保存会话
        public static async Task<bool> LoginAsync(string username, string pwd)
        {
            // 检查是否已有该账号的会话信息
            var sessions = LoadSessions();
            if (sessions.ContainsKey(username))
            {
                var cookiesDict = sessions[username];
                if (await CheckSessionValidAsync(cookiesDict))
                {
                    Console.WriteLine("使用已保存的会话信息登录成功");
                    Console.WriteLine($"账号 {username} 的会话信息:");
                    Console.WriteLine(JsonSerializer.Serialize(cookiesDict, new JsonSerializerOptions { WriteIndented = true }));
                    return true;
                }
                else
                {
                    Console.WriteLine("保存的会话已过期，需要重新登录");
                }
            }

            using (HttpClientHandler handler = new HttpClientHandler { ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true })
            using (HttpClient client = new HttpClient(handler))
            {
                // 获取验证码
                var captchaData = await GetCaptchaAsync();
                string captchaId = captchaData["id"].ToString();
                
                // 识别验证码
                byte[] imageData = Convert.FromBase64String(captchaData["image"].ToString());
                
                // 尝试使用本地OCR服务识别验证码
                string captchaCode = await RecognizeCaptchaAsync(imageData);
                Console.WriteLine($"OCR服务识别结果: {captchaCode}");
                // 如果OCR服务识别失败，保存图片并提示手动输入
                if (string.IsNullOrEmpty(captchaCode))
                {
                    // 保存验证码图片
                    string imgPath = Path.Combine(GetBasePath(), "captcha.jpg");
                    File.WriteAllBytes(imgPath, imageData);
                    Console.WriteLine($"验证码图片已保存到: {imgPath}");
                    Console.Write("请查看图片并输入验证码: ");
                    captchaCode = Console.ReadLine();
                }
                else
                {
                    Console.WriteLine($"验证码: {captchaCode}");
                }
                
                Console.ReadLine(); // 等待用户确认
                
                // 登录数据
                var loginData = new Dictionary<string, string>
                {
                    { "login_name", username },
                    { "password", pwd },
                    { "captchaCode", captchaCode },
                    { "captchaId", captchaId },
                    { "redirect_url", "https://www.zjooc.cn" },
                    { "app_key", "0f4cbab4-84ee-48c3-ba4c-874578754b29" },
                    { "utoLoginTime", "7" }
                };
                
                try
                {
                    // 发送登录请求
                    var content = new FormUrlEncodedContent(loginData);
                    HttpResponseMessage response = await client.PostAsync("https://centro.zjlll.net/login/doLogin", content);
                    string responseContent = await response.Content.ReadAsStringAsync();
                    var loginRes = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(responseContent);
                    
                    // 检查登录结果
                    if (loginRes != null && 
                        loginRes.ContainsKey("resultCode") && 
                        loginRes["resultCode"].TryGetInt32(out int resultCode) && 
                        resultCode != 0)
                    {   Console.WriteLine($"登录失败: {loginRes["resultCode"]}");
                        Console.WriteLine($"登录失败: {captchaCode}");
                        string errorMsg = "登录失败，请检查账号密码和验证码";
                        if (loginRes.ContainsKey("resultMsg"))
                        {
                            errorMsg = loginRes["resultMsg"].GetString() ?? errorMsg;
                        }
                        Console.WriteLine($"登录失败: {errorMsg}");
                        return false;
                    }
                    Console.WriteLine($"{loginRes}");
                    // 完成登录流程
                    string authCode = "";
                    if (loginRes != null && loginRes.ContainsKey("authorization_code"))
                    {
                        authCode = loginRes["authorization_code"].GetString() ?? "";
                    }
                    
                    string loginUrl = $"https://www.zjooc.cn/autoLogin?auth_code={authCode}&autoLoginTime=7";
                    await client.GetAsync(loginUrl);
                    Console.WriteLine("登录成功");
                    
                    // 验证会话是否有效
                    string profileUrl = "https://www.zjooc.cn/ajax?service=/centro/api/user/getProfile&params[withDetail]=True";
                    foreach (var header in Headers)
                    {
                        if (!client.DefaultRequestHeaders.Contains(header.Key))
                            client.DefaultRequestHeaders.Add(header.Key, header.Value);
                    }
                    
                    response = await client.GetAsync(profileUrl);
                    responseContent = await response.Content.ReadAsStringAsync();
                    var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(responseContent);
                    
                    bool isValid = false;
                    if (data != null && 
                        data.ContainsKey("resultCode") && 
                        data["resultCode"].TryGetInt32(out int code) && 
                        code == 0 && 
                        data.ContainsKey("data"))
                    {
                        isValid = true;
                    }
                    
                    if (!isValid)
                    {
                        Console.WriteLine("会话验证失败");
                        return false;
                    }
                    
                    // 将cookies转换为字典并保存
                    var cookiesDict = new Dictionary<string, string>();
                    var cookieContainer = handler.CookieContainer;
                    var baseUri = new Uri("https://www.zjooc.cn");
                    
                    foreach (Cookie cookie in cookieContainer.GetCookies(baseUri))
                    {
                        cookiesDict[cookie.Name] = cookie.Value;
                    }
                    
                    SaveSession(username, cookiesDict);
                    
                    // 打印会话信息
                    Console.WriteLine($"账号 {username} 的会话信息:");
                    Console.WriteLine(JsonSerializer.Serialize(cookiesDict, new JsonSerializerOptions { WriteIndented = true }));
                    
                    return true;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"登录过程中出现异常: {ex.Message}");
                    return false;
                }
            }
        }

        // 列出所有已保存的账号
        public static async Task ListAccountsAsync()
        {
            var sessions = LoadSessions();
            if (sessions.Count == 0)
            {
                Console.WriteLine("没有保存的账号信息");
                return;
            }
            
            Console.WriteLine("已保存的账号列表:");
            foreach (var username in sessions.Keys)
            {
                string valid = await CheckSessionValidAsync(sessions[username]) ? "有效" : "已过期";
                Console.WriteLine($"- {username} ({valid})");
            }
        }

        // 显示所有账号的详细信息
        public static void ShowAccounts()
        {
            var sessions = LoadSessions();
            Console.WriteLine(JsonSerializer.Serialize(sessions, new JsonSerializerOptions { WriteIndented = true }));
        }

        // 获取所有用户会话信息
        public static Dictionary<string, Dictionary<string, string>> GetUserSessions()
        {
            return LoadSessions();
        }

        // 主函数
        public static async Task Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "list")
            {
                // 列出所有已保存的账号
                await ListAccountsAsync();
            }
            else if (args.Length == 1 && args[0] == "show")
            {
                // 显示所有账号的详细信息
                ShowAccounts();
            }
            else if (args.Length == 2)
            {
                // 登录指定账号
                string username = args[0];
                string password = args[1];
                
                if (await LoginAsync(username, password))
                {
                    Console.WriteLine("登录并保存会话成功");
                }
                else
                {
                    Console.WriteLine("登录失败");
                    Environment.Exit(1);
                }
            }
            else
            {
                Console.WriteLine("使用方法:");
                Console.WriteLine("  Login.exe 用户名 密码    - 登录指定账号");
                Console.WriteLine("  Login.exe list          - 列出所有已保存的账号");
                Console.WriteLine("  Login.exe show          - 显示所有账号的详细会话信息");
                Environment.Exit(1);
            }
        }
    }
}