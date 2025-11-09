using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Web; // 添加对 System.Web 的引用
using System.Data.SQLite;
using Microsoft.Data.Sqlite;

namespace DeepSeekProxy
{
    public class QueryHandler
    {
        private static readonly string DbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "airesponses.db");
        
        static QueryHandler()
        {
            InitializeDatabase();
        }
        
        private static void InitializeDatabase()
        {
            if (!File.Exists(DbPath))
            {
                SQLiteConnection.CreateFile(DbPath);
            }
            
            using var connection = new SQLiteConnection($"Data Source={DbPath}");
            connection.Open();
            
            using var command = connection.CreateCommand();
            command.CommandText = @"
                CREATE TABLE IF NOT EXISTS AIResponses (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    Question TEXT NOT NULL,
                    Options TEXT,
                    QuestionType TEXT,
                    Answer TEXT NOT NULL,
                    CreateTime DATETIME DEFAULT CURRENT_TIMESTAMP
                )";
            command.ExecuteNonQuery();
        }
        
        private static async Task<string> GetCachedResponse(string title)
        {
            using var connection = new SQLiteConnection($"Data Source={DbPath}");
            connection.Open();
            
            using var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT Answer 
                FROM AIResponses 
                WHERE Question = @question
                ORDER BY CreateTime DESC 
                LIMIT 1";
                
            command.Parameters.AddWithValue("@question", title);
            
            var result = command.ExecuteScalar();
            return result?.ToString();
        }
        
        private static async Task SaveResponse(string title, string options, string questionType, string answer)
        {
            using var connection = new SQLiteConnection($"Data Source={DbPath}");
            connection.Open();
            
            using var command = connection.CreateCommand();
            command.CommandText = @"
                INSERT INTO AIResponses (Question, Options, QuestionType, Answer)
                VALUES (@question, @options, @questionType, @answer)";
                
            command.Parameters.AddWithValue("@question", title);
            command.Parameters.AddWithValue("@options", options);
            command.Parameters.AddWithValue("@questionType", questionType);
            command.Parameters.AddWithValue("@answer", answer);
            
            await Task.Run(() => command.ExecuteNonQuery());
        }

        public static async Task HandleRequest(HttpListenerContext context)
        {
            try
            {
                // 只处理 GET 请求
                if (!context.Request.HttpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.StatusCode = 405; // Method Not Allowed
                    context.Response.Close();
                    return;
                }

                // 从查询字符串获取参数
                var queryString = context.Request.Url?.Query;
                if (string.IsNullOrEmpty(queryString))
                {
                    throw new Exception("请求必须包含查询参数");
                }

                // 解析查询参数
                var queryParams = System.Web.HttpUtility.ParseQueryString(queryString);
                
                // 获取必要参数
                string title = queryParams["title"];
                
                if (string.IsNullOrEmpty(title))
                {
                    throw new Exception("请求必须包含 title 参数");
                }
                
                // options 和 question_type 是可选的
                string options = queryParams["options"] ?? "";
                string questionType = queryParams["question_type"] ?? "";

                // 在调用 AI 之前先检查缓存
                string cachedAnswer = await GetCachedResponse(title);
                string answer;
                
                if (!string.IsNullOrEmpty(cachedAnswer))
                {
                    answer = cachedAnswer;
                    Console.WriteLine("使用缓存的回答");
                }
                else
                {
                    // 调用 AI 查询方法
                    answer = await QueryAI(title, options, questionType);
                    
                    // 保存回答到数据库
                    await SaveResponse(title, options, questionType, answer);
                    Console.WriteLine("新回答已保存到数据库");
                }

                // 发送响应
                await SendJsonResponse(context, new
                {
                    status = "success",
                    data = answer
                });
            }
            catch (Exception ex)
            {
                await SendJsonResponse(context, new
                {
                    status = "error",
                    message = ex.Message
                }, 500);
            }
        }

        private static async Task<string> QueryAI(string title, string options, string questionType)
        {
            // 构建提示内容
            string promptContent = "你是一个题库接口函数，请根据问题和选项提供答案。如果是选择题，直接返回对应选项的内容，注意是内容，不是对应字母；如果题目是多选题，将内容用\"###\"连接；如果选项内容是\"对\",\"错\"，且只有两项，或者question_type是judgement，你直接返回\"对\"或\"错\"的文字，不要返回字母；如果是填空题，直接返回填空内容，多个空使用###连接。回答格式为：\"{\\\"anwser\\\":\\\"your_anwser_str\\\"}\"，严格使用此格式回答。比如我问你一个问题，你回答的是\"是\"，你回答的格式为：\"{\\\"anwser\\\":\\\"是\\\"}\"。不要回答嗯，好的，我知道了之类的话，你的回答只能是json。下面是一个问题，请你用json格式回答我，绝对不要使用自然语言，并且不要使用转义字符";
            promptContent += $@"{{
                ""问题"": ""{title}"",
                ""选项"": ""{options}"",
                ""类型"": ""{questionType}""
            }}";

            // 创建 HTTP 客户端
            using var client = new HttpClient();
            
            // 构建请求消息
            var messages = new[]
            {
                new { role = "system", content = "You are a helpful assistant." },
                new { role = "user", content = promptContent }
            };

            var requestData = new
            {
                messages = messages
            };

            string requestBody = JsonSerializer.Serialize(requestData);
            
            // 发送请求到本地 AI 代理
            var request = new HttpRequestMessage(HttpMethod.Post, "http://localhost:5233")
            {
                Content = new StringContent(requestBody, Encoding.UTF8, "application/json")
            };

            // 发送请求并获取响应
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"AI 请求失败: {response.StatusCode}");
            }

            // 读取响应内容
            using var stream = await response.Content.ReadAsStreamAsync();
            using var reader = new StreamReader(stream);
            
            StringBuilder responseBuilder = new StringBuilder();
            string line;
            
            // 读取所有 SSE 格式的响应
            while ((line = await reader.ReadLineAsync()) != null)
            {
                if (line.StartsWith("data: "))
                {
                    string data = line.Substring(6);
                    if (data != "[DONE]")
                    {
                        try
                        {
                            using var jsonDoc = JsonDocument.Parse(data);
                            if (jsonDoc.RootElement.TryGetProperty("choices", out var choices) &&
                                choices.GetArrayLength() > 0 &&
                                choices[0].TryGetProperty("delta", out var delta) &&
                                delta.TryGetProperty("content", out var contentValue))
                            {
                                responseBuilder.Append(contentValue.GetString());
                            }
                        }
                        catch (JsonException)
                        {
                            // 忽略无效的 JSON
                        }
                    }
                }
            }

            string aiAnswer = responseBuilder.ToString().Trim();
            
            // 尝试解析 JSON 格式的答案
            string extractedAnswer = ExtractAnswerFromAIResponse(aiAnswer);
            
            return extractedAnswer;
        }

        // 添加提取 AI 回答中的答案的方法
        private static string ExtractAnswerFromAIResponse(string aiAnswer)
        {
            try
            {
                // 先尝试直接解析整个字符串
                try
                {
                    using var jsonDoc = JsonDocument.Parse(aiAnswer);
                    var root = jsonDoc.RootElement;
                    
                    if (root.TryGetProperty("answer", out var answerElement))
                    {
                        return answerElement.GetString();
                    }
                    else if (root.TryGetProperty("anwser", out var anwserElement))
                    {
                        return anwserElement.GetString();
                    }
                }
                catch (JsonException)
                {
                    // 如果直接解析失败，尝试提取JSON部分
                    int startIdx = aiAnswer.IndexOf('{');
                    int endIdx = aiAnswer.LastIndexOf('}') + 1;
                    
                    if (startIdx >= 0 && endIdx > startIdx)
                    {
                        string jsonStr = aiAnswer.Substring(startIdx, endIdx - startIdx);
                        
                        // 再次尝试解析提取的部分
                        using var jsonDoc = JsonDocument.Parse(jsonStr);
                        var root = jsonDoc.RootElement;
                        
                        if (root.TryGetProperty("answer", out var answerElement))
                        {
                            return answerElement.GetString();
                        }
                        else if (root.TryGetProperty("anwser", out var anwserElement))
                        {
                            return anwserElement.GetString();
                        }
                    }
                }

                // 如果JSON解析都失败，使用正则表达式提取
                var match = System.Text.RegularExpressions.Regex.Match(
                    aiAnswer, 
                    @"""an?wser""\s*:\s*""([^""\\]*(?:\\.[^""\\]*)*)""",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                
                if (match.Success)
                {
                    return match.Groups[1].Value.Replace("\\\"", "\"");
                }

                // 如果所有方法都失败，返回原始回答
                return aiAnswer;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"解析AI回答失败: {ex.Message}");
                return aiAnswer;
            }
        }

        private static async Task SendJsonResponse(HttpListenerContext context, object data, int statusCode = 200)
        {
            // 构建标准格式的响应
            var responseObj = new
            {
                success = statusCode == 200,
                data = new
                {
                    code = statusCode == 200 ? 1 : 0,
                    data = statusCode == 200 ? (data is string ? data : ((dynamic)data).data) : "",
                    msg = statusCode == 200 ? "AI回答" : (data is string ? data : ((dynamic)data).message)
                }
            };

            string json = JsonSerializer.Serialize(responseObj);
            byte[] buffer = Encoding.UTF8.GetBytes(json);

            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = buffer.Length;
            context.Response.StatusCode = 200; // 始终返回 200，错误信息在 JSON 中表示

            await context.Response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
            context.Response.Close();
        }
    }
}