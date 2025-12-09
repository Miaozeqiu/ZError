import * as XLSX from 'xlsx';
import { databaseService } from '../services/database';
import mammoth from 'mammoth';
import { readFile } from '@tauri-apps/plugin-fs';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 worker 路径
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface ImportedQuestion {
    question: string;
    options: string | null;
    answer: string;
    question_type: string;
}

export const parseSoftwareExportedFile = async (filePath: string): Promise<ImportedQuestion[]> => {
    if (filePath.endsWith('.csv')) {
        return await parseCSV(filePath);
    } else if (filePath.endsWith('.xlsx')) {
        return await parseXLSX(filePath);
    } else if (filePath.endsWith('.docx')) {
        return await parseDOCX(filePath);
    } else if (filePath.endsWith('.txt')) {
        return await parseTXT(filePath);
    } else if (filePath.endsWith('.pdf')) {
        return await parsePDF(filePath);
    } else {
        throw new Error('不支持的文件格式');
    }
};

const parsePDF = async (filePath: string): Promise<ImportedQuestion[]> => {
    try {
        const content = await readFile(filePath);
        const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
        
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = '';

        // 1. 尝试提取隐藏的结构化数据
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items as any[];
            
            // 将该页所有文本连接起来，检查是否包含标记
            const pageRawText = items.map(item => item.str).join('');
            
            const startMarker = '<<<ZERROR_DATA_START>>>';
            const endMarker = '<<<ZERROR_DATA_END>>>';
            
            const startIndex = pageRawText.indexOf(startMarker);
            const endIndex = pageRawText.indexOf(endMarker);
            
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                console.log('Found hidden data in PDF');
                const base64Data = pageRawText.substring(startIndex + startMarker.length, endIndex);
                try {
                    // 解码 Base64 -> JSON -> 对象
                    const jsonString = decodeURIComponent(escape(atob(base64Data)));
                    const questions = JSON.parse(jsonString);
                    
                    // 映射到 ImportedQuestion 格式
                    return questions.map((q: any) => ({
                        question: q.question || '',
                        options: q.options || null,
                        answer: q.answer || '',
                        question_type: q.question_type || ''
                    }));
                } catch (e) {
                    console.error('Failed to parse hidden data:', e);
                }
            }
            
            // 如果没有找到隐藏数据，继续常规文本提取逻辑用于回退
            // ...
        }
        
        // 如果遍历所有页面都没找到隐藏数据，则执行常规解析
        console.warn('No hidden data found, falling back to text extraction');

        // 遍历所有页面提取文本 (用于回退解析)
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items as any[];
            
            // 简单按行合并文本
            const rows: { y: number, text: string }[] = [];
            items.forEach(item => {
                const y = item.transform[5];
                const existingRow = rows.find(r => Math.abs(r.y - y) < 5);
                if (existingRow) {
                    existingRow.text += ' ' + item.str;
                } else {
                    rows.push({ y, text: item.str });
                }
            });
            rows.sort((a, b) => b.y - a.y);
            const pageText = rows.map(r => r.text).join('\n');
            fullText += pageText + '\n';
        }
        
        console.log('PDF Extracted Text:', fullText); // Debug log

        // 尝试解析文本内容
        if (!fullText.includes('--------------------------------------------------')) {
             // ... (保留之前的启发式解析逻辑)
             // 尝试逐行解析：ID 题目 选项 答案 类型 创建时间
             const lines = fullText.split('\n');
             const questions: ImportedQuestion[] = [];
             // ...
             // 这里我们可以直接调用 parsePDFByRegex，复用之前的逻辑
             return parsePDFByRegex(loadingTask);
        }

        return parseTXTContent(fullText);
    } catch (error) {
        console.error('PDF parsing error:', error);
        throw new Error('PDF 解析失败: ' + (error as Error).message);
    }
};

const parsePDFWithCoordinates = async (loadingTask: any): Promise<ImportedQuestion[]> => {
    const pdf = await loadingTask.promise;
    const questions: ImportedQuestion[] = [];
    
    // 遍历所有页面
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items as any[];
        
        // 1. 按 Y 坐标分组（行）
        const rows: { y: number, items: any[] }[] = [];
        items.forEach(item => {
            const y = item.transform[5];
            const existingRow = rows.find(r => Math.abs(r.y - y) < 5);
            if (existingRow) {
                existingRow.items.push(item);
            } else {
                rows.push({ y, items: [item] });
            }
        });
        
        // 按 Y 坐标从上到下排序
        rows.sort((a, b) => b.y - a.y);
        
        // 2. 识别列边界
        // 假设第二行是表头（第一行通常是标题），我们可以从表头推断列的大致位置
        // 但简单起见，我们假设列的相对顺序是固定的：ID, 题目, 选项, 答案, 类型, 创建时间
        // 我们将每行中的 items 按 X 坐标排序
        
        rows.forEach(row => {
            // 按 X 坐标排序
            row.items.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
            
            // 过滤掉表头和页码等
            const rowText = row.items.map(item => item.str).join('');
            if (rowText.includes('ID') && rowText.includes('题目') && rowText.includes('答案')) return;
            if (rowText.trim() === '题目列表') return;
            if (/^\d+\s*\/ \d+$/.test(rowText.trim())) return; // 页码
            
            // 尝试提取数据
            // 策略：根据 items 的数量和位置进行推断
            // 这种方法对于跨行的长文本（题目、选项）仍然有局限性，因为 PDF.js 会把长文本拆分成多个 items
            // 但 jspdf-autotable 生成的表格，通常同一单元格内的文本会有相同的 X 坐标（对齐）
            
            // 简单的启发式：ID 是第一个且是数字
            const firstItem = row.items[0];
            if (!firstItem || !/^\d+$/.test(firstItem.str.trim())) return;
            
            // 这是一个新行的开始
            // 我们需要收集这一行（逻辑行）的所有数据
            // 实际上，jspdf-autotable 的一行可能对应 PDF 中的多个物理行（Y 坐标不同）
            // 这是一个复杂的问题。
            
            // 简化处理：假设每一行就是一条记录（忽略长文本换行的情况，或者只提取第一行）
            // 更好的处理：根据 X 坐标将 items 归类到 6 个桶（bucket）中
            
            // 定义列的大致 X 坐标范围（根据页面宽度和列宽比例估计）
            // ID: 5%, 题目: 40%, 选项: 25%, 答案: 15%, 类型: 15%
            // 假设页面宽度 A4 约 595pt
            // ID: 0-30, 题目: 30-270, 选项: 270-420, 答案: 420-510, 类型: 510-595 (大致估计)
            // 动态计算：取第一行 items 的 X 坐标作为参考？
            
            // 尝试直接根据 items 的相对顺序
            // 如果 items 数量 >= 5，我们尝试映射
            // [ID, 题目..., 选项..., 答案..., 类型..., 时间]
            
            // 这种基于位置的解析非常脆弱。
            // 鉴于 PDF 解析的难度，我们尝试提取最核心的信息：题目和答案
            
            // 尝试构建文本行，然后用正则匹配
            const lineText = row.items.map(it => it.str).join(' ');
            
            // 我们的目标是提取：题目、选项、答案
            // 假设文本顺序是 ID 题目 选项 答案 类型 时间
            // 我们可以尝试去除 ID 和 时间，剩下的就是中间部分
            
            // 这是一个非常粗糙的实现，只能作为最后的手段
            // 实际上，要完美解析 PDF 表格，需要复杂的布局分析算法
            
            // 暂时只支持简单的一行一条记录的情况
            if (row.items.length >= 4) {
                // 假设 row.items[1] 是题目的一部分
                // 这只是一个 placeholder，实际上很难通用
            }
        });
    }
    
    // 如果上面的逻辑太复杂且不可靠，我们回退到基于全文本的正则匹配
    // 但放宽正则的条件
    return parsePDFByRegex(loadingTask);
};

const parsePDFByRegex = async (loadingTask: any): Promise<ImportedQuestion[]> => {
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items as any[];
        
        // 简单的 Y 轴排序和合并
        const rows: { y: number, text: string }[] = [];
        items.forEach(item => {
            const y = item.transform[5];
            const existingRow = rows.find(r => Math.abs(r.y - y) < 5);
            if (existingRow) existingRow.text += ' ' + item.str;
            else rows.push({ y, text: item.str });
        });
        rows.sort((a, b) => b.y - a.y);
        fullText += rows.map(r => r.text).join('\n') + '\n';
    }
    
    const questions: ImportedQuestion[] = [];
    // 尝试匹配行首的 ID
    const lines = fullText.split('\n');
    
    for (const line of lines) {
        // 匹配模式：数字 [空格] 题目内容 [空格] (选项) [空格] 答案 [空格] 类型 [空格] 时间
        // 例如：123 这是一个题目 A.选项B.选项 答案A 单选题 2023-10-01
        // 这种正则极难写对，因为题目本身包含空格
        
        // 既然我们控制导出，我们知道列的顺序。
        // 我们可以尝试从后往前匹配：时间 -> 类型 -> 答案 -> 选项 -> 题目 -> ID
        
        const timeRegex = /(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s\d{1,2}:\d{1,2}(?::\d{1,2})?)?)$/;
        const timeMatch = line.match(timeRegex);
        
        if (timeMatch) {
            const createTime = timeMatch[1];
            let remaining = line.substring(0, line.length - createTime.length).trim();
            
            // 匹配类型 (假设类型不包含空格，或者是已知的几种)
            // 倒数第一个单词
            const lastSpaceIndex = remaining.lastIndexOf(' ');
            if (lastSpaceIndex === -1) continue;
            
            const type = remaining.substring(lastSpaceIndex + 1);
            const question_type = type; // 简单赋值
            remaining = remaining.substring(0, lastSpaceIndex).trim();
            
            // 匹配答案 (倒数部分)
            // 答案通常较短，但也可能包含空格
            // 这是一个难点。假设答案是一个单词或短语
            // 让我们再次取最后一个部分作为答案
            const lastSpaceIndex2 = remaining.lastIndexOf(' ');
            const answer = lastSpaceIndex2 !== -1 ? remaining.substring(lastSpaceIndex2 + 1) : remaining;
            remaining = lastSpaceIndex2 !== -1 ? remaining.substring(0, lastSpaceIndex2).trim() : '';
            
            // 匹配 ID (开头)
            const idMatch = remaining.match(/^(\d+)\s+/);
            if (idMatch) {
                const id = idMatch[1];
                remaining = remaining.substring(idMatch[0].length).trim();
                
                // 剩下的就是 题目 + 选项
                // 很难区分题目和选项，除非有特定的选项格式 (如 A. B.)
                // 我们简单地将剩余部分都作为题目，选项留空（或者尝试分割）
                
                let question = remaining;
                let options: string | null = null;
                
                // 尝试查找选项的开始 (A. 或 A、)
                const optionMatch = question.match(/\s([A-F][\.,、])/);
                if (optionMatch && optionMatch.index) {
                    options = question.substring(optionMatch.index + 1);
                    question = question.substring(0, optionMatch.index);
                }
                
                questions.push({
                    question,
                    options,
                    answer,
                    question_type
                });
            }
        }
    }
    
    return questions;
};

const parseCSV = async (filePath: string): Promise<ImportedQuestion[]> => {
    const content = await readFile(filePath);
    const text = new TextDecoder().decode(content);
    const rows = text.split('\n').map(row => row.split(','));
    // Assuming header is ID, 题目, 选项, 答案, 类型, 创建时间
    // Skip header
    const questions: ImportedQuestion[] = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 5) continue;
        questions.push({
            question: row[1].replace(/^"|"$/g, '').replace(/""/g, '"'),
            options: row[2].replace(/^"|"$/g, '').replace(/""/g, '"') || null,
            answer: row[3].replace(/^"|"$/g, '').replace(/""/g, '"'),
            question_type: row[4].replace(/^"|"$/g, '').replace(/""/g, '"'),
        });
    }
    return questions;
};

const parseXLSX = async (filePath: string): Promise<ImportedQuestion[]> => {
    const content = await readFile(filePath);
    const workbook = XLSX.read(content, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

    return jsonData.map(row => ({
        question: row['题目'] || '',
        options: row['选项'] || null,
        answer: row['答案'] || '',
        question_type: row['类型'] || '',
    }));
};

const parseDOCX = async (filePath: string): Promise<ImportedQuestion[]> => {
    const content = await readFile(filePath);
    const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    
    try {
        // 尝试转换为 HTML 以解析表格结构
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const table = doc.querySelector('table');
        
        if (table) {
            const questions: ImportedQuestion[] = [];
            const rows = Array.from(table.querySelectorAll('tr'));
            
            // 辅助函数：提取单元格文本并保留换行
            const getCellText = (cell: HTMLTableCellElement | undefined) => {
                if (!cell) return '';
                // 简单处理：mammoth 通常将段落转为 <p>
                // 我们将 <p> 后面添加换行符，将 <br> 替换为换行符
                let text = cell.innerHTML;
                text = text.replace(/<br\s*\/?>/gi, '\n');
                text = text.replace(/<\/p>/gi, '\n');
                // 移除其他 HTML 标签
                text = text.replace(/<[^>]+>/g, '');
                // 解码 HTML 实体 (简单处理)
                text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                return text.trim();
            };

            // 跳过第一行（表头）
            // 预期列: ID(0), 题目(1), 选项(2), 答案(3), 类型(4), 创建时间(5)
            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td');
                if (cells.length >= 5) {
                    const question = getCellText(cells[1]);
                    const options = getCellText(cells[2]) || null;
                    const answer = getCellText(cells[3]);
                    const question_type = getCellText(cells[4]);
                    
                    if (question) {
                        questions.push({
                            question,
                            options,
                            answer,
                            question_type
                        });
                    }
                }
            }
            
            if (questions.length > 0) {
                return questions;
            }
        }
    } catch (e) {
        console.warn('Mammoth HTML conversion failed or no table found, falling back to raw text', e);
    }
    
    // Fallback: 解析失败或没有表格时，尝试提取纯文本
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseTXTContent(result.value);
};

const parseTXT = async (filePath: string): Promise<ImportedQuestion[]> => {
    const content = await readFile(filePath);
    const text = new TextDecoder().decode(content);
    return parseTXTContent(text);
};

const parseTXTContent = (text: string): ImportedQuestion[] => {
    const questions: ImportedQuestion[] = [];
    const parts = text.split('--------------------------------------------------');
    
    for (const part of parts) {
        if (!part.trim()) continue;
        
        const questionMatch = part.match(/题目 \d+ \(ID: \d+\):\s*([\s\S]*?)(?=\n\s*选项:|$)/);
        const optionsMatch = part.match(/选项:\s*([\s\S]*?)(?=\n\s*答案:|$)/);
        const answerMatch = part.match(/答案:\s*([\s\S]*?)(?=\n\s*类型:|$)/);
        const typeMatch = part.match(/类型: (.*)/);
        
        if (questionMatch) {
            questions.push({
                question: questionMatch[1].trim(),
                options: optionsMatch ? optionsMatch[1].trim() : null,
                answer: answerMatch ? answerMatch[1].trim() : '',
                question_type: typeMatch ? typeMatch[1].trim() : '',
            });
        }
    }
    return questions;
};
