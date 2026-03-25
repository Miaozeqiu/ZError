import sqlite3
import jieba
import os
import logging

# 设置 jieba 日志级别，避免启动时输出加载信息
jieba.setLogLevel(logging.INFO)

class SearchEngine:
    def __init__(self, db_name='search_engine.db'):
        """
        初始化搜索引擎
        :param db_name: 数据库文件名
        """
        self.db_name = db_name
        self.conn = sqlite3.connect(db_name)
        self.cursor = self.conn.cursor()
        self._init_db()

    def _init_db(self):
        """初始化数据库表结构"""
        # 1. 创建普通表存储原始文档数据
        # id: 主键
        # title: 标题
        # content: 内容
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                content TEXT
            )
        ''')
        
        # 2. 创建 FTS5 虚拟表用于全文搜索
        # 我们存储分词后的 title 和 content 以便索引
        # tokenize='unicode61' 是默认分词器，对空格分隔的词支持良好
        self.cursor.execute('''
            CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
                title, 
                content, 
                tokenize='unicode61'
            )
        ''')
        self.conn.commit()

    def add_document(self, title, content):
        """
        添加文档到数据库
        :param title: 文档标题
        :param content: 文档内容
        """
        # 1. 插入原始数据到 docs 表
        self.cursor.execute('INSERT INTO docs (title, content) VALUES (?, ?)', (title, content))
        doc_id = self.cursor.lastrowid
        
        # 2. 对文本进行中文分词
        # jieba.cut_for_search 适合用于搜索引擎构建倒排索引的分词，粒度较细
        seg_title = " ".join(jieba.cut_for_search(title))
        seg_content = " ".join(jieba.cut_for_search(content))
        
        # 3. 插入分词后的数据到 docs_fts 表
        # 显式指定 rowid 为 doc_id，建立两张表的关联
        self.cursor.execute('INSERT INTO docs_fts (rowid, title, content) VALUES (?, ?, ?)', 
                            (doc_id, seg_title, seg_content))
        self.conn.commit()
        print(f"[添加成功] {title}")

    def full_text_search(self, query):
        """
        全文搜索
        :param query: 查询关键词
        :return: 搜索结果列表 [(title, snippet), ...]
        """
        if not query:
            return []

        # 1. 对查询词进行分词
        seg_query = " ".join(jieba.cut_for_search(query))
        
        # 2. 执行 FTS5 查询
        # 使用 snippet 函数生成高亮摘要
        # snippet(table_name, column_index, start_match, end_match, ellipsis, max_tokens)
        # column_index: -1 表示自动选择最匹配的列，或者指定具体列索引（0为title，1为content）
        # 这里我们主要想展示 content 的摘要，所以用 1
        sql = '''
            SELECT 
                d.title, 
                snippet(docs_fts, 1, '<b>', '</b>', '...', 20) as snippet
            FROM docs_fts
            JOIN docs d ON docs_fts.rowid = d.id
            WHERE docs_fts MATCH ?
            ORDER BY rank
        '''
        
        try:
            # 注意：如果查询包含特殊字符可能会导致语法错误，实际生产中需要清洗 query
            # 这里简单处理，假设 query 是安全的
            results = self.cursor.execute(sql, (seg_query,)).fetchall()
            
            # 处理结果：去除 snippet 中的多余空格（因为我们存储的是分词后的文本）
            # 分词后的文本是 "我 爱 中国"，snippet 可能是 "我 <b>爱</b> 中国"
            # 我们希望展示 "我<b>爱</b>中国"
            processed_results = []
            for title, snip in results:
                # 简单地移除所有空格，但这会破坏英文的空格。
                # 更精细的做法是只移除中文之间的空格，这里为了演示简单，
                # 我们先保留空格，或者简单替换。
                # 考虑到是中文演示，直接展示带空格的也无妨，或者简单 replace(' ', '')
                # 如果内容包含英文，replace 会导致英文单词连在一起。
                # 这里我们选择不做处理，直接返回，让用户看到分词效果。
                processed_results.append((title, snip))
                
            return processed_results
        except sqlite3.OperationalError as e:
            print(f"全文搜索出错: {e}")
            return []

    def fuzzy_search(self, query):
        """
        模糊搜索 (LIKE)
        :param query: 查询关键词
        :return: 搜索结果列表 [(title, content_preview), ...]
        """
        if not query:
            return []
            
        # 使用 %query% 进行模糊匹配
        sql = '''
            SELECT title, content 
            FROM docs 
            WHERE title LIKE ? OR content LIKE ?
        '''
        param = f'%{query}%'
        results = self.cursor.execute(sql, (param, param)).fetchall()
        
        # 简单的截取内容作为预览
        processed_results = []
        for title, content in results:
            # 找到关键词位置，截取前后一段
            idx = content.find(query)
            if idx != -1:
                start = max(0, idx - 10)
                end = min(len(content), idx + 20)
                preview = "..." + content[start:end] + "..."
            else:
                preview = content[:30] + "..."
            processed_results.append((title, preview))
            
        return processed_results

    def close(self):
        self.conn.close()

def main():
    # 为了演示，每次运行前清理旧数据库
    db_file = 'search_engine.db'
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
            print(f"已删除旧数据库: {db_file}")
        except PermissionError:
            print(f"无法删除旧数据库 {db_file}，可能正被占用。将尝试使用新数据库。")
            db_file = 'search_engine_new.db'

    engine = SearchEngine(db_file)

    # 准备测试数据
    data = [
        ("Python 教程", "Python 是一种解释型、面向对象、动态数据类型的高级程序设计语言。它语法简洁，适合初学者。"),
        ("SQLite 简介", "SQLite 是一个软件库，实现了自给自足的、无服务器的、零配置的、事务性的 SQL 数据库引擎。非常适合嵌入式应用。"),
        ("全文搜索原理", "全文搜索是指计算机索引程序通过扫描文章中的每一个词，对每一个词建立一个索引，指明该词在文章中出现的次数和位置。FTS5 是 SQLite 的全文搜索扩展。"),
        ("机器学习基础", "机器学习是一门多领域交叉学科，涉及概率论、统计学、逼近论、凸分析、算法复杂度理论等多门学科。它是人工智能的核心。"),
        ("深度学习", "深度学习是机器学习领域中一个新的研究方向，它被引入机器学习使其更接近于最初的目标——人工智能。神经网络是深度学习的基础。"),
        ("自然语言处理", "自然语言处理 (NLP) 是计算机科学，人工智能和语言学的交叉领域。目标是让计算机理解和生成人类语言。jieba 是一个流行的中文分词库。")
    ]

    print("\n--- 1. 正在建立索引 ---")
    for title, content in data:
        engine.add_document(title, content)
    
    print("\n" + "="*50)
    print("欢迎使用 SQLite 搜索引擎")
    print("输入关键字进行搜索，输入 'q' 或 'quit' 退出")
    print("="*50)
    
    while True:
        try:
            # 获取用户输入
            query = input("\n请输入搜索关键字: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n退出...")
            break
            
        if query.lower() in ('q', 'quit', 'exit'):
            print("感谢使用，再见！")
            break
        
        if not query:
            continue
            
        print(f"\n>>> 正在搜索: '{query}'")
        
        # 全文搜索
        print("-" * 20 + " 全文搜索 (FTS5) " + "-" * 20)
        fts_results = engine.full_text_search(query)
        if fts_results:
            for title, snippet in fts_results:
                print(f"  [标题] {title}")
                print(f"  [摘要] {snippet}")
        else:
            print("  (无全文搜索结果)")
            
        # 模糊搜索
        print("-" * 20 + " 模糊搜索 (LIKE) " + "-" * 20)
        fuzzy_results = engine.fuzzy_search(query)
        if fuzzy_results:
            for title, preview in fuzzy_results:
                print(f"  [标题] {title}")
                print(f"  [预览] {preview}")
        else:
            print("  (无模糊搜索结果)")

    engine.close()

if __name__ == '__main__':
    main()
