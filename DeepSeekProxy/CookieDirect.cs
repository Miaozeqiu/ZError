using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Web;

namespace ZJOOCHelper
{
    public class Program  // 改为 public
    {
        // 设置请求头
        private static readonly Dictionary<string, string> Headers = new Dictionary<string, string>
        {
            { "Accept", "application/json, text/javascript, */*; q=0.01" },
            { "SignCheck", "935465b771e207fd0f22f5c49ec70381" },
            { "TimeDate", "1694747726000" },
            { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36" }
        };

        static async Task Main(string[] args)
        {
            if (args.Length != 2)
            {
                Console.WriteLine("用法: CookieDirect.exe \"cookie字符串\" 课程ID");
                return;
            }

            string cookieStr = args[0];
            string courseId = args[1];

            try
            {
                // 创建HttpClient并设置Cookie
                using (HttpClient client = CreateClientWithCookies(cookieStr))
                {
                    // 检查登录状态
                    if (await CheckSessionValid(client))
                    {
                        Console.WriteLine("登录成功，开始处理视频...");
                        // 完成视频
                        await DoVideo(client, courseId);
                    }
                    else
                    {
                        Console.WriteLine("登录失败，请检查cookie是否有效");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"发生错误: {ex.Message}");
            }
        }

        // 将方法改为 public
        public static HttpClient CreateClientWithCookies(string cookieStr)
        {
            var handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = new CookieContainer()
            };

            var client = new HttpClient(handler);

            // 添加请求头
            foreach (var header in Headers)
            {
                client.DefaultRequestHeaders.Add(header.Key, header.Value);
            }

            // 解析Cookie字符串
            string[] pairs = cookieStr.Split(new[] { "; " }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string pair in pairs)
            {
                if (!pair.Contains("=")) continue;

                string[] parts = pair.Split(new[] { '=' }, 2);
                string name = parts[0];
                string value = parts[1];

                // 我们只关心atoken和lano.connect.sid
                if (name == "atoken" || name == "lano.connect.sid")
                {
                    // URL解码cookie值
                    value = HttpUtility.UrlDecode(value);
                    handler.CookieContainer.Add(new Uri("https://www.zjooc.cn"), new Cookie(name, value));
                }
            }

            return client;
        }

        // 将方法改为 public
        public static async Task<bool> CheckSessionValid(HttpClient client)
        {
            try
            {
                // 尝试获取用户信息，如果成功则会话有效
                string url = "https://www.zjooc.cn/ajax?service=/centro/api/user/getProfile&params[withDetail]=true";
                HttpResponseMessage response = await client.GetAsync(url);
                string content = await response.Content.ReadAsStringAsync();
                
                using (JsonDocument doc = JsonDocument.Parse(content))
                {
                    JsonElement root = doc.RootElement;
                    return root.TryGetProperty("resultCode", out JsonElement resultCode) && 
                           resultCode.GetInt32() == 0 && 
                           root.TryGetProperty("data", out _);
                }
            }
            catch
            {
                return false;
            }
        }

        // 将方法改为 public
        public static async Task<List<Dictionary<string, object>>> GetVideoMsg(HttpClient client, string courseId)
        {
            string url = $"https://www.zjooc.cn/ajax?service=/jxxt/api/course/courseStudent/getStudentCourseChapters&params[pageNo]=1&params[courseId]={courseId}&params[urlNeed]=0";
            HttpResponseMessage response = await client.GetAsync(url);
            string content = await response.Content.ReadAsStringAsync();
            
            var videoMsg = new List<Dictionary<string, object>>();
            
            using (JsonDocument doc = JsonDocument.Parse(content))
            {
                JsonElement data = doc.RootElement.GetProperty("data");
                
                foreach (JsonElement chapter in data.EnumerateArray())
                {
                    string chapterName = chapter.GetProperty("name").GetString();
                    
                    if (chapter.TryGetProperty("children", out JsonElement sections))
                    {
                        foreach (JsonElement section in sections.EnumerateArray())
                        {
                            string sectionName = section.GetProperty("name").GetString();
                            
                            if (section.TryGetProperty("children", out JsonElement resources))
                            {
                                foreach (JsonElement resource in resources.EnumerateArray())
                                {
                                    // 移除 learnStatus 的检查，处理所有视频
                                    var videoInfo = new Dictionary<string, object>
                                    {
                                        { "Name", $"{chapterName}-{sectionName}-{resource.GetProperty("name").GetString()}" },
                                        { "courseId", courseId },
                                        { "chapterId", resource.GetProperty("id").GetString() },
                                        { "learnStatus", resource.GetProperty("learnStatus").GetInt32() }
                                    };
                                    
                                    // 获取视频时长
                                    if (resource.TryGetProperty("vedioTimeLength", out JsonElement timeLength))
                                    {
                                        videoInfo["time"] = timeLength.GetInt32();
                                    }
                                    else
                                    {
                                        videoInfo["time"] = 0;
                                    }
                                    
                                    videoMsg.Add(videoInfo);
                                }
                            }
                        }
                    }
                }
            }
            
            return videoMsg;
        }

        // 将方法改为 public
        public static async Task DoVideo(HttpClient client, string courseId)
        {
            List<Dictionary<string, object>> videoList = await GetVideoMsg(client, courseId);
            int videoCount = videoList.Count;
            
            if (videoCount == 0)
            {
                Console.WriteLine("没有未完成的视频！");
                return;
            }

            for (int idx = 0; idx < videoCount; idx++)
            {
                var video = videoList[idx];
                string url;
                
                if (Convert.ToInt32(video["time"]) > 0)
                {
                    url = $"https://www.zjooc.cn/ajax?service=/learningmonitor/api/learning/monitor/videoPlaying" +
                          $"&params[chapterId]={video["chapterId"]}" +
                          $"&params[courseId]={video["courseId"]}" +
                          $"&params[playTime]={video["time"]}" +
                          $"&params[percent]=100";
                }
                else
                {
                    url = $"https://www.zjooc.cn/ajax?service=/learningmonitor/api/learning/monitor/finishTextChapter" +
                          $"&params[courseId]={video["courseId"]}" +
                          $"&params[chapterId]={video["chapterId"]}";
                }
                
                await client.GetAsync(url);
                
                double progress = (idx + 1.0) / videoCount;
                // 使用更简单的字符来创建进度条
                string progressBar = new string('#', (int)(progress * 10)) + new string('-', (int)(10 - progress * 10));
                Console.Write($"\r{video["Name"]}正在完成！\r{progressBar}[{progress:P0}]");
            }
            
            Console.WriteLine("\n全部完成！");
        }
    }
}