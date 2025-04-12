using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Data.SQLite;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
// 添加托盘图标所需的命名空间
using System.Windows.Forms;
using System.Drawing;
// 使用 MessageBox 的完全限定名，或者添加别名
using WinMessageBox = System.Windows.MessageBox;

namespace DeepSeekProxy
{
    /// <summary>
    /// 题库管理页面，提供题目的增删改查和分页功能
    /// </summary>
    public partial class QuestionsPage : Page
    {
        #region 私有字段

        private readonly string DbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "airesponses.db");
        private ObservableCollection<QuestionItem> Questions { get; set; }
        private QuestionItem currentEditItem; // 当前正在编辑的题目
        
        // 添加托盘图标
        private NotifyIcon notifyIcon;

        // 分页相关属性
        private int currentPage = 1;
        private int pageSize = 20;
        private int totalRecords = 0;
        private int totalPages = 0;
        private string currentSearchText = "";

        #endregion

        #region 构造函数

        public QuestionsPage()
        {
            InitializeComponent();

            // 初始化数据
            Questions = new ObservableCollection<QuestionItem>();
            QuestionsDataGrid.ItemsSource = Questions;


            // 加载数据
            LoadQuestions(1);

            // 注册按键事件
            PageNumberTextBox.KeyDown += (s, e) =>
            {
                if (e.Key == System.Windows.Input.Key.Enter)
                {
                    GoToPageButton_Click(s, e);
                }
            };

            // 注册搜索框按键事件
            SearchTextBox.KeyDown += (s, e) =>
            {
                if (e.Key == System.Windows.Input.Key.Enter)
                {
                    SearchButton_Click(s, e);
                }
            };
            

        }
        
        /// <summary>
        /// 初始化托盘图标
        /// </summary>

        /// <summary>
        /// 页面卸载时释放托盘图标资源
        /// </summary>




        #region 数据加载方法

        /// <summary>
        /// 加载题目数据，支持分页和搜索
        /// </summary>
        /// <param name="page">页码，从1开始</param>
        /// <param name="searchText">搜索关键词</param>
        private void LoadQuestions(int page = 1, string searchText = "")
        {
            try
            {
                Questions.Clear();
                currentPage = page;
                currentSearchText = searchText;

                using (var connection = new SQLiteConnection($"Data Source={DbPath}"))
                {
                    connection.Open();

                    // 获取总记录数
                    using (var countCommand = connection.CreateCommand())
                    {
                        if (string.IsNullOrEmpty(searchText))
                        {
                            countCommand.CommandText = "SELECT COUNT(*) FROM AIResponses";
                        }
                        else
                        {
                            countCommand.CommandText = "SELECT COUNT(*) FROM AIResponses WHERE Question LIKE @search OR Answer LIKE @search";
                            countCommand.Parameters.AddWithValue("@search", $"%{searchText}%");
                        }

                        totalRecords = Convert.ToInt32(countCommand.ExecuteScalar());
                        totalPages = (int)Math.Ceiling((double)totalRecords / pageSize);
                    }

                    // 获取当前页数据
                    using (var command = connection.CreateCommand())
                    {
                        string sql;
                        if (string.IsNullOrEmpty(searchText))
                        {
                            sql = @"
                                SELECT Id, Question, Options, QuestionType, Answer, CreateTime
                                FROM AIResponses
                                ORDER BY CreateTime DESC
                                LIMIT @limit OFFSET @offset";
                        }
                        else
                        {
                            sql = @"
                                SELECT Id, Question, Options, QuestionType, Answer, CreateTime
                                FROM AIResponses
                                WHERE Question LIKE @search OR Answer LIKE @search
                                ORDER BY CreateTime DESC
                                LIMIT @limit OFFSET @offset";
                            command.Parameters.AddWithValue("@search", $"%{searchText}%");
                        }

                        command.CommandText = sql;
                        command.Parameters.AddWithValue("@limit", pageSize);
                        command.Parameters.AddWithValue("@offset", (page - 1) * pageSize);

                        using (var reader = command.ExecuteReader())
                        {
                            while (reader.Read())
                            {
                                Questions.Add(new QuestionItem
                                {
                                    Id = reader.GetInt32(0),
                                    Question = reader.GetString(1),
                                    Options = reader.IsDBNull(2) ? "" : reader.GetString(2),
                                    QuestionType = reader.IsDBNull(3) ? "" : reader.GetString(3),
                                    Answer = reader.GetString(4),
                                    CreateTime = reader.GetDateTime(5)
                                });
                            }
                        }
                    }
                }

                // 更新分页信息
                UpdatePagingInfo();

                // 更新状态栏
                if (totalRecords > 0)
                {
                    StatusText.Text = $"显示第 {currentPage}/{totalPages} 页，共 {totalRecords} 条记录";
                }
                else
                {
                    StatusText.Text = "没有找到记录";
                }

                // 添加淡入动画效果
                var fadeInAnimation = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(300));
                QuestionsDataGrid.BeginAnimation(UIElement.OpacityProperty, fadeInAnimation);
            }
            catch (Exception ex)
            {
                StatusText.Text = $"加载失败: {ex.Message}";
            }
        }
        /// <summary>
        /// 更新分页控件信息
        /// </summary>
        private void UpdatePagingInfo()
        {
            // 更新页码显示
            CurrentPageTextBlock.Text = currentPage.ToString();
            TotalPagesTextBlock.Text = totalPages.ToString();

            // 更新按钮状态
            FirstPageButton.IsEnabled = currentPage > 1;
            PrevPageButton.IsEnabled = currentPage > 1;
            NextPageButton.IsEnabled = currentPage < totalPages;
            LastPageButton.IsEnabled = currentPage < totalPages;

            // 清空跳转框
            PageNumberTextBox.Text = string.Empty;
        }

        #endregion

        #region 分页事件处理

        /// <summary>
        /// 首页按钮点击事件
        /// </summary>
        private void FirstPageButton_Click(object sender, RoutedEventArgs e)
        {
            if (currentPage > 1)
            {
                LoadQuestions(1, currentSearchText);
            }
        }

        /// <summary>
        /// 上一页按钮点击事件
        /// </summary>
        private void PrevPageButton_Click(object sender, RoutedEventArgs e)
        {
            if (currentPage > 1)
            {
                LoadQuestions(currentPage - 1, currentSearchText);
            }
        }

        /// <summary>
        /// 下一页按钮点击事件
        /// </summary>
        private void NextPageButton_Click(object sender, RoutedEventArgs e)
        {
            if (currentPage < totalPages)
            {
                LoadQuestions(currentPage + 1, currentSearchText);
            }
        }

        /// <summary>
        /// 末页按钮点击事件
        /// </summary>
        private void LastPageButton_Click(object sender, RoutedEventArgs e)
        {
            if (currentPage < totalPages)
            {
                LoadQuestions(totalPages, currentSearchText);
            }
        }

        /// <summary>
        /// 跳转页按钮点击事件
        /// </summary>
        private void GoToPageButton_Click(object sender, RoutedEventArgs e)
        {
            if (int.TryParse(PageNumberTextBox.Text, out int pageNumber))
            {
                if (pageNumber >= 1 && pageNumber <= totalPages)
                {
                    LoadQuestions(pageNumber, currentSearchText);
                }
                else
                {
                    ShowMessage($"请输入1到{totalPages}之间的页码");
                }
            }
            else
            {
                ShowMessage("请输入有效的页码");
            }
        }

        #endregion

        #region 操作事件处理

        /// <summary>
        /// 刷新按钮点击事件
        /// </summary>
        private void RefreshButton_Click(object sender, RoutedEventArgs e)
        {
            LoadQuestions(1);
        }

        /// <summary>
        /// 搜索按钮点击事件
        /// </summary>
        private void SearchButton_Click(object sender, RoutedEventArgs e)
        {
            string searchText = SearchTextBox.Text.Trim();
            LoadQuestions(1, searchText);
        }

        /// <summary>
        /// 删除按钮点击事件
        /// </summary>
        private void DeleteMenuItem_Click(object sender, RoutedEventArgs e)
        {
            var selectedItem = QuestionsDataGrid.SelectedItem as QuestionItem;
            if (selectedItem == null)
            {
                ShowMessage("请先选择一条记录");
                return;
            }

            var result = WinMessageBox.Show(
                $"确定要删除这条记录吗?\n问题: {TruncateText(selectedItem.Question, 50)}",
                "确认删除",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (result == MessageBoxResult.Yes)
            {
                try
                {
                    DeleteQuestion(selectedItem.Id);
                    Questions.Remove(selectedItem);

                    // 如果当前页已经没有数据且不是第一页，则加载上一页
                    if (Questions.Count == 0 && currentPage > 1)
                    {
                        LoadQuestions(currentPage - 1, currentSearchText);
                    }
                    else
                    {
                        // 否则重新加载当前页
                        LoadQuestions(currentPage, currentSearchText);
                    }

                    StatusText.Text = "记录已删除";
                }
                catch (Exception ex)
                {
                    StatusText.Text = $"删除失败: {ex.Message}";
                }
            }
        }

        /// <summary>
        /// 清空所有题目按钮点击事件
        /// </summary>
        private void ClearAllButton_Click(object sender, RoutedEventArgs e)
        {
            var result = WinMessageBox.Show(
                "确定要清空所有记录吗?此操作不可恢复！",
                "确认清空",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);

            if (result == MessageBoxResult.Yes)
            {
                try
                {
                    using (var connection = new SQLiteConnection($"Data Source={DbPath}"))
                    {
                        connection.Open();

                        using (var command = connection.CreateCommand())
                        {
                            command.CommandText = "DELETE FROM AIResponses";
                            command.ExecuteNonQuery();
                        }
                    }

                    Questions.Clear();
                    StatusText.Text = "所有记录已清空";

                    // 清空后重新加载
                    LoadQuestions(1);
                }
                catch (Exception ex)
                {
                    StatusText.Text = $"清空失败: {ex.Message}";
                }
            }
        }

        #endregion

        #region 编辑相关事件处理

        /// <summary>
        /// 编辑按钮点击事件
        /// </summary>
        private void AddButton_Click(object sender, RoutedEventArgs e)
        {
            // 应用模糊效果到主内容
            MainContentGrid.Effect = (BlurEffect)FindResource("BackgroundBlurEffect");
            // 清空编辑对话框中的内容
            EditQuestionTextBox.Text = "";
            EditAnswerTextBox.Text = "";

            // 显示编辑对话框
            EditDialog.Visibility = Visibility.Visible;

            // 设置对话框标题
            var titleTextBlock = EditDialog.FindName("EditDialogTitle") as TextBlock;
            if (titleTextBlock != null)
            {
                titleTextBlock.Text = "添加新题目";
            }

            // 设置当前编辑项为null，表示这是新增而非编辑
            currentEditItem = null;

            // 设置保存按钮的点击事件
            var saveButton = EditDialog.FindName("SaveEditButton") as System.Windows.Controls.Button;
            if (saveButton != null)
            {
                // 先移除所有可能的事件处理程序
                saveButton.Click -= SaveEditButton_Click;
                saveButton.Click -= SaveNewQuestion_Click;
                
                // 添加新的事件处理程序
                saveButton.Click += SaveNewQuestion_Click;
            }
        }

        private void EditMenuItem_Click(object sender, RoutedEventArgs e)
        {
            MainContentGrid.Effect = (BlurEffect)FindResource("BackgroundBlurEffect");
            // 获取当前选中的行数据
            var selectedItem = QuestionsDataGrid.SelectedItem as QuestionItem;
            if (selectedItem != null)
            {
                // 保存当前编辑项
                currentEditItem = selectedItem;

                // 填充编辑表单，只保留问题和答案
                EditQuestionTextBox.Text = currentEditItem.Question;
                EditAnswerTextBox.Text = currentEditItem.Answer;

                // 设置保存按钮的点击事件
                var saveButton = EditDialog.FindName("SaveEditButton") as System.Windows.Controls.Button;
                if (saveButton != null)
                {
                    // 先移除所有可能的事件处理程序
                    saveButton.Click -= SaveEditButton_Click;
                    saveButton.Click -= SaveNewQuestion_Click;
                    
                    // 添加编辑保存事件处理程序
                    saveButton.Click += SaveEditButton_Click;
                }

                // 显示编辑对话框
                EditDialog.Visibility = Visibility.Visible;

                // 设置焦点到问题输入框
                EditQuestionTextBox.Focus();
            }
            else
            {
                ShowMessage("请先选择一条记录");
            }
        }

        private void SaveNewQuestion_Click(object sender, RoutedEventArgs e)
        {
            // 获取保存按钮并立即移除事件处理程序
            var saveButton = sender as System.Windows.Controls.Button;
            if (saveButton != null)
            {
                saveButton.Click -= SaveNewQuestion_Click;
            }

            // 验证输入
            if (string.IsNullOrWhiteSpace(EditQuestionTextBox.Text) ||
                string.IsNullOrWhiteSpace(EditAnswerTextBox.Text))
            {
                System.Windows.MessageBox.Show("问题和答案不能为空", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                // 创建新题目对象
                var newQuestion = new QuestionItem
                {
                    Question = EditQuestionTextBox.Text.Trim(),
                    Answer = EditAnswerTextBox.Text.Trim(),
                    CreateTime = DateTime.Now
                };

                // 保存到数据库
                using (var connection = new SQLiteConnection($"Data Source={DbPath}"))
                {
                    connection.Open();

                    using (var command = connection.CreateCommand())
                    {
                        command.CommandText = @"
                            INSERT INTO AIResponses (Question, Answer, CreateTime)
                            VALUES (@question, @answer, @createTime);
                            SELECT last_insert_rowid();";

                        command.Parameters.AddWithValue("@question", newQuestion.Question);
                        command.Parameters.AddWithValue("@answer", newQuestion.Answer);
                        command.Parameters.AddWithValue("@createTime", newQuestion.CreateTime);

                        // 获取新插入记录的ID
                        newQuestion.Id = Convert.ToInt32(command.ExecuteScalar());
                    }
                }

                // 添加到数据源
                Questions.Add(newQuestion);

                // 隐藏对话框
                EditDialog.Visibility = Visibility.Collapsed;

                // 显示成功消息
                StatusText.Text = "题目添加成功";

                // 刷新数据
                LoadQuestions(currentPage, currentSearchText);
                
            }
            catch (Exception ex)
            {
                StatusText.Text = $"添加题目失败: {ex.Message}";
            }
            MainContentGrid.Effect = null;
        }

        private void CancelEditButton_Click(object sender, RoutedEventArgs e)
        {
            EditDialog.Visibility = Visibility.Collapsed;
            currentEditItem = null;
            MainContentGrid.Effect = null;
        }

        /// <summary>
        /// 保存编辑按钮点击事件
        /// </summary>
        private void SaveEditButton_Click(object sender, RoutedEventArgs e)
        {
            if (currentEditItem == null) return;

            try
            {
                // 更新当前编辑项的值，只更新问题和答案
                string newQuestion = EditQuestionTextBox.Text.Trim();
                string newAnswer = EditAnswerTextBox.Text.Trim();

                // 验证必填字段
                if (string.IsNullOrEmpty(newQuestion) || string.IsNullOrEmpty(newAnswer))
                {
                    ShowMessage("问题和答案不能为空", MessageBoxImage.Warning);
                    return;
                }

                // 更新数据库
                UpdateQuestion(currentEditItem.Id, newQuestion, newAnswer);

                // 更新UI中的数据
                int index = Questions.IndexOf(currentEditItem);
                if (index >= 0)
                {
                    Questions[index].Question = newQuestion;
                    Questions[index].Answer = newAnswer;

                    // 刷新DataGrid
                    QuestionsDataGrid.Items.Refresh();
                }

                // 隐藏编辑对话框
                EditDialog.Visibility = Visibility.Collapsed;
                currentEditItem = null;

                StatusText.Text = "题目已更新";
            }
            catch (Exception ex)
            {
                StatusText.Text = $"更新失败: {ex.Message}";
            }
            MainContentGrid.Effect = null;
        }

        #endregion

        #region 辅助方法

        /// <summary>
        /// 从数据库中删除指定ID的题目
        /// </summary>
        private void DeleteQuestion(int id)
        {
            using (var connection = new SQLiteConnection($"Data Source={DbPath}"))
            {
                connection.Open();

                using (var command = connection.CreateCommand())
                {
                    command.CommandText = "DELETE FROM AIResponses WHERE Id = @id";
                    command.Parameters.AddWithValue("@id", id);
                    command.ExecuteNonQuery();
                }
            }
        }

        /// <summary>
        /// 更新数据库中指定ID的题目
        /// </summary>
        private void UpdateQuestion(int id, string question, string answer)
        {
            using (var connection = new SQLiteConnection($"Data Source={DbPath}"))
            {
                connection.Open();

                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        UPDATE AIResponses 
                        SET Question = @question, 
                            Answer = @answer
                        WHERE Id = @id";

                    command.Parameters.AddWithValue("@question", question);
                    command.Parameters.AddWithValue("@answer", answer);
                    command.Parameters.AddWithValue("@id", id);

                    command.ExecuteNonQuery();
                }
            }
        }

        /// <summary>
        /// 显示消息对话框
        /// </summary>
        private void ShowMessage(string message, MessageBoxImage icon = MessageBoxImage.Information)
        {
            WinMessageBox.Show(message, "提示", MessageBoxButton.OK, icon);
        }

        /// <summary>
        /// 截断文本，超过指定长度时添加省略号
        /// </summary>
        private string TruncateText(string text, int maxLength)
        {
            if (string.IsNullOrEmpty(text) || text.Length <= maxLength)
                return text;

            return text.Substring(0, maxLength) + "...";
        }

        #endregion // 辅助方法区域结束

    }

    /// <summary>
    /// 题目数据模型
    /// </summary>
    public class QuestionItem
    {
        public int Id { get; set; }
        public string Question { get; set; }
        public string Options { get; set; }
        public string QuestionType { get; set; }
        public string Answer { get; set; }
        public DateTime CreateTime { get; set; }
    }
}
#endregion