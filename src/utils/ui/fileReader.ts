import { readFile } from '@tauri-apps/plugin-fs';
import * as XLSX from 'xlsx';
// @ts-ignore
import mammoth from 'mammoth';

export async function readFileText(path: string): Promise<string> {
  try {
    const data = await readFile(path);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data);
  } catch (error) {
    console.error('Frontend readFileText error:', error);
    throw error;
  }
}

export async function readFileBase64(path: string): Promise<string> {
  const data = await readFile(path);
  const blob = new Blob([data]);
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
          const res = reader.result as string;
          // remove "data:application/octet-stream;base64," prefix
          const base64 = res.split(',')[1];
          resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
  });
}

export async function readExcelHeaders(path: string): Promise<string[]> {
  try {
    // Read first 20 rows to find header
    const { data: rows } = await readExcelRange(path, 0, 19); 
    for (const row of rows) {
      if (row.some(cell => cell.trim().length > 0)) {
        return row;
      }
    }
    return [];
  } catch (error) {
    console.error('Frontend readExcelHeaders error:', error);
    throw error;
  }
}

export async function readExcelRange(path: string, start: number, end: number): Promise<{ data: string[][], total: number }> {
  try {
    const data = await readFile(path);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { data: [], total: 0 };
    const sheet = workbook.Sheets[sheetName];
    // header: 1 returns array of arrays
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Slice rows
    const total = rows.length;
    const s = Math.max(0, Math.min(start, total - 1));
    const e = Math.max(s, Math.min(end, total - 1));
    
    const result = rows.slice(s, e + 1).map(row => 
      row.map(cell => {
        if (cell === null || cell === undefined) return '';
        return String(cell);
      })
    );
    return { data: result, total };
  } catch (error) {
    console.error('Frontend readExcelRange error:', error);
    throw error;
  }
}

export async function readDocxRange(path: string, start: number, end: number): Promise<{ data: string[], total: number }> {
  try {
    const data = await readFile(path);
    // mammoth extractRawText returns a promise with value
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    const text = result.value;
    // Split into paragraphs (mammoth usually separates pars with \n\n or \n)
    const paragraphs = text.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
    
    const total = paragraphs.length;
    const s = Math.max(0, Math.min(start, total - 1));
    const e = Math.max(s, Math.min(end, total - 1));
    
    return { data: paragraphs.slice(s, e + 1), total };
  } catch (error) {
    console.error('Frontend readDocxRange error:', error);
    throw error;
  }
}

// Simple RTF Parser
function parseRtf(text: string): string {
  let out = '';
  let i = 0;
  const len = text.length;
  
  while (i < len) {
    const c = text[i];
    
    if (c === '{' || c === '}') {
      i++;
      continue;
    }
    
    if (c === '\\') {
      i++;
      if (i >= len) break;
      const c2 = text[i];
      
      // Hex: \'xx
      if (c2 === "'") {
        if (i + 2 < len) {
          const hex = text.substring(i + 1, i + 3);
          try {
            const code = parseInt(hex, 16);
            out += String.fromCharCode(code);
          } catch {}
          i += 3;
        } else {
          i++;
        }
        continue;
      }
      
      // Unicode: \uN
      if (c2 === 'u' && i + 1 < len && (text[i+1] === '-' || /[0-9]/.test(text[i+1]))) {
        i++;
        let sign = 1;
        if (i < len && text[i] === '-') {
          sign = -1;
          i++;
        }
        let numStr = '';
        while (i < len && /[0-9]/.test(text[i])) {
          numStr += text[i];
          i++;
        }
        if (numStr.length > 0) {
          let code = parseInt(numStr, 10) * sign;
          if (code < 0) code += 65536;
          out += String.fromCharCode(code);
        }
        // skip delimiter ? or space
        if (i < len && (text[i] === ' ' || text[i] === '?')) i++;
        continue;
      }
      
      // Control word or symbol
      if (/[a-zA-Z]/.test(c2)) {
        let j = i;
        while (j < len && /[a-zA-Z]/.test(text[j])) j++;
        const cmd = text.substring(i, j);
        
        if (cmd === 'par') {
          out += '\n';
        } else if (cmd === 'tab') {
            out += '\t';
        }
        
        // Skip delimiter space
        if (j < len && text[j] === ' ') j++;
        i = j;
        continue;
      } else {
          // Symbol like \{ \} \\
          out += c2;
          i++;
          continue;
      }
    }
    
    if (c !== '\r' && c !== '\n') {
      out += c;
    }
    i++;
  }
  return out;
}

// Simple HTML Text Extractor (for Fake .doc)
function extractTextFromHtml(data: Uint8Array): string {
  // 1. Detect encoding
  let text = '';
  let encoding = 'utf-8';
  
  // Check for charset in meta tag (first 1000 bytes)
  try {
    const headerSlice = data.slice(0, 1000);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const header = decoder.decode(headerSlice).toLowerCase();
    const metaMatch = header.match(/<meta[^>]+charset=["']?([-\w]+)["']?/i);
    if (metaMatch && metaMatch[1]) {
      encoding = metaMatch[1];
      // Normalize common Chinese encodings
      if (['gb2312', 'gbk', 'gb18030'].includes(encoding)) {
        encoding = 'gbk';
      }
    } else {
      // No meta charset found. Heuristic check:
      // If it's valid UTF-8, prefer UTF-8.
      try {
        const checkDecoder = new TextDecoder('utf-8', { fatal: true });
        checkDecoder.decode(data);
        encoding = 'utf-8';
      } catch {
        // Invalid UTF-8, assume GBK for Chinese context fallback
        encoding = 'gbk';
      }
    }
  } catch (e) {
    // Fallback
    encoding = 'utf-8';
  }

  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    text = decoder.decode(data);
  } catch {
    // Fallback to Latin1 if specified encoding fails completely (unlikely with fatal: false)
    const decoder = new TextDecoder('iso-8859-1');
    text = decoder.decode(data);
  }

  // 3. Strip HTML tags
  let content = text;
  
  // Replace block tags with newlines
  content = content.replace(/<(p|div|br|tr|li|h[1-6])\b[^>]*>/gi, '\n');
  
  // Strip all other tags
  content = content.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities (basic ones)
  content = content.replace(/&nbsp;/g, ' ')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&amp;/g, '&')
                   .replace(/&quot;/g, '"')
                   .replace(/&apos;/g, "'");

  return content;
}

// Simple Binary Doc Text Extractor (Heuristic)
function extractTextFromBinary(data: Uint8Array): string {
  // Try to decode as GBK (common for Chinese docs) or fallback to Latin1
  let text = '';
  try {
    const decoder = new TextDecoder('gbk', { fatal: false });
    text = decoder.decode(data);
  } catch {
    const decoder = new TextDecoder('iso-8859-1');
    text = decoder.decode(data);
  }

  // Filter out binary garbage
  // Keep: Chinese characters (\u4e00-\u9fa5), ASCII printable (\x20-\x7E), newlines
  // We'll treat long sequences of non-printable chars as delimiters
  
  let cleanText = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Keep printable, newline, tab, and Chinese range
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9 || (code >= 0x4e00 && code <= 0x9fa5) || (code >= 0xFF00 && code <= 0xFFEF)) {
      cleanText += text[i];
    } else {
      cleanText += '\n'; // Treat garbage as break
    }
  }
  
  return cleanText;
}

export async function readDocRange(path: string, start: number, end: number): Promise<{ data: string[], total: number }> {
  try {
    const data = await readFile(path);
    
    // Check for RTF signature: {\rtf
    // RTF is usually ASCII 7-bit header
    let isRtf = false;
    let isHtml = false;

    // Check header signature
    if (data.length > 20) {
      // Decode loosely as ascii to check header, check first 100 bytes to catch garbage prefix
      const header = new TextDecoder('ascii').decode(data.slice(0, 100)).toLowerCase(); 
      if (header.includes('{\\rtf')) {
        isRtf = true;
      } else if (header.includes('<html') || header.includes('<!doctype html') || header.includes('<?xml')) {
        isHtml = true;
      }
    }

    let paragraphs: string[] = [];

    if (isRtf) {
      const decoder = new TextDecoder('utf-8'); 
      let text = decoder.decode(data);
      text = parseRtf(text);
      paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    } else if (isHtml) {
      // Fake .doc (HTML)
      const text = extractTextFromHtml(data);
      paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    } else {
      // Binary .doc
      const text = extractTextFromBinary(data);
      // Clean up multiple newlines
      paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 1); // Filter very short garbage
    }
    
    const total = paragraphs.length;
    const s = Math.max(0, Math.min(start, total - 1));
    const e = Math.max(s, Math.min(end, total - 1));
    
    return { data: paragraphs.slice(s, e + 1), total };
  } catch (error) {
    console.error('Frontend readDocRange error:', error);
    throw error;
  }
}
