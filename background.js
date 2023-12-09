chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      let url = tabs[0].url;  // Get the URL of the current tab
      chrome.tabs.sendMessage(
        request.tabId,
        { message: 'getArticleText' },
        response => {
          let now = new Date();  // Get the current date and time
          chrome.storage.sync.get(['apiKey'], async function(result) {
            let apiKey = result.apiKey;
            let text = response.text;
            if (text && text.length > 10000) {
              text = text.substring(0, 10000);  // Keep only the first 10000 characters
            }
            let summary = await callOpenAI(apiKey, text);
            let data = JSON.stringify({title: response.title, timestamp: now, url: url, summary: summary.choices[0].message.content, text: text});  // Add URL to the JSON
            console.log(data); 
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Retrieved Data',
                message: 'Your message here'
              });
            addRecordToNotionDatabase(data);
          });
        }
      );
    });
  }
  return true;
});

async function callOpenAI(apiKey, text) {
  let response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo-1106',
      messages: [
        {"role": "system", "content":"以下の文章を要約して日本語にしてください"},
        {"role": "user", "content": text}],
      max_tokens: 1000,
      temperature: 0
    })
  });
  let summary = await response.json();
  return summary;
}
async function addRecordToNotionDatabase(data) {
  chrome.storage.sync.get(['secretKey', 'databaseId'], async function(notionResult) {
    let secretKey = notionResult.secretKey;
    let databaseId = notionResult.databaseId;
    let parsedData = JSON.parse(data);

    if (!parsedData.title) {
      console.error('Title is missing in the data object');
      return;
    }

    let text = parsedData.text;
    if (text && text.length > 2000) {
      text = text.substring(0, 2000);  // Keep only the first 2000 characters
    }

    let response = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          タイトル: { title: [{ text: { content: parsedData.title } }] },
          作成日: { date: { start: parsedData.timestamp, end: null } },
          要約内容: { rich_text: [{ text: { content: parsedData.summary } }] },
          URL: { url: parsedData.url },
          // テキスト: { rich_text: [{ text: { content: text } }] },
          セレクト: { select: { name: '未読' } }  // Replace 'Your Select Value' with the actual value
        }
      })
    });

    let result = await response.json();
    console.log(result);
    alert('登録が完了しました');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '通知',
      message: '登録が完了しました'
    });
  });
}