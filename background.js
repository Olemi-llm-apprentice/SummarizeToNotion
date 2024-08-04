chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let url = tabs[0].url;
      chrome.tabs.sendMessage(
        request.tabId,
        { message: 'getArticleText' },
        (response) => {
          processArticleData(response, url);
        }
      );
    });
  }
  return true;
});

async function processArticleData(response, url) {
  let now = new Date();
  try {
    let { apiKey, secretKey, databaseId } = await getCredentials();
    let text = response.text.substring(0, 10000);
    let summary = await callOpenAI(apiKey, text);
    let tags = await generateTags(apiKey, text);

    let data = JSON.stringify({
      title: response.title,
      timestamp: now,
      url: url,
      summary: summary.choices[0].message.content,
      text: text,
      tags: tags,
    });

    await addRecordToNotionDatabase(data, secretKey, databaseId);
    showNotification('登録が完了しました');
  } catch (error) {
    console.error('Error processing article data:', error);
    showNotification('エラーが発生しました', 'error');
  }
}

async function getCredentials() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey', 'secretKey', 'databaseId'], (result) => {
      if (result.apiKey && result.secretKey && result.databaseId) {
        resolve(result);
      } else {
        reject(new Error('APIキー、Notion Secret Key、またはDatabase IDが設定されていません'));
      }
    });
  });
}

async function callOpenAI(apiKey, text, purpose = 'summarize') {
  let prompt = '';
  if (purpose === 'summarize') {
    prompt = '以下の文章を要約して日本語にしてください';
  } else if (purpose === 'generateTags') {
    prompt = '以下の文章から関連するタグを5つ、日本語でカンマ区切りで出力してください';
  }

  let response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo-1106',
      messages: [
        { role: 'system', 'content': prompt },
        { role: 'user', 'content': text },
      ],
      max_tokens: 1000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Error: ${response.status}`);
  }

  return await response.json();
}

async function generateTags(apiKey, text) {
  let response = await callOpenAI(apiKey, text, 'generateTags');
  let tags = response.choices[0].message.content.split(',').map((tag) => tag.trim());
  return tags;
}

async function addRecordToNotionDatabase(data, secretKey, databaseId) {
  let parsedData = JSON.parse(data);
  let text = parsedData.text.substring(0, 2000);

  let response = await fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        タイトル: { title: [{ text: { content: parsedData.title } }] },
        作成日: { date: { start: parsedData.timestamp, end: null } },
        要約内容: { rich_text: [{ text: { content: parsedData.summary } }] },
        URL: { url: parsedData.url },
        // テキスト: { rich_text: [{ text: { content: text } }] },
        セレクト: { select: { name: '未読' } },
        タグ: { multi_select: parsedData.tags.map((tag) => ({ name: tag })) },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion API Error: ${response.status}`);
  }

  return await response.json();
}

function showNotification(message, type = 'basic') {
  chrome.notifications.create({
    type: type,
    iconUrl: 'icon.png',
    title: '通知',
    message: message,
  });
}