chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        console.error('アクティブなタブが見つかりません');
        sendResponse({ error: 'アクティブなタブが見つかりません' });
        return;
      }

      let url = tabs[0].url;
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: getPageContent,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error('スクリプト実行エラー:', chrome.runtime.lastError);
            sendResponse({ error: 'スクリプトの実行に失敗しました' });
          } else if (results && results[0]) {
            processArticleData(results[0].result, url);
            sendResponse({ success: true });
          } else {
            console.error('無効な結果:', results);
            sendResponse({ error: '無効な結果を受信しました' });
          }
        }
      );
    });
    return true;
  }
});

function getPageContent() {
  let article = document.querySelector('article');
  let body = document.querySelector('body');
  let title = document.title;
  if (article && article.innerText.length > 20) {
    return { text: article.innerText, title: title };
  } else if (body) {
    return { text: body.innerText, title: title };
  } else {
    return { error: 'テキストを取得できませんでした' };
  }
}

async function processArticleData(response, url) {
  console.log('processArticleData開始:', JSON.stringify({ response, url }, null, 2));
  if (!response || !response.text) {
    console.error('無効な応答:', JSON.stringify(response, null, 2));
    showNotification('記事のテキストを取得できませんでした');
    return;
  }

  let now = new Date();
  try {
    let { apiKey, secretKey, databaseId } = await getCredentials();
    console.log('クレデンシャル取得成功');
    let text = response.text.substring(0, 10000);
    let summary = await callOpenAI(apiKey, text);
    console.log('OpenAI呼び出し成功');
    let tags = await generateTags(apiKey, text);
    console.log('タグ生成成功');

    let data = JSON.stringify({
      properties: {
        タイトル: { title: [{ text: { content: response.title } }] },
        URL: { url: url },
        要約内容: { rich_text: [{ text: { content: summary.choices[0].message.content } }] },
        タグ: { multi_select: tags.map(tag => ({ name: tag })) },
        作成日: { date: { start: now.toISOString() } },
        セレクト: { select: { name: '未読' } },
        テキスト: { rich_text: [{ text: { content: text.substring(0, 2000) } }] },
      }
    });

    await addRecordToNotionDatabase(data, secretKey, databaseId);
    console.log('Notionデータベースに追加成功');
    showNotification('登録が完了しました');
  } catch (error) {
    console.error('記事データの処理中にエラーが発生しました:', error);
    showNotification('エラーが発生しました: ' + error.message);
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
    prompt = '以下の記事を要約して日本語で記述してください。重要なポイントを網羅し、読みやすく簡潔な文章で表現してください。';
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
      model: 'gpt-4o',
      messages: [
        { role: 'system', 'content': prompt },
        { role: 'user', 'content': text },
      ],
      max_tokens: 4000,
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
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      ...JSON.parse(data)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API error: ${response.status} ${errorText}`);
  }

  return await response.json();
}

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: '通知',
    message: message
  });
}