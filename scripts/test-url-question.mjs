// Node.js 24+: exercise the current TypeScript source without generated fixtures.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseUrlOptions,
  classifyUrlQuestionMode,
  buildUrlOptionMapForMode,
  buildUrlQuestionPromptParts,
  resolveUrlAnswer,
} from '../src/utils/answer/urlQuestion.ts'

const decimalInput = '0.3\n0.1\n0.2\n0.4'
const letterInput = 'A. 键盘\nB. 显示器\nC. 鼠标\nD. 打印机'
const expectedMap = values => values.map((value, index) => [String(index + 1), value])
const parseCases = [
  ['unlabelled decimals', decimalInput, ['0.3', '0.1', '0.2', '0.4']],
  ['decimals that resemble sequential labels', '1.5\n2.5\n3.5\n4.5', ['1.5', '2.5', '3.5', '4.5']],
  ['decimal units', '0.3 千克\n0.5 千克\n1.2 千克', ['0.3 千克', '0.5 千克', '1.2 千克']],
  ['unlabelled Chinese', '苹果\n香蕉\n橙子', ['苹果', '香蕉', '橙子']],
  ['integer units', '10 kg\n20 kg', ['10 kg', '20 kg']],
  ['adjacent integer units', '10千克\n20千克', ['10千克', '20千克']],
  ['English phrases', 'New York\nLos Angeles', ['New York', 'Los Angeles']],
  ['formulas', 'x+y\nx-y', ['x+y', 'x-y']],
  ['letter labels', letterInput, ['键盘', '显示器', '鼠标', '打印机']],
  ['number labels', '1. 甲\n2. 乙\n3. 丙', ['甲', '乙', '丙']],
  ['Chinese enumeration labels', '1、5\n2、6\n3、7', ['5', '6', '7']],
  ['multiline letter text', 'A. 第一行\n第二行\nB. 选项B', ['第一行\n第二行', '选项B']],
  ['letter decimal continuation', 'A. 概率\n0.3\nB. 概率\n0.4', ['概率\n0.3', '概率\n0.4']],
  ['empty letter headings', 'A.\n0.3\nB.\n0.4', ['0.3', '0.4']],
  ['number decimal continuation', '1. 数值\n0.3\n2. 数值\n0.4', ['数值\n0.3', '数值\n0.4']],
  ['empty number headings', '1.\n0.3\n2.\n0.4', ['0.3', '0.4']],
  ['number blocks starting above one', '2. 甲\n补充甲\n3. 乙\n补充乙', ['甲\n补充甲', '乙\n补充乙']],
  ['number blocks with gaps', '2. 甲\n补充甲\n4. 乙\n补充乙', ['甲\n补充甲', '乙\n补充乙']],
  ['fullwidth decimal points', '0．3\n1．5', ['0．3', '1．5']],
  ['CRLF and blank lines', '\r\n 0.3 \r\n\r\n 0.4 \r\n', ['0.3', '0.4']],
  ['fullwidth labels with decimal contents', '1． 0.3\n2． 0.4', ['0.3', '0.4']],
  ['signed decimal contents', '0.3\n-0.1\n+0.2', ['0.3', '-0.1', '+0.2']],
]

for (const [name, input, expected] of parseCases) {
  test(`parse: ${name}`, () => {
    assert.deepStrictEqual([...parseUrlOptions(input, { allowLineFallback: true })], expectedMap(expected))
  })
}

test('decimals alone do not infer labels when the question type is missing', () => {
  assert.equal(parseUrlOptions(decimalInput, { preferLabeledOnly: true }).size, 0)
  assert.equal(classifyUrlQuestionMode('', decimalInput), 'open')
})

test('labelled decimal continuation still infers a choice question', () => {
  assert.equal(classifyUrlQuestionMode('', 'A.\n0.3\nB.\n0.4'), 'single')
  assert.equal(classifyUrlQuestionMode('', '1.\n0.3\n2.\n0.4'), 'single')
})

test('Chinese enumeration labels still infer a choice question', () => {
  assert.equal(classifyUrlQuestionMode('', '1、5\n2、6\n3、7'), 'single')
})

test('unlabelled fallback remains opt-in', () => {
  assert.equal(parseUrlOptions('10 kg\n20 kg').size, 0)
  assert.equal(buildUrlOptionMapForMode('open', decimalInput).size, 0)
})

const answerCases = [
  ['decimal by number', decimalInput, 'single', '分析过程\nANSWER: 4', '0.4'],
  ['decimal verbatim', decimalInput, 'single', 'ANSWER: 0.4', '0.4'],
  ['multiple decimals', decimalInput, 'multiple', 'ANSWER: 1 3', '0.3###0.2'],
  ['multiple letter labels', letterInput, 'multiple', 'ANSWER: A C', '键盘###鼠标'],
  ['integer unit by number', '10 kg\n20 kg', 'single', 'ANSWER: 2', '20 kg'],
  ['multiple integer units', '10 kg\n20 kg', 'multiple', 'ANSWER: A B', '10 kg###20 kg'],
  ['multiline decimal answer', 'A. 概率\n0.3\nB. 概率\n0.4', 'single', 'ANSWER: 2', '概率\n0.4'],
]

for (const [name, input, questionType, response, expected] of answerCases) {
  test(`answer pipeline: ${name}`, () => {
    const mode = classifyUrlQuestionMode(questionType, input)
    const options = buildUrlOptionMapForMode(mode, input)
    assert.equal(resolveUrlAnswer(response, options, mode), expected)
  })
}

for (const [name, input, expected] of [
  ['decimals', decimalInput, '\n\n选项：\n1. 0.3\n2. 0.1\n3. 0.2\n4. 0.4'],
  ['integer units', '10 kg\n20 kg', '\n\n选项：\n1. 10 kg\n2. 20 kg'],
  ['multiline decimals', 'A. 概率\n0.3\nB. 概率\n0.4', '\n\n选项：\n1. 概率\n0.3\n2. 概率\n0.4'],
]) {
  test(`prompt pipeline: ${name}`, () => {
    const mode = classifyUrlQuestionMode('single', input)
    const options = buildUrlOptionMapForMode(mode, input)
    assert.equal(buildUrlQuestionPromptParts(mode, input, options, 'single').optionsText, expected)
  })
}
