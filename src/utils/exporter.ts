import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { AIResponse } from '../services/app/database';
import { difficultyLabel, importanceLabel, masteryLabel } from './questionMetrics';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type SystemCjkFont = { family: string; data: string };

let systemCjkFontPromise: Promise<SystemCjkFont> | null = null;

const loadSystemCjkFont = () => {
  if (!systemCjkFontPromise) {
    systemCjkFontPromise = invoke<SystemCjkFont>('load_cjk_system_font').catch((error) => {
      systemCjkFontPromise = null;
      throw error;
    });
  }
  return systemCjkFontPromise;
};

export type ExportFormat = 'csv' | 'xlsx' | 'docx' | 'pdf' | 'txt';

export const generateExportData = async (questions: AIResponse[], format: ExportFormat): Promise<Uint8Array> => {
  switch (format) {
    case 'csv':
      return generateCSV(questions);
    case 'xlsx':
      return generateXLSX(questions);
    case 'docx':
      return await generateDOCX(questions);
    case 'txt':
      return generateTXT(questions);
    case 'pdf':
      return await generatePDF(questions);
    default:
      throw new Error(`不支持的格式: ${format}`);
  }
};

const generateCSV = (questions: AIResponse[]): Uint8Array => {
  const header = ['ID', '题目', '选项', '答案', '类型', '重要性', '掌握程度', '难度', '创建时间'];
  const rows = questions.map((q, index) => [
    (index + 1).toString(),
    `"${(q.question || '').replace(/"/g, '""')}"`,
    `"${(q.options || '').replace(/"/g, '""')}"`,
    `"${(q.answer || '').replace(/"/g, '""')}"`,
    `"${(q.question_type || '').replace(/"/g, '""')}"`,
    `"${importanceLabel(q.importance)}"`,
    `"${masteryLabel(q.mastery)}"`,
    `"${difficultyLabel(q.difficulty)}"`,
    `"${(q.create_time || '').replace(/"/g, '""')}"`
  ]);
  
  const csvContent = [
    header.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  // Add BOM for Excel to recognize UTF-8
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const content = new TextEncoder().encode(csvContent);
  const combined = new Uint8Array(bom.length + content.length);
  combined.set(bom);
  combined.set(content, bom.length);
  return combined;
};

const generateTXT = (questions: AIResponse[]): Uint8Array => {
  const content = questions.map((q, index) => {
    return `题目 ${index + 1} (ID: ${index + 1}):
${q.question}

选项:
${q.options || '无'}

答案:
${q.answer}

类型: ${q.question_type}
重要性: ${importanceLabel(q.importance)}
掌握程度: ${masteryLabel(q.mastery)}
难度: ${difficultyLabel(q.difficulty)}
创建时间: ${q.create_time}
--------------------------------------------------
`;
  }).join('\n');
  
  return new TextEncoder().encode(content);
};

const generateXLSX = (questions: AIResponse[]): Uint8Array => {
  const data = questions.map((q, index) => ({
    'ID': index + 1,
    '题目': q.question,
    '选项': q.options,
    '答案': q.answer,
    '类型': q.question_type,
    '重要性': importanceLabel(q.importance),
    '掌握程度': masteryLabel(q.mastery),
    '难度': difficultyLabel(q.difficulty),
    '创建时间': q.create_time
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "题目列表");
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(wbout);
};

const generateDOCX = async (questions: AIResponse[]): Promise<Uint8Array> => {
  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "ID", alignment: AlignmentType.CENTER })], width: { size: 5, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "题目", alignment: AlignmentType.CENTER })], width: { size: 34, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "选项", alignment: AlignmentType.CENTER })], width: { size: 20, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "答案", alignment: AlignmentType.CENTER })], width: { size: 16, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "类型", alignment: AlignmentType.CENTER })], width: { size: 9, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "重要性", alignment: AlignmentType.CENTER })], width: { size: 8, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "掌握程度", alignment: AlignmentType.CENTER })], width: { size: 8, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: "难度", alignment: AlignmentType.CENTER })], width: { size: 7, type: WidthType.PERCENTAGE } }),
      ],
      tableHeader: true,
    })
  ];

  questions.forEach((q, index) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph((index + 1).toString())] }),
          new TableCell({ children: [new Paragraph(q.question || '')] }),
          new TableCell({ children: [new Paragraph(q.options || '')] }),
          new TableCell({ children: [new Paragraph(q.answer || '')] }),
          new TableCell({ children: [new Paragraph(q.question_type || '')] }),
          new TableCell({ children: [new Paragraph(importanceLabel(q.importance))] }),
          new TableCell({ children: [new Paragraph(masteryLabel(q.mastery))] }),
          new TableCell({ children: [new Paragraph(difficultyLabel(q.difficulty))] }),
        ],
      })
    );
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: "题目导出列表", bold: true, size: 32 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        }),
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

const generatePDF = async (questions: AIResponse[]): Promise<Uint8Array> => {
  try {
    const systemFont = await loadSystemCjkFont();
    const doc = new jsPDF();
    doc.addFileToVFS('SystemCJK.ttf', systemFont.data);
    doc.addFont('SystemCJK.ttf', 'SystemCJK', 'normal');
    doc.setFont('SystemCJK');

    const head = [['ID', '题目', '选项', '答案', '类型', '重要性', '掌握程度', '难度', '创建时间']];
    const body = questions.map((q, index) => [
      (index + 1).toString(),
      q.question || '',
      q.options || '',
      q.answer || '',
      q.question_type || '',
      importanceLabel(q.importance),
      masteryLabel(q.mastery),
      difficultyLabel(q.difficulty),
      q.create_time || ''
    ]);

    doc.setFontSize(18);
    doc.text('题目列表', 105, 15, { align: 'center' });

    autoTable(doc, {
      head: head,
      body: body,
      startY: 25,
      styles: {
        font: 'SystemCJK',
        fontStyle: 'normal',
        overflow: 'linebreak',
        cellWidth: 'wrap'
      },
      columnStyles: {
        0: { cellWidth: 15 }, // ID
        1: { cellWidth: 60 }, // 题目
        2: { cellWidth: 40 }, // 选项
        3: { cellWidth: 25 }, // 答案
        4: { cellWidth: 16 }, // 类型
        5: { cellWidth: 16 }, // 重要性
        6: { cellWidth: 16 }, // 掌握程度
        7: { cellWidth: 14 }, // 难度
        8: { cellWidth: 22 }  // 时间
      }
    });

    // 5. 嵌入隐藏数据 (隐写术)
    // 将原始数据转换为 JSON 并 Base64 编码，写入 PDF 的不可见区域或以白色字体写入
    // 这样导入时可以直接读取这些数据，实现 100% 准确还原
    try {
      const jsonData = JSON.stringify(questions);
      // 使用简单的 Base64 编码处理中文
      const base64Data = btoa(unescape(encodeURIComponent(jsonData)));
      const hiddenContent = `<<<ZERROR_DATA_START>>>${base64Data}<<<ZERROR_DATA_END>>>`;
      
      // 新起一页（或者在最后一页）
      doc.addPage();
      // 设置为白色字体，极小字号
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(1);
      
      // 分块写入，防止单行过长
      const chunkSize = 1000;
      for (let i = 0; i < hiddenContent.length; i += chunkSize) {
        doc.text(hiddenContent.substring(i, i + chunkSize), 10, 10 + (i / chunkSize));
      }
      
      console.log('已嵌入隐藏数据到 PDF');
    } catch (e) {
      console.warn('嵌入隐藏数据失败:', e);
    }

    return new Uint8Array(doc.output('arraybuffer'));
  } catch (error) {
    console.error('生成 PDF 失败:', error);
    throw new Error(`生成 PDF 失败: ${(error as Error).message}`);
  }
};
