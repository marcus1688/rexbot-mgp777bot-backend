function formatMessageId(messageId) {
  if (messageId <= 999999) {
    return messageId.toString();
  }

  const times = Math.floor((messageId - 1) / 999999);
  const remainder = ((messageId - 1) % 999999) + 1;
  const prefix = times === 0 ? "" : String.fromCharCode(96 + times);

  return prefix + remainder;
}

function parseMessageId(formattedId) {
  const str = formattedId.toString().trim();

  if (/^\d+$/.test(str)) {
    return parseInt(str);
  }

  const match = str.match(/^([a-z]+)(\d+)$/);
  if (!match) {
    throw new Error("无效的交易编号格式");
  }

  const prefix = match[1];
  const number = parseInt(match[2]);

  let times = 0;
  for (let i = 0; i < prefix.length; i++) {
    const charCode = prefix.charCodeAt(i) - 96;
    times = times * 26 + charCode;
  }

  const originalId = times * 999999 + number;

  return originalId;
}

module.exports = { formatMessageId, parseMessageId };
