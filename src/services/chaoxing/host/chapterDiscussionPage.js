function discussionPage(reply) {
  const root = document.querySelector('#subPageMain');
  const topic = root?.querySelector('.topicDetail_detail');
  const list = root?.querySelector('.topicDetail_replyWrap');
  if (!topic || !list) return null;
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const title = text(topic.querySelector('.topicDetail_title'));
  const body = topic.querySelector('.topicDetail_main > .richText');
  const editor = '#subPageMain .topicDetail_editContainer';
  const input = editor + ' .replyEdit .textareawrap > textarea';
  const submit = editor + ' .replyEditBtnGroup .addReply';
  const fields = document.querySelectorAll(input);
  const buttons = document.querySelectorAll(submit);
  const field = fields.length === 1 ? fields[0] : null;
  const button = buttons.length === 1 ? buttons[0] : null;
  const replies = [];
  const matchingReplyIds = [];
  for (const row of list.querySelectorAll('.topicDetail_replyList .topicDetail_replyItem')) {
    const content = row.querySelector('.topicReply_right > .replyContent');
    if (content?.closest('.topicDetail_replyItem') !== row) continue;
    const value = text(content);
    if (value && replies.length < 6 && !replies.includes(value.slice(0, 280))) replies.push(value.slice(0, 280));
    if (reply && value === text({ textContent: reply }) && /^[a-z\d_-]{1,100}$/i.test(row.id)) matchingReplyIds.push(row.id);
  }
  return {
    title: title.slice(0, 320),
    question: text(body).slice(0, 2000),
    hasImages: Boolean(body?.querySelector('img, svg, canvas, video')),
    replies,
    matchingReplyIds,
    input: field && !field.disabled && !field.readOnly ? input : '',
    submit: button && !button.matches(':disabled, .jb_btn_92_disable, [aria-disabled="true"]') ? submit : '',
    draft: !field?.value ? 'empty' : field.value === reply ? 'matches' : 'other',
  };
}
