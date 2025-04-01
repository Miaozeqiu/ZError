using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Linq;
using ZJOOCHelper;

namespace DeepSeekProxy
{
    public class CoursewareHandler
    {
        public static async Task HandleRequest(HttpListenerContext context)
        {
            try
            {
                // 只处理 POST 请求
                if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.StatusCode = 405; // Method Not Allowed
                    context.Response.Close();
                    return;
                }

                // 读取请求体
                string requestBody;
                using (var reader = new StreamReader(context.Request.InputStream))
                {
                    requestBody = await reader.ReadToEndAsync();
                }

                // 解析 JSON 数据
                if (string.IsNullOrEmpty(requestBody))
                {
                    throw new Exception("请求体为空");
                }

                try
                {
                    // 解析 JSON 数据
                    using var document = JsonDocument.Parse(requestBody);
                    var root = document.RootElement;

                    // 获取用户名和密码
                    if (!root.TryGetProperty("username", out var usernameElement) ||
                        !root.TryGetProperty("password", out var passwordElement))
                    {
                        throw new Exception("请求必须包含 username 和 password 字段");
                    }

                    string username = usernameElement.GetString();
                    string password = passwordElement.GetString();

                    if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                    {
                        throw new Exception("username 或 password 不能为空");
                    }

                    // 尝试登录
                    bool loginSuccess = await Login.LoginAsync(username, password);

                    if (!loginSuccess)
                    {
                        throw new Exception("登录失败，请检查账号密码");
                    }

                    // 检查是否有课程ID
                    string courseId = null;
                    if (root.TryGetProperty("courseId", out var courseIdElement))
                    {
                        courseId = courseIdElement.GetString();
                    }

                    // 如果没有课程ID，则只返回登录成功的信息
                    if (string.IsNullOrEmpty(courseId))
                    {
                        await SendJsonResponse(context, new
                        {
                            status = "success",
                            message = "登录成功",
                            data = new { loginSuccess = true }
                        });
                        return;
                    }

                    // 如果有课程ID，则处理课程
                    var sessions = Login.GetUserSessions();
                    if (!sessions.ContainsKey(username))
                    {
                        throw new Exception("获取用户会话信息失败");
                    }

                    var cookiesDict = sessions[username];
                    string cookieString = string.Join("; ", cookiesDict.Select(kv => $"{kv.Key}={kv.Value}"));

                    // 调用处理课程的方法
                    var result = await ProcessCourseware(cookieString, courseId);

                    // 返回处理结果
                    await SendJsonResponse(context, new
                    {
                        status = "success",
                        message = "课程处理完成",
                        data = result
                    });
                }
                catch (JsonException ex)
                {
                    throw new Exception($"JSON 解析错误: {ex.Message}");
                }
            }
            catch (Exception ex)
            {
                // 处理异常
                await SendJsonResponse(context, new
                {
                    status = "error",
                    message = ex.Message
                }, 500);
            }
        }

        private static async Task SendJsonResponse(HttpListenerContext context, object data, int statusCode = 200)
        {
            string json = JsonSerializer.Serialize(data);
            byte[] buffer = Encoding.UTF8.GetBytes(json);

            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = buffer.Length;
            context.Response.StatusCode = statusCode;

            await context.Response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
            context.Response.Close();
        }

        private static async Task<object> ProcessCourseware(string cookie, string courseId)
        {
            try
            {
                // 创建 HttpClient 并设置 Cookie
                using var client = Program.CreateClientWithCookies(cookie);

                // 检查登录状态
                if (await Program.CheckSessionValid(client))
                {
                    // 获取视频信息
                    var videoMessages = await Program.GetVideoMsg(client, courseId);

                    // 处理视频
                    await Program.DoVideo(client, courseId);

                    return new
                    {
                        success = true,
                        videoCount = videoMessages?.Count ?? 0,
                        message = "课程视频处理成功"
                    };
                }
                else
                {
                    return new
                    {
                        success = false,
                        message = "登录失败，请检查 cookie 是否有效"
                    };
                }
            }
            catch (Exception ex)
            {
                return new
                {
                    success = false,
                    message = $"处理过程中发生错误: {ex.Message}"
                };
            }
        }
    }
}